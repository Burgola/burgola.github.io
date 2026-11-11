// Reads and writes Mapbox vector tiles (the protobuf format of the base map's tiles), as much as
// basemap-tiles.js needs: a tile one zoom level up, cut out of a coarser one.
//
// A tile is { layers: [{ name, version, extent, keys: [string], values: [Uint8Array],
// features: [{ id, tags: [number], type, geometry: [number] }] }] }. Values stay in their
// encoded form: they are only ever copied.

const utf8 = new TextDecoder(), toUtf8 = new TextEncoder();

class Reader {
    constructor(bytes) { this.bytes = bytes; this.at = 0; }
    get done() { return this.at >= this.bytes.length; }
    varint() {
        let value = 0, scale = 1, byte;
        do {
            byte = this.bytes[this.at++];
            value += (byte & 0x7f) * scale;
            scale *= 128;
        } while (byte & 0x80);
        return value;
    }
    key() { const k = this.varint(); return [Math.floor(k / 8), k & 7]; }
    chunk() { const n = this.varint(), start = this.at; this.at += n; return this.bytes.subarray(start, this.at); }
    skip(wire) {
        if (wire === 0) this.varint();
        else if (wire === 1) this.at += 8;
        else if (wire === 2) this.at += this.varint();
        else if (wire === 5) this.at += 4;
        else throw new Error(`vector tile: wire type ${wire}`);
    }
    packed() {
        const end = this.varint() + this.at, out = [];
        while (this.at < end) out.push(this.varint());
        return out;
    }
}

class Writer {
    constructor() { this.bytes = new Uint8Array(4096); this.at = 0; }
    room(n) {
        if (this.at + n <= this.bytes.length) return;
        const bigger = new Uint8Array(Math.max(this.bytes.length * 2, this.at + n));
        bigger.set(this.bytes.subarray(0, this.at));
        this.bytes = bigger;
    }
    varint(value) {
        this.room(10);
        while (value >= 128) { this.bytes[this.at++] = (value % 128) | 0x80; value = Math.floor(value / 128); }
        this.bytes[this.at++] = value;
    }
    key(field, wire) { this.varint(field * 8 + wire); }
    chunk(field, bytes) { this.key(field, 2); this.varint(bytes.length); this.room(bytes.length); this.bytes.set(bytes, this.at); this.at += bytes.length; }
    packed(field, values) {
        if (!values.length) return;
        const inner = new Writer();
        for (const v of values) inner.varint(v);
        this.chunk(field, inner.result());
    }
    result() { return this.bytes.subarray(0, this.at); }
}

export function decodeTile(buffer) {
    const r = new Reader(new Uint8Array(buffer)), layers = [];
    while (!r.done) {
        const [field, wire] = r.key();
        if (field === 3 && wire === 2) layers.push(decodeLayer(r.chunk()));
        else r.skip(wire);
    }
    return { layers };
}

function decodeLayer(bytes) {
    const r = new Reader(bytes), layer = { name: '', version: 2, extent: 4096, keys: [], values: [], features: [] };
    while (!r.done) {
        const [field, wire] = r.key();
        if (field === 1) layer.name = utf8.decode(r.chunk());
        else if (field === 2) layer.features.push(decodeFeature(r.chunk()));
        else if (field === 3) layer.keys.push(utf8.decode(r.chunk()));
        else if (field === 4) layer.values.push(r.chunk());
        else if (field === 5) layer.extent = r.varint();
        else if (field === 15) layer.version = r.varint();
        else r.skip(wire);
    }
    return layer;
}

function decodeFeature(bytes) {
    const r = new Reader(bytes), feature = { id: null, tags: [], type: 0, geometry: [] };
    while (!r.done) {
        const [field, wire] = r.key();
        if (field === 1) feature.id = r.varint();
        else if (field === 2) feature.tags = wire === 2 ? r.packed() : [r.varint()];
        else if (field === 3) feature.type = r.varint();
        else if (field === 4) feature.geometry = wire === 2 ? r.packed() : [r.varint()];
        else r.skip(wire);
    }
    return feature;
}

export function encodeTile(tile) {
    const w = new Writer();
    for (const layer of tile.layers) {
        if (!layer.features.length) continue;
        const l = new Writer();
        l.key(15, 0); l.varint(layer.version);
        l.chunk(1, toUtf8.encode(layer.name));
        for (const f of layer.features) {
            const fw = new Writer();
            if (f.id !== null) { fw.key(1, 0); fw.varint(f.id); }
            fw.packed(2, f.tags);
            fw.key(3, 0); fw.varint(f.type);
            fw.packed(4, f.geometry);
            l.chunk(2, fw.result());
        }
        for (const k of layer.keys) l.chunk(3, toUtf8.encode(k));
        for (const v of layer.values) l.chunk(4, v);
        l.key(5, 0); l.varint(layer.extent);
        w.chunk(3, l.result());
    }
    return w.result();
}

// Geometry commands <-> lists of [x, y] point lists, in tile units.
const zigzag = n => (n >>> 1) ^ -(n & 1);
const unzig = n => (n << 1) ^ (n >> 31);

function readGeometry(commands) {
    const parts = [];
    let x = 0, y = 0, part = null;
    for (let i = 0; i < commands.length;) {
        const command = commands[i] & 7, count = commands[i] >>> 3;
        i++;
        if (command === 7) continue;
        for (let n = 0; n < count; n++) {
            x += zigzag(commands[i++]); y += zigzag(commands[i++]);
            if (command === 1) { part = []; parts.push(part); }
            part.push([x, y]);
        }
    }
    return parts;
}

// Points: one MoveTo for all. Lines: MoveTo, then LineTo the rest. Rings: the same, then
// ClosePath.
function writeGeometry(parts, type) {
    const out = [];
    let x = 0, y = 0;
    const step = ([px, py]) => { out.push(unzig(px - x), unzig(py - y)); x = px; y = py; };
    if (type === 1) {
        const points = parts.flat();
        out.push(1 | (points.length << 3));
        points.forEach(step);
        return out;
    }
    for (const part of parts) {
        out.push(1 | (1 << 3));
        step(part[0]);
        if (part.length > 1) { out.push(2 | ((part.length - 1) << 3)); part.slice(1).forEach(step); }
        if (type === 3) out.push(7 | (1 << 3));
    }
    return out;
}

// Cuts a line at the box [lo, hi]², giving the pieces inside.
function clipLine(line, lo, hi) {
    const pieces = [];
    let piece = [];
    for (let i = 0; i + 1 < line.length; i++) {
        let [ax, ay] = line[i], [bx, by] = line[i + 1];
        // Liang–Barsky: the part of segment a→b inside the box, as t0..t1.
        let t0 = 0, t1 = 1;
        const dx = bx - ax, dy = by - ay;
        const edge = (p, q) => {
            if (p === 0) return q >= 0;
            const r = q / p;
            if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
            else { if (r < t0) return false; if (r < t1) t1 = r; }
            return true;
        };
        if (!(edge(-dx, ax - lo) && edge(dx, hi - ax) && edge(-dy, ay - lo) && edge(dy, hi - ay))) {
            if (piece.length > 1) pieces.push(piece);
            piece = [];
            continue;
        }
        const start = [Math.round(ax + t0 * dx), Math.round(ay + t0 * dy)];
        const end = [Math.round(ax + t1 * dx), Math.round(ay + t1 * dy)];
        if (!piece.length || t0 > 0) {
            if (piece.length > 1) pieces.push(piece);
            piece = [start];
        }
        piece.push(end);
        if (t1 < 1) { if (piece.length > 1) pieces.push(piece); piece = []; }
    }
    if (piece.length > 1) pieces.push(piece);
    return pieces;
}

// Cuts a closed ring at the box [lo, hi]² (Sutherland–Hodgman). The ring's last point repeats
// none of the others; neither does the result's.
function clipRing(ring, lo, hi) {
    let points = ring;
    const sides = [
        [p => p[0] >= lo, (a, b) => cross(a, b, 0, lo)],
        [p => p[0] <= hi, (a, b) => cross(a, b, 0, hi)],
        [p => p[1] >= lo, (a, b) => cross(a, b, 1, lo)],
        [p => p[1] <= hi, (a, b) => cross(a, b, 1, hi)],
    ];
    for (const [inside, meet] of sides) {
        if (!points.length) break;
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const a = points[(i + points.length - 1) % points.length], b = points[i];
            if (inside(b)) { if (!inside(a)) out.push(meet(a, b)); out.push(b); }
            else if (inside(a)) out.push(meet(a, b));
        }
        points = out;
    }
    return points.length >= 3 ? points : null;
}
function cross(a, b, axis, value) {
    const t = (value - a[axis]) / (b[axis] - a[axis]);
    const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    p[axis] = value;
    return [Math.round(p[0]), Math.round(p[1])];
}

// The part of `tile` that is its descendant `levels` zoom levels down at (dx, dy), counted
// from the tile's top left in that zoom level's tiles; reaching `buffer` (in the new tile's
// units of its extent) past its edges.
export function overzoom(tile, levels, dx, dy, buffer = 128) {
    const scale = 2 ** levels, layers = [];
    for (const layer of tile.layers) {
        const extent = layer.extent, lo = -buffer, hi = extent + buffer;
        const features = [];
        for (const f of layer.features) {
            const parts = readGeometry(f.geometry).map(part => part.map(([x, y]) => [x * scale - dx * extent, y * scale - dy * extent]));
            let kept;
            if (f.type === 1) kept = parts.map(p => p.filter(([x, y]) => x >= lo && x <= hi && y >= lo && y <= hi)).filter(p => p.length);
            else if (f.type === 2) kept = parts.flatMap(p => clipLine(p, lo, hi));
            else if (f.type === 3) kept = parts.map(p => clipRing(p, lo, hi)).filter(Boolean);
            else continue;
            if (!kept.length) continue;
            features.push({ id: f.id, tags: f.tags, type: f.type, geometry: writeGeometry(kept, f.type) });
        }
        if (features.length) layers.push({ ...layer, features });
    }
    return { layers };
}

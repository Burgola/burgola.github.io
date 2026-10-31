// A physical section of the basemap's road network, chosen by two points.
// Tile buffers duplicate lines. Join real vertices, never invent straight links
// across missing tiles or a crossing without a shared junction.
const CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path', 'road', 'residential', 'unclassified', 'living_street', 'footway', 'cycleway', 'steps', 'pedestrian']);
const radians = Math.PI / 180;
export function roadDistance(a, b) {
    const dy = (b[1] - a[1]) * radians, dx = (b[0] - a[0]) * radians;
    const h = Math.sin(dy / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dx / 2) ** 2;
    return 12742017.6 * Math.asin(Math.sqrt(Math.min(1, h)));
}
const coordinateKey = p => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;
const grade = p => Number(p.layer) || (p.brunnel === 'bridge' ? 1 : p.brunnel === 'tunnel' ? -1 : 0);

export function roadNetwork(features) {
    const nodes = new Map(), segments = new Map(), ends = new Map();
    const node = (p, level) => {
        const key = `${coordinateKey(p)}|${level}`;
        if (!nodes.has(key)) nodes.set(key, { point: p.slice(), edges: new Map() });
        return key;
    };
    const connect = (a, b, length) => {
        if (!nodes.get(a).edges.has(b) || nodes.get(a).edges.get(b) > length) {
            nodes.get(a).edges.set(b, length); nodes.get(b).edges.set(a, length);
        }
    };
    for (const f of features) {
        if (!CLASSES.has(f.properties?.class)) continue;
        const lines = f.geometry?.type === 'LineString' ? [f.geometry.coordinates]
            : f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : [];
        for (const line of lines) {
            if (line.length < 2 || line.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
            const level = grade(f.properties), keys = line.map(p => node(p, level));
            for (const index of [0, line.length - 1]) {
                const key = coordinateKey(line[index]);
                if (!ends.has(key)) ends.set(key, new Set());
                ends.get(key).add(keys[index]);
            }
            for (let i = 1; i < keys.length; i++) {
                const a = keys[i - 1], b = keys[i];
                if (a === b) continue;
                const key = [a, b].sort().join('/');
                if (segments.has(key)) continue;
                if (segments.size >= 100000) throw Error('ROAD_LIMIT');
                const length = roadDistance(line[i - 1], line[i]);
                segments.set(key, { key, a, b, from: line[i - 1].slice(), to: line[i].slice(), length });
            }
        }
    }
    // Buffered vector tiles can clip the same straight road at different
    // positions. Split overlapping segments at existing endpoints, without
    // joining roads across a gap or creating an intersection at a crossing.
    const cells = new Map(), cellSize = 0.005;
    for (const s of segments.values()) {
        for (let x = Math.floor(Math.min(s.from[0], s.to[0]) / cellSize); x <= Math.floor(Math.max(s.from[0], s.to[0]) / cellSize); x++)
            for (let y = Math.floor(Math.min(s.from[1], s.to[1]) / cellSize); y <= Math.floor(Math.max(s.from[1], s.to[1]) / cellSize); y++) {
                const key = `${x},${y}`;
                if (!cells.has(key)) cells.set(key, []);
                cells.get(key).push(s);
            }
    }
    const cuts = new Map();
    for (const group of ends.values()) for (const key of group) {
        const p = nodes.get(key).point, level = key.split('|').at(-1);
        const candidates = cells.get(`${Math.floor(p[0] / cellSize)},${Math.floor(p[1] / cellSize)}`) || [];
        for (const s of candidates) {
            if (key === s.a || key === s.b || s.a.split('|').at(-1) !== level) continue;
            const scale = Math.cos(p[1] * radians), dx = (s.to[0] - s.from[0]) * scale, dy = s.to[1] - s.from[1];
            const denominator = dx * dx + dy * dy;
            if (!denominator) continue;
            const fraction = ((p[0] - s.from[0]) * scale * dx + (p[1] - s.from[1]) * dy) / denominator;
            if (fraction <= 1e-8 || fraction >= 1 - 1e-8) continue;
            const nearest = [s.from[0] + fraction * (s.to[0] - s.from[0]), s.from[1] + fraction * (s.to[1] - s.from[1])];
            if (roadDistance(p, nearest) > 0.25) continue;
            if (!cuts.has(s.key)) cuts.set(s.key, new Map());
            cuts.get(s.key).set(key, fraction);
        }
    }
    const split = new Map();
    for (const s of segments.values()) {
        const along = [[s.a, 0], ...(cuts.get(s.key) || []), [s.b, 1]].sort((a, b) => a[1] - b[1]);
        for (let i = 1; i < along.length; i++) {
            const a = along[i - 1][0], b = along[i][0], key = [a, b].sort().join('/');
            if (a === b || split.has(key)) continue;
            const from = nodes.get(a).point, to = nodes.get(b).point, length = roadDistance(from, to);
            split.set(key, { key, a, b, from, to, length });
            connect(a, b, length);
        }
    }
    // Bridges/tunnels meet surface roads at their endpoints, but an interior
    // crossing at another level does not make a junction.
    for (const group of ends.values())
        for (const a of group) for (const b of group) if (a !== b) connect(a, b, 0);
    return { nodes, segments: [...split.values()] };
}

export function nearestRoad(network, at, project, radius = 14) {
    let best = null, distance = radius * radius;
    for (const segment of network.segments) {
        const a = project(segment.from), b = project(segment.to);
        const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
        if (!length) continue;
        const fraction = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / length));
        const squared = (at.x - a.x - fraction * dx) ** 2 + (at.y - a.y - fraction * dy) ** 2;
        if (squared > distance) continue;
        distance = squared;
        best = { segment, fraction, point: [segment.from[0] + fraction * (segment.to[0] - segment.from[0]), segment.from[1] + fraction * (segment.to[1] - segment.from[1])] };
    }
    return best;
}

class Queue {
    values = [];
    push(node, cost) {
        const item = { node, cost }, q = this.values;
        q.push(item); let i = q.length - 1;
        while (i > 0) { const parent = (i - 1) >> 1; if (q[parent].cost <= cost) break; q[i] = q[parent]; i = parent; }
        q[i] = item;
    }
    pop() {
        const q = this.values, first = q[0], last = q.pop();
        if (q.length) {
            let i = 0;
            while (2 * i + 1 < q.length) {
                let child = 2 * i + 1;
                if (child + 1 < q.length && q[child + 1].cost < q[child].cost) child++;
                if (q[child].cost >= last.cost) break;
                q[i] = q[child]; i = child;
            }
            q[i] = last;
        }
        return first;
    }
}

export function roadSection(network, start, end) {
    if (!start || !end || roadDistance(start.point, end.point) < 0.5) return null;
    const extra = new Map(), points = new Map([['start', start.point], ['end', end.point]]);
    const add = (a, b, length) => { if (!extra.has(a)) extra.set(a, new Map()); extra.get(a).set(b, length); };
    const link = (a, b, length) => { add(a, b, length); add(b, a, length); };
    for (const [id, hit] of [['start', start], ['end', end]]) {
        if (!network.nodes.has(hit.segment.a) || !network.nodes.has(hit.segment.b)) return null;
        link(id, hit.segment.a, hit.segment.length * hit.fraction);
        link(id, hit.segment.b, hit.segment.length * (1 - hit.fraction));
    }
    if (start.segment.key === end.segment.key) link('start', 'end', start.segment.length * Math.abs(end.fraction - start.fraction));
    const costs = new Map([['start', 0]]), before = new Map(), queue = new Queue();
    queue.push('start', 0);
    while (queue.values.length) {
        const { node, cost } = queue.pop();
        if (cost !== costs.get(node)) continue;
        if (node === 'end') break;
        const edges = [...(network.nodes.get(node)?.edges || []), ...(extra.get(node) || [])];
        for (const [next, length] of edges) {
            const candidate = cost + length;
            if (candidate >= (costs.get(next) ?? Infinity)) continue;
            costs.set(next, candidate); before.set(next, node); queue.push(next, candidate);
        }
    }
    if (!costs.has('end')) return null;
    const path = [];
    for (let node = 'end'; node; node = before.get(node)) path.push(points.get(node) || network.nodes.get(node).point);
    path.reverse();
    return path.filter((p, i) => !i || roadDistance(p, path[i - 1]) > 0.01);
}

// Controls describe the mapper's intent. Expanded road vertices are a preview,
// then the final geometry; they are never mistaken for editable guide points.
export function guidedRoadSection(network, controls, project) {
    if (controls.length < 2) return { coordinates: [], legs: [] };
    const hits = controls.map(p => nearestRoad(network, project(p), project));
    if (hits.some((hit, i) => !hit || roadDistance(hit.point, controls[i]) > 1)) return null;
    const legs = [];
    for (let i = 1; i < hits.length; i++) {
        const leg = roadSection(network, hits[i - 1], hits[i]);
        if (!leg || leg.length < 2) return null;
        legs.push(leg);
    }
    const coordinates = legs[0].slice();
    for (const leg of legs.slice(1)) for (const point of leg.slice(1)) coordinates.push(point);
    return { coordinates, legs };
}

export function insertRoadGuide(controls, legs, point, project) {
    const at = project(point);
    let best = Infinity, index = 1;
    for (let leg = 0; leg < legs.length; leg++) for (let i = 1; i < legs[leg].length; i++) {
        const a = project(legs[leg][i - 1]), b = project(legs[leg][i]);
        const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / length)) : 0;
        const squared = (at.x - a.x - t * dx) ** 2 + (at.y - a.y - t * dy) ** 2;
        if (squared < best) { best = squared; index = leg + 1; }
    }
    const next = controls.slice(); next.splice(index, 0, point);
    return next;
}

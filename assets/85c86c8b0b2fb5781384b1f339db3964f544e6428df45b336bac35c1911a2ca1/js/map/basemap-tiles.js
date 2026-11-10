// The base map from this site: OpenFreeMap's Liberty style and its tiles, copied into basemap/
// by the editor (Common/workspace/Basemap.cpp, which also says how it is laid out).
//
// basemap/basemap.json lists the areas tiles are kept for and down to which zoom level:
// Prekmurje and Porabje in full detail, the land around them in less, and what a very wide or
// tall screen shows beyond that in little. A tile deeper than its area keeps is cut out of
// the nearest one kept above it (vector-tile.js), so the map there stays drawn, in the
// coarser detail, instead of going blank. Tiles are stored compressed (zlib); this undoes it.

import { decodeTile, encodeTile, overzoom } from './vector-tile.js';

const PROTOCOL = 'basemap';
const base = () => new URL('basemap/', document.baseURI).href;
let areas = [];
const coarse = new Map(); // "z/x/y" -> Promise of a decoded tile, the latest few
const COARSE_KEPT = 24;

const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
};
// The deepest zoom level, at most z, kept for the tile z/x/y (Basemap.cpp lists them the same way).
function keptZoom(z, x, y) {
    let deepest = -1;
    for (const area of areas)
        for (const [west, south, east, north] of area.boxes) {
            const at = Math.min(z, area.maxzoom), shift = z - at;
            const ax = Math.floor(x / 2 ** shift), ay = Math.floor(y / 2 ** shift);
            if (ax >= tileX(west, at) && ax <= tileX(east, at) && ay >= tileY(north, at) && ay <= tileY(south, at))
                deepest = Math.max(deepest, at);
        }
    return deepest;
}

async function inflate(bytes, signal) {
    const view = new Uint8Array(bytes);
    if (view[0] !== 0x78) return bytes; // already plain (a server that unpacked it)
    const stream = new Blob([view]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream, { signal }).arrayBuffer();
}

// The stored tile z/x/y, plain; null where none is kept.
async function stored(z, x, y, signal) {
    const response = await fetch(`${base()}tiles/${z}/${x}/${y}.pbf`, { signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`base map tile ${z}/${x}/${y}: HTTP ${response.status}`);
    return inflate(await response.arrayBuffer(), signal);
}

function coarseTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let tile = coarse.get(key);
    if (tile) { coarse.delete(key); coarse.set(key, tile); return tile; }
    tile = stored(z, x, y).then(bytes => bytes && decodeTile(bytes));
    tile.catch(() => coarse.delete(key));
    coarse.set(key, tile);
    while (coarse.size > COARSE_KEPT) coarse.delete(coarse.keys().next().value);
    return tile;
}

async function load(params, abort) {
    const [z, x, y] = params.url.slice(`${PROTOCOL}://`.length).split('/').map(Number);
    let at = keptZoom(z, x, y);
    if (at < 0) return { data: new ArrayBuffer(0) };
    if (at === z) {
        const bytes = await stored(z, x, y, abort.signal);
        if (bytes) return { data: bytes };
        at = z - 1; // none kept here after all: from the one above
    }
    for (; at >= 0; at--) {
        const levels = z - at, scale = 2 ** levels;
        const parent = await coarseTile(at, Math.floor(x / scale), Math.floor(y / scale));
        if (!parent) continue;
        const part = overzoom(parent, levels, x % scale, y % scale);
        const bytes = encodeTile(part);
        return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    return { data: new ArrayBuffer(0) };
}

// The style, ready for the map: its fonts, icons and shaded relief from basemap/, its tiles
// through this file.
export async function basemapStyle() {
    const get = async name => {
        const response = await fetch(base() + name);
        if (!response.ok) throw new Error(`base map ${name}: HTTP ${response.status}`);
        return response.json();
    };
    const [style, info] = await Promise.all([get('style.json'), get('basemap.json')]);
    areas = info.areas;
    maplibregl.addProtocol(PROTOCOL, load);
    // Paths in the style are relative to basemap/. (Not through URL(): it would escape the
    // {placeholders}.)
    const absolute = path => /^[a-z]+:/.test(path) ? path : base() + path;
    style.glyphs = absolute(style.glyphs);
    style.sprite = absolute(style.sprite);
    for (const source of Object.values(style.sources))
        if (source.tiles) source.tiles = source.tiles.map(absolute);
    return style;
}

// The base map from this site: OpenFreeMap's Liberty style with its fonts, icons and tiles,
// copied into basemap/ by the editor (Common/workspace/Basemap.cpp, which also says how it is
// laid out).
//
// The style asks for its tiles and fonts as basemap://<path in basemap/>, and they come
// through here: kept in this browser between visits, one store per base map
// (core/file-store.js), and fetched ahead by preload.js.
//
// basemap/basemap.json lists the areas tiles are kept for and down to which zoom level:
// Prekmurje and Porabje in full detail, the land around them in less, and what a very wide or
// tall screen shows beyond that in little. A tile deeper than its area keeps is cut out of
// the nearest one kept above it (vector-tile.js), so the map there stays drawn, in the
// coarser detail, instead of going blank. Tiles are stored compressed (zlib); this undoes it.

import { decodeTile, encodeTile, overzoom } from './vector-tile.js';
import { FileStore } from '../core/file-store.js';

const PROTOCOL = 'basemap';
const base = () => new URL('basemap/', document.baseURI).href;
let info = { areas: [], fonts: [] }; // basemap.json
let files = null;
const coarse = new Map(); // "z/x/y" -> Promise of a decoded tile, the latest few
const COARSE_KEPT = 24;

const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
};
const tilePath = (z, x, y) => `tiles/${z}/${x}/${y}.pbf`;

// The deepest zoom level, at most z, kept for the tile z/x/y; -1 where none is (Basemap.cpp
// lists them the same way).
function keptZoom(areas, z, x, y) {
    let deepest = -1;
    for (const area of areas) {
        if (z < area.minzoom) continue;
        const at = Math.min(z, area.maxzoom), shift = z - at;
        const ax = Math.floor(x / 2 ** shift), ay = Math.floor(y / 2 ** shift);
        for (const [west, south, east, north] of area.boxes)
            if (ax >= tileX(west, at) && ax <= tileX(east, at) && ay >= tileY(north, at) && ay <= tileY(south, at))
                deepest = Math.max(deepest, at);
    }
    return deepest;
}

// The kept tiles the map draws from while it shows no more than bounds ([west, south, east,
// north]) from zoom level `from` in, as [z, x, y].
export function keptTiles(areas, [west, south, east, north], from) {
    const tiles = new Map();
    const deepest = Math.max(...areas.map(area => area.maxzoom));
    for (let z = Math.max(0, Math.floor(from)); z <= deepest; z++)
        for (let x = tileX(west, z); x <= tileX(east, z); x++)
            for (let y = tileY(north, z); y <= tileY(south, z); y++) {
                const at = keptZoom(areas, z, x, y);
                if (at < 0) continue;
                const scale = 2 ** (z - at), kx = Math.floor(x / scale), ky = Math.floor(y / scale);
                tiles.set(tilePath(at, kx, ky), [at, kx, ky]);
            }
    return [...tiles.values()];
}

// For preload.js: what the map can ask for within bounds from zoom level `from` in, the store
// it is kept in, and each file's address with the Web Mercator box ([x0, y0, x1, y1], 0–1) it
// covers, if any.
export function basemapFiles(bounds, from) {
    const fonts = info.fonts.map(path => ({ url: base() + path }));
    const tiles = keptTiles(info.areas, bounds, from).map(([z, x, y]) => ({
        url: base() + tilePath(z, x, y), zoom: z, box: [x / 2 ** z, y / 2 ** z, (x + 1) / 2 ** z, (y + 1) / 2 ** z],
    }));
    return { store: files, files: [...fonts, ...tiles] };
}

// The file at path in basemap/, plain (for MapLibre to keep); null where there is none.
async function plain(path) {
    const bytes = await files.get(base() + path);
    if (!bytes) return null;
    const view = new Uint8Array(bytes);
    if (view[0] !== 0x78) return bytes.slice(0); // not compressed (a font), or a server unpacked it
    return new Response(new Blob([view]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
}

function coarseTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let tile = coarse.get(key);
    if (tile) { coarse.delete(key); coarse.set(key, tile); return tile; }
    tile = plain(tilePath(z, x, y)).then(bytes => bytes && decodeTile(bytes));
    tile.catch(() => coarse.delete(key));
    coarse.set(key, tile);
    while (coarse.size > COARSE_KEPT) coarse.delete(coarse.keys().next().value);
    return tile;
}

async function tile(z, x, y) {
    let at = keptZoom(info.areas, z, x, y);
    if (at === z) {
        const bytes = await plain(tilePath(z, x, y));
        if (bytes) return bytes;
        at = z - 1; // none kept here after all: from the one above
    }
    for (; at >= 0; at--) {
        const levels = z - at, scale = 2 ** levels;
        const parent = await coarseTile(at, Math.floor(x / scale), Math.floor(y / scale));
        if (!parent) continue;
        const bytes = encodeTile(overzoom(parent, levels, x % scale, y % scale));
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return new ArrayBuffer(0);
}

async function load({ url }) {
    const path = url.slice(`${PROTOCOL}://`.length);
    const at = /^tiles\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(path);
    if (at) return { data: await tile(Number(at[1]), Number(at[2]), Number(at[3])) };
    const bytes = await plain(path);
    if (!bytes) throw new Error(`base map: no ${path}`);
    return { data: bytes };
}

// The style, ready for the map: its tiles and fonts through this file, its icons from basemap/.
export async function basemapStyle() {
    const get = async name => {
        const response = await fetch(base() + name);
        if (!response.ok) throw new Error(`base map ${name}: HTTP ${response.status}`);
        return response.json();
    };
    const [style, manifest] = await Promise.all([get('style.json'), get('basemap.json')]);
    info = { areas: manifest.areas, fonts: manifest.fonts || [] };
    // The editor reads basemap/ from its own disk: nothing to keep.
    files = new FileStore('basemap', window.tbmapEditorOptions ? '' : `${manifest.release}-${manifest.built}`);
    maplibregl.addProtocol(PROTOCOL, load);
    style.sprite = base() + style.sprite;
    return style;
}

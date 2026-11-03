// Fetches the aerial photo tiles: keeps them in this browser, tries again
// when the GURS server fails, and says how it is going (onTileStatus), so
// the map can tell the visitor why the photo is missing.
//
// The GURS WMS sends no caching headers, so on its own the browser fetches a
// tile again every time it is shown — zooming back out, panning back, the
// next visit. Tiles fetched through here are kept in memory for this visit
// and in Cache Storage for later ones: at most MAX_STORED of them, each for
// at most MAX_AGE, oldest dropped first. Only what the visitor has already
// looked at is ever kept; nothing is fetched ahead.
//
// Where GURS has no photo — and sometimes when it has a bad moment — it
// answers with a plain white tile, as a normal image. A white tile is tiny
// (under BLANK_BYTES), so tiles that small are shown but never kept: a white
// tile from a bad moment is fetched again next time instead of sticking for
// a month. A WMS error comes as a 200 with an XML body; that, a server error
// and a request that takes too long are tried again (ATTEMPTS, with a pause
// between), and only then the tile fails.
//
// A tile URL may end in flags after #, joined with &:
// - clip=NAME: the photo only inside an outline given with setClip(NAME, geometry),
//   Prekmurje's for the GURS photo, Porabje's for Lechner's. A tile wholly outside it is
//   never asked for; one across its edge is cut along it, and the drawn map shows around.
// - clear-white (Lechner's photo of Porabje): a tile across the outline's edge has its white
//   made see-through when a noticeable part of it is white: that is where the photo ends at
//   the border, and the GURS photo under it shows.
// What is kept, in memory and in Cache Storage, is the tile as it came; cutting it happens
// each time it is shown.
//
// A MapLibre protocol: a source whose tile URLs go through cachedUrl()
// (aerial.js) is fetched here. Where Cache Storage is not available (plain
// http, some private windows) only the memory part works. The native editor
// uses the same cache in its persistent WebView profile and stable local origin.

const PROTOCOL = 'cached';
const STORE_NAME = 'tbmap-tiles-v2';
const OLD_STORES = ['tbmap-tiles-v1'];      // may hold white tiles from bad moments
const MAX_STORED = 2500;                    // a photo tile is ~50 KB: ~125 MB
const MAX_MEMORY = 300;                     // ~15 MB
const MAX_AGE = 30 * 24 * 3600 * 1000;      // the photo is renewed yearly
const TRIM_EVERY = 100;                     // stored tiles between size checks
const STORED_AT = 'x-tbmap-stored';
const BLANK_BYTES = 6000;                   // a white 512 px JPEG is ~4.7 KB, a photo 15–80 KB
const ATTEMPTS = 3;
const RETRY_PAUSE = [1500, 4000];           // ms before the 2nd and 3rd attempt
const TIMEOUT = 25000;                      // ms one attempt may take
const WHITE = 250;                          // each of red, green and blue at least this
const WHITE_SHARE = 0.02;                   // white needed before a tile is made see-through
const EARTH = 6378137;                      // Web Mercator's sphere, in metres
// A tile with nothing to show: one fully see-through pixel (RGBA 0,0,0,0), stretched.
export const NOTHING = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='), c => c.charCodeAt(0)).buffer;

const memory = new Map();                   // url -> ArrayBuffer, oldest first
const clips = new Map();                    // name -> { rings in Web Mercator metres, box }
let storeOpen = null;
let addedSinceTrim = 0;

// How the tiles are doing, for the status line (aerial.js).
const status = { loading: 0, failed: new Set(), error: null, retrying: 0 };
const listeners = new Set();
let notifyQueued = false;

export const cachedUrl = (url) => `${PROTOCOL}://${url}`;

// The outline a photo with #clip=NAME is shown inside: a GeoJSON (Multi)Polygon, or null.
export function setClip(name, geometry) {
    const polygons = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    const rings = polygons.flat().map(ring => ring.map(([lon, lat]) => [EARTH * lon * Math.PI / 180, EARTH * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))]));
    if (!rings.length) { clips.delete(name); return; }
    const all = rings.flat();
    clips.set(name, { rings, box: [Math.min(...all.map(p => p[0])), Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1]))] });
}

// Where a tile (a Web Mercator box) lies against the outline named: 'outside', 'inside' or
// 'across' its edge; 'inside' when there is no such outline. A tile is across the edge when a
// corner of the outline lies in it or its own corners disagree.
export function placeOf(name, [west, south, east, north]) {
    const clip = clips.get(name);
    if (!clip) return 'inside';
    const [cw, cs, ce, cn] = clip.box;
    if (ce < west || cw > east || cn < south || cs > north) return 'outside';
    if (clip.rings.some(ring => ring.some(([x, y]) => x > west && x < east && y > south && y < north))) return 'across';
    const corners = [[west, south], [east, south], [east, north], [west, north]].map(p => inside(clip.rings, p));
    return corners.every(Boolean) ? 'inside' : corners.some(Boolean) ? 'across' : 'outside';
}

function inside(rings, [x, y]) {
    let result = false;
    for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
        }
    return result;
}

// A tile URL's flags after # (clip=, clear-white) and the Web Mercator box it covers.
function parse(url) {
    const [base, fragment = ''] = url.split('#');
    const flags = new URLSearchParams(fragment);
    let box = null;
    for (const [key, value] of new URL(base).searchParams)
        if (key.toLowerCase() === 'bbox') box = value.split(',').map(Number);
    return { base, flags, box: box?.length === 4 && box.every(Number.isFinite) ? box : null };
}

// fn({ loading, failed, error, retrying }) whenever it changes. error: the
// last failure — { kind: 'timeout' | 'offline' | 'http' | 'wms' | 'network', detail }.
export function onTileStatus(fn) {
    listeners.add(fn);
}

// The failed tiles are being asked for again (aerial.js reloads the source).
export function forgetFailures() {
    status.failed.clear();
    status.error = null;
    notify();
}

function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    setTimeout(() => {
        notifyQueued = false;
        const view = { loading: status.loading, failed: status.failed.size, error: status.error, retrying: status.retrying };
        for (const fn of listeners) fn(view);
    }, 100);
}

class TileError extends Error {
    constructor(kind, detail, retry) {
        super(`${kind}: ${detail}`);
        this.kind = kind;
        this.detail = detail;
        this.retry = retry;
    }
}

let registered = false;

export function registerTileCache() {
    if (registered) return;
    registered = true;
    dropOldStores();
    maplibregl.addProtocol(PROTOCOL, async (params, abort) => {
        const { base: url, flags, box } = parse(params.url.slice(PROTOCOL.length + 3));
        const clip = clips.get(flags.get('clip'));
        const place = box ? placeOf(flags.get('clip'), box) : 'inside';
        if (place === 'outside') return { data: NOTHING.slice(0) };
        let data = memory.get(url);
        if (!data) {
            const store = await openStore();
            data = store && await fromStore(store, url);
            if (!data) {
                status.loading++;
                notify();
                try {
                    const got = await fetchTile(url, abort.signal);
                    data = got.data;
                    if (store && data.byteLength >= BLANK_BYTES) toStore(store, url, data, got.type);
                    status.failed.delete(url);
                } catch (err) {
                    if (!abort.signal.aborted) {
                        status.failed.add(url);
                        status.error = err instanceof TileError ? err : new TileError('network', String(err?.message || err), true);
                        console.warn('[Aerial] tile failed', status.error.message, url);
                    }
                    throw err;
                } finally {
                    status.loading--;
                    notify();
                }
            }
        }
        remember(url, data);
        if (place === 'across') return { data: await cut(data, clip, box, flags.has('clear-white')).catch(() => data.slice(0)) };
        return { data: data.slice(0) }; // MapLibre may take over the buffer it gets
    });
}

// The part of a tile inside an outline, the rest see-through (with its white too, when asked
// and noticeable). Where the browser cannot draw off screen, the tile as it came.
async function cut(data, clip, [west, south, east, north], withoutWhite) {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return data.slice(0);
    const bitmap = await createImageBitmap(new Blob([data]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    if (withoutWhite) clearWhite(context, canvas.width, canvas.height);
    const sx = canvas.width / (east - west), sy = canvas.height / (north - south);
    context.globalCompositeOperation = 'destination-in';
    context.beginPath();
    for (const ring of clip.rings)
        ring.forEach(([x, y], i) => context[i ? 'lineTo' : 'moveTo']((x - west) * sx, (north - y) * sy));
    context.fill('evenodd');
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 }); // PNG where WebP cannot be written
    return blob.arrayBuffer();
}

// One tile, tried up to ATTEMPTS times. Resolves { data, type }.
async function fetchTile(url, signal) {
    let last;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        if (attempt > 1) {
            status.retrying++;
            notify();
            try {
                await pause(RETRY_PAUSE[attempt - 2], signal);
            } finally {
                status.retrying--;
            }
        }
        try {
            return await fetchOnce(url, signal);
        } catch (err) {
            if (signal.aborted) throw err;
            last = err instanceof TileError ? err : new TileError(navigator.onLine === false ? 'offline' : 'network', String(err?.message || err), true);
            if (!last.retry) break;
        }
    }
    throw last;
}

async function fetchOnce(url, signal) {
    // Its own time limit: a request GURS never answers would otherwise hold
    // one of the browser's few connections to it for good.
    const own = new AbortController();
    const stop = () => own.abort();
    signal.addEventListener('abort', stop, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; own.abort(); }, TIMEOUT);
    try {
        const res = await fetch(url, { signal: own.signal });
        const type = res.headers.get('content-type') || '';
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new TileError('http', `HTTP ${res.status}${text && !type.startsWith('image/') ? ` – ${shorten(text)}` : ''}`,
                res.status >= 500 || res.status === 429 || res.status === 408);
        }
        const data = await res.arrayBuffer();
        if (!type.startsWith('image/')) {
            throw new TileError('wms', shorten(new TextDecoder().decode(data.slice(0, 2000))), true);
        }
        return { data, type };
    } catch (err) {
        if (timedOut) throw new TileError('timeout', `${TIMEOUT / 1000} s`, true);
        throw err;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
    }
}

// The drawn tile's white made see-through, when enough of it is white.
function clearWhite(context, width, height) {
    const image = context.getImageData(0, 0, width, height), px = image.data;
    let white = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] >= WHITE && px[i + 1] >= WHITE && px[i + 2] >= WHITE) ++white;
    if (white < WHITE_SHARE * px.length / 4) return;
    for (let i = 0; i < px.length; i += 4) if (px[i] >= WHITE && px[i + 1] >= WHITE && px[i + 2] >= WHITE) px[i + 3] = 0;
    context.putImageData(image, 0, 0);
}

// The readable part of an error answer (a WMS ServiceException, an HTML page).
function shorten(text) {
    const m = /<(?:ows:)?(?:ServiceException|ExceptionText)[^>]*>([\s\S]*?)</i.exec(text);
    const plain = (m ? m[1] : text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    return plain.length > 140 ? `${plain.slice(0, 140)}…` : plain;
}

function pause(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
    });
}

function remember(url, data) {
    memory.delete(url);
    memory.set(url, data);
    if (memory.size > MAX_MEMORY) memory.delete(memory.keys().next().value);
}

function openStore() {
    if (!storeOpen) {
        storeOpen = typeof caches === 'undefined'
            ? Promise.resolve(null)
            : caches.open(STORE_NAME).catch(() => null);
    }
    return storeOpen;
}

function dropOldStores() {
    if (typeof caches === 'undefined') return;
    for (const name of OLD_STORES) caches.delete(name).catch(() => {});
}

async function fromStore(store, url) {
    try {
        const res = await store.match(url);
        if (!res) return null;
        if (Date.now() - Number(res.headers.get(STORED_AT) || 0) > MAX_AGE) {
            store.delete(url);
            return null;
        }
        const data = await res.arrayBuffer();
        if (data.byteLength < BLANK_BYTES) { // never kept on purpose: fetch it again
            store.delete(url);
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

async function toStore(store, url, data, type) {
    try {
        await store.put(url, new Response(data.slice(0), { headers: { 'content-type': type, [STORED_AT]: String(Date.now()) } }));
        if (++addedSinceTrim >= TRIM_EVERY) {
            addedSinceTrim = 0;
            const keys = await store.keys(); // oldest first
            for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STORED))) await store.delete(key);
        }
    } catch {
        // Storage full or blocked: the tile is just not kept.
    }
}

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

const memory = new Map();                   // url -> ArrayBuffer, oldest first
let storeOpen = null;
let addedSinceTrim = 0;

// How the tiles are doing, for the status line (aerial.js).
const status = { loading: 0, failed: new Set(), error: null, retrying: 0 };
const listeners = new Set();
let notifyQueued = false;

export const cachedUrl = (url) => `${PROTOCOL}://${url}`;

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
        const url = params.url.slice(PROTOCOL.length + 3);
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
        return { data: data.slice(0) }; // MapLibre may take over the buffer it gets
    });
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

// Fetches ahead, once the map is first drawn, everything panning and zooming can still ask
// for, so that after it moving around Prekmurje and Porabje waits for nothing: the base map's
// tiles for all the map reaches (region-lock.js) at every zoom level, its fonts, each
// village's houses and the search data. They are kept in this browser (core/file-store.js),
// so a later visit fetches only what changed: a new base map, newly published data.
//
// Only on the website (the editor reads its own disk; map.js adds this there only), while
// the map settings say so (view.preload), and not where the browser asks to save data. Quiet:
// a few files at a time, at low priority, what is under the view first, then outwards.
// (The aerial photo is not fetched ahead: even this website's own part of it is a few hundred MB.)

import { repository } from '../data/DataRepository.js';
import { FeatureKind } from '../data/DatDecoder.js';
import { basemapFiles } from './basemap-tiles.js';

const AT_ONCE = 6;
const GIVE_UP = 8;     // failed files before it stops for this visit
const SETTLE = 1500;   // ms after the reach changes (a resized window, Porabje) before it looks again

// { state, done, total }: state 'off' | 'saveData' | 'unavailable' | 'loading' | 'done' |
// 'failed'; done and total count files, those kept before included.
let status = { state: 'loading', done: 0, total: 0 };
const listeners = new Set();

export function onPreloadStatus(fn) {
    listeners.add(fn);
    fn(status);
    return () => listeners.delete(fn);
}

function report(next) {
    status = { ...status, ...next };
    for (const fn of listeners) fn(status);
}

const savingData = () => {
    const connection = navigator.connection;
    return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType || '');
};

// The nearest distance from a point to a box, both in Web Mercator (0–1).
const distance = ([x, y], [x0, y0, x1, y1]) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));

const mercator = (lon, lat) => {
    const p = maplibregl.MercatorCoordinate.fromLngLat([lon, lat]);
    return [p.x, p.y];
};

export function createPreload() {
    let map, wanted = false, drawn = false, running = false, again = false, timer = 0;
    let looking = '', had = ''; // the reach looked at now, and the last one all was had for

    // How far the map reaches: [west, south, east, north], from which zoom level in.
    const reach = () => [...(map.getMaxBounds() || map.getBounds()).toArray().flat(), map.getMinZoom()];

    // Everything to have, nearest the view's centre first; a file with no place (fonts, the
    // search data) before all.
    function wishes([west, south, east, north, from]) {
        const { store, files } = basemapFiles([west, south, east, north], from);
        const all = files.map(file => ({ ...file, store }));
        all.push({ url: repository.url('search.dat'), store: repository.files });
        for (const f of repository.features.values())
            if (f.kind === FeatureKind.settlement && f.bounds) {
                const [x0, y1] = mercator(f.bounds[0], f.bounds[1]), [x1, y0] = mercator(f.bounds[2], f.bounds[3]);
                all.push({ url: repository.url(`areas/${f.id}.dat`), store: repository.files, zoom: 15, box: [x0, y0, x1, y1] });
            }
        const centre = mercator(...map.getCenter().toArray());
        for (const wish of all) wish.order = wish.box ? distance(centre, wish.box) : -1;
        return all.sort((a, b) => a.order - b.order || (a.zoom ?? 0) - (b.zoom ?? 0));
    }

    async function run() {
        running = true;
        do {
            again = false;
            const now = reach();
            looking = String(now);
            // Only what this browser can keep: fetched and forgotten, it would help nothing.
            const wished = wishes(now);
            const stores = [...new Set(wished.map(wish => wish.store))];
            const keeps = await Promise.all(stores.map(store => store.keeps()));
            const all = wished.filter(wish => keeps[stores.indexOf(wish.store)]);
            if (!all.length) {
                report({ state: 'unavailable' });
                break;
            }
            const kept = new Set((await Promise.all(stores.map(store => store.urls()))).flat());
            const missing = all.filter(wish => !kept.has(new URL(wish.url).href));
            let done = all.length - missing.length, failed = 0;
            report({ state: 'loading', done, total: all.length });
            const next = () => wanted && !again && failed < GIVE_UP ? missing.shift() : null;
            await Promise.all(Array.from({ length: AT_ONCE }, async () => {
                for (let wish; (wish = next());) {
                    try {
                        await wish.store.keep(wish.url);
                        report({ done: ++done });
                    } catch (error) {
                        if (++failed === GIVE_UP) console.warn('[Preload] stopped:', error);
                    }
                }
            }));
            if (!wanted) report({ state: 'off' });
            else if (failed) report({ state: 'failed' }); // the rest at the next visit, or when back online
            else if (!again && !missing.length) { had = looking; report({ state: 'done' }); }
        } while (again && wanted);
        running = false;
    }

    // Looks (again) at what to have, unless it is not wanted or not now.
    function start() {
        clearTimeout(timer);
        if (!wanted) { report({ state: 'off' }); return; }
        if (savingData()) { report({ state: 'saveData' }); return; }
        if (!drawn || !repository.mapDocument) return;
        const now = String(reach());
        if (running) again ||= now !== looking;
        else if (now !== had) run();
        else report({ state: 'done' });
    }
    const later = () => { clearTimeout(timer); timer = setTimeout(start, SETTLE); };

    return {
        add(m) {
            map = m;
            map.once('idle', () => { drawn = true; start(); });
            map.on('resize', later);
            window.addEventListener('online', start);
            navigator.connection?.addEventListener?.('change', later);
        },
        applyView(view) {
            const before = wanted;
            wanted = view.preload !== false;
            // Showing Porabje or not changes how far the map reaches.
            if (wanted !== before) start(); else later();
        },
    };
}

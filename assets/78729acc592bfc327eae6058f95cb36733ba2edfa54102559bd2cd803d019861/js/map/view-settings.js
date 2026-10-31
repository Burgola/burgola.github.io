// What the visitor chose to see on the map (the map settings menu), kept in
// this browser.
//
// Map features apply it in an optional applyView(view) (see map.js). To add
// a setting: a default here, a row in view-control.js, its text under view.*
// in the language files, and the feature that reads it.

import { load, save } from '../core/storage.js';

export const VIEW_DEFAULTS = {
    drzava: true,         // Slovenia's state border (resolved-map.js)
    obcine: true,         // municipality borders and names
    naselja: true,        // settlement borders and names
    podregije: true,      // subregions and groups of villages: their outlines and names
    mask: true,           // dim everything outside Prekmurje (and Porabje when shown)
    porabje: true,        // Porabje across the border (regions.js; check box in the top bar)
    houseNumbers: true,
    houseNames: true,     // house names (under the numbers, and before them)
    region: true,         // local names, per category (names.js CATEGORIES)
    hamlet: true,
    relief: true,
    water: true,
    field: true,
    building: true,
    places: true,         // our own places (data/mapper/place.json)
    progress: false,      // settlements shaded by how much is checked (progress.js)
    namesZoom: 0,         // zoom levels later (+) or earlier (-) local names appear
    textScale: 1,         // every label on the map (text-size.js)
    namesScale: 1,        // and on top of that our names: local, house, places
};

// The steps of the "names appear" slider, earliest to latest.
export const NAMES_ZOOM_STEPS = [-1, -0.5, 0, 0.75, 1.5, 2.5];
// The steps of the text size sliders, smallest to largest.
export const TEXT_SCALE_STEPS = [0.85, 1, 1.15, 1.3, 1.5];

const KEY = 'view';
const listeners = new Set();
let view = read();

function read() {
    try {
        const saved = JSON.parse(load(KEY) || '{}');
        const known = Object.fromEntries(Object.entries(saved).filter(([k, v]) => typeof v === typeof VIEW_DEFAULTS[k]));
        return { ...VIEW_DEFAULTS, ...known };
    } catch {
        return { ...VIEW_DEFAULTS };
    }
}

export function getView() {
    return view;
}

export function setView(changes) {
    view = { ...view, ...changes };
    save(KEY, JSON.stringify(view));
    for (const fn of listeners) fn(view);
}

export function resetView() {
    setView(VIEW_DEFAULTS);
}

export function onViewChange(fn) {
    listeners.add(fn);
}

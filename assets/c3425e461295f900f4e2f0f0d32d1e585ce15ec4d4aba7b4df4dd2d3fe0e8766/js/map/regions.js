// Porabje, the Slovene villages across the border in Hungary, next to Prekmurje: which map
// features belong to it and how much of the map is in reach with or without it. Its outline
// comes with the map data (a map area); the visitor shows or hides it with the check box next
// to the language switch (ui/porabje-toggle.js), kept as view.porabje (view-settings.js).

import { CONFIG } from '../config.js';

export const PORABJE = 'porabje';

// Whether a [longitude, latitude] point lies inside a GeoJSON (Multi)Polygon: even-odd over
// every ring, so holes count as outside.
export function contains(geometry, [x, y]) {
    if (!geometry) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    let inside = false;
    for (const polygon of polygons)
        for (const ring of polygon)
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [xi, yi] = ring[i], [xj, yj] = ring[j];
                if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
            }
    return inside;
}

// [[west, south], [east, north]] around a GeoJSON geometry.
export function boundsOf(geometry) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    const visit = value => {
        if (typeof value[0] === 'number') {
            west = Math.min(west, value[0]); east = Math.max(east, value[0]);
            south = Math.min(south, value[1]); north = Math.max(north, value[1]);
        } else value.forEach(visit);
    };
    visit(geometry.coordinates);
    return [[west, south], [east, north]];
}

const join = (a, b) => [[Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])]];
const within = ([[west, south], [east, north]], [x, y]) => x >= west && x <= east && y >= south && y <= north;

// The regions of one map document (DatDecoder: { features, areas }). `features` are the map
// document's own features: municipalities lie inside Porabje's outline, and everything else
// belongs to Porabje through its municipality, or else by where it is.
export function createRegions(document) {
    const area = document?.areas?.find(a => a.id === PORABJE) || null;
    const box = area ? boundsOf(area.boundary) : null;
    const inside = position => !!position && !!area && within(box, position) && contains(area.boundary, position);
    const municipalities = new Set();
    if (area) for (const f of document.features || []) if (f.kind === 1 && inside(f.position)) municipalities.add(f.id);
    return {
        area,
        box,
        // Whether a decoded feature belongs to Porabje.
        member(f) {
            if (!area || !f) return false;
            if (municipalities.has(f.id) || municipalities.has(f.municipalityId)) return true;
            return !f.municipalityId && inside(f.position || (f.bounds && [(f.bounds[0] + f.bounds[2]) / 2, (f.bounds[1] + f.bounds[3]) / 2]));
        },
        // The part of the map in reach: Prekmurje, and Porabje when it is shown.
        bounds(view) {
            return area && view?.porabje !== false ? join(CONFIG.regionBounds, box) : CONFIG.regionBounds;
        },
        // The outlines left undimmed by the region mask.
        holes(prekmurje, view) {
            const rings = g => !g ? [] : g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
            return [...rings(prekmurje), ...(area && view?.porabje !== false ? rings(area.boundary) : [])];
        },
    };
}

// The map's regions, each made of whole settlements, its outline theirs (computed with the map
// data): Prekmurje, the map's own, and Porabje, the Slovene villages across the border in Hungary
// next to it. They decide which map features belong to Porabje and how much of the map is in
// reach with or without it. Porabje's outline meets Prekmurje's along the border on the very same
// vertices; the visitor shows or hides it with the check box next to the language switch
// (ui/porabje-toggle.js), kept as view.porabje (view-settings.js). The map data also carries
// Slovenia's state border as a line.

import { CONFIG } from '../config.js';

// Slovenia's state border near the map, a line with Slovenia on its left (resolved-map.js).
export const BORDER = 'slovenia';
// A region of whole settlements (DatDecoder RegionType): the map's own, one next to it, a
// subregion or a group of villages. The first two are not drawn as things of their own.
export const REGION = 8;
export const isMapRegion = f => f?.kind === REGION && f.region?.type <= 1;

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
const rings = g => !g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
// Twice a ring's signed area: positive when it runs counter-clockwise.
const twice = ring => { let s = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; s += p[0] * q[1] - q[0] * p[1]; } return s; };
// MapLibre takes a ring wound like the polygon's first ring for a new polygon, not a hole: the
// mask's world runs counter-clockwise, so its holes run clockwise.
const clockwise = ring => twice(ring) < 0 ? ring : ring.slice().reverse();

// The outline of two (Multi)Polygons that meet along a stretch of border, as closed rings:
// the edges they share cancel out and the rest join up. The shared stretch has the same
// vertices on both sides; a vertex of one lying on an edge of the other splits that edge
// first. Exteriors run counter-clockwise, holes clockwise.
export function mergeOutlines(a, b) {
    const polygons = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const prepare = g => polygons(g).flatMap(polygon => polygon.map((ring, i) => {
        const open = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
        return (twice(open) > 0) === (i === 0) ? open : open.reverse();
    }));
    const [first, second] = [prepare(a), prepare(b)];
    // Vertices of the other shape, by longitude, to find those lying inside an edge.
    const split = (ringsToSplit, others) => {
        const points = others.flat().sort((p, q) => p[0] - q[0]);
        const from = x => { let lo = 0, hi = points.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid][0] < x) lo = mid + 1; else hi = mid; } return lo; };
        return ringsToSplit.map(ring => ring.flatMap((p, i) => {
            const q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dy = q[1] - p[1], length2 = dx * dx + dy * dy;
            if (!length2) return [p];
            const inside = [];
            for (let k = from(Math.min(p[0], q[0]) - 1e-9); k < points.length && points[k][0] <= Math.max(p[0], q[0]) + 1e-9; k++) {
                const v = points[k], t = ((v[0] - p[0]) * dx + (v[1] - p[1]) * dy) / length2;
                if (t <= 0 || t >= 1 || (v[0] === p[0] && v[1] === p[1]) || (v[0] === q[0] && v[1] === q[1])) continue;
                if (Math.abs((v[0] - p[0]) * dy - (v[1] - p[1]) * dx) / Math.sqrt(length2) < 1e-9) inside.push([t, v]);
            }
            return [p, ...inside.sort((x, y) => x[0] - y[0]).map(([, v]) => v)];
        }));
    };
    const key = p => `${p[0]},${p[1]}`;
    const at = new Map(), edges = new Map();
    for (const ring of [...split(first, second), ...split(second, first)])
        ring.forEach((p, i) => {
            const q = ring[(i + 1) % ring.length], from = key(p), to = key(q);
            if (from === to) return;
            at.set(from, p);
            const back = `${to}|${from}`;
            if (edges.get(back) > 0) edges.set(back, edges.get(back) - 1);
            else edges.set(`${from}|${to}`, (edges.get(`${from}|${to}`) || 0) + 1);
        });
    const next = new Map();
    for (const [edge, count] of edges) {
        const [from, to] = edge.split('|');
        for (let i = 0; i < count; i++) (next.get(from) || next.set(from, []).get(from)).push(to);
    }
    const out = [];
    for (const start of next.keys())
        while (next.get(start).length) {
            // Every vertex has as many edges out as in, so each walk comes back to its start.
            const ring = [at.get(start)];
            let current = start;
            do {
                current = next.get(current).pop();
                ring.push(at.get(current));
            } while (current !== start);
            out.push(ring);
        }
    return out;
}

// The regions of one map document (DatDecoder: { features, areas }). `features` are the map
// document's own features. A feature belongs to Porabje through its settlement or its
// municipality, or else by where it is.
export function createRegions(document) {
    const features = document?.features || [];
    const neighbours = features.filter(f => f.kind === REGION && f.region?.type === 1 && f.geometry);
    // Porabje: the regions next to Prekmurje (so far only it), with the credit for their outlines.
    const area = !neighbours.length ? null : {
        boundary: neighbours.length === 1 ? neighbours[0].geometry : { type: 'MultiPolygon', coordinates: neighbours.flatMap(n => n.geometry.type === 'Polygon' ? [n.geometry.coordinates] : n.geometry.coordinates) },
        attribution: neighbours.map(n => n.region.attribution).filter(Boolean).join(' | '),
    };
    const border = document?.areas?.find(a => a.id === BORDER)?.boundary || null;
    const box = area ? boundsOf(area.boundary) : null;
    let merged = null;
    const inside = position => !!position && !!area && within(box, position) && contains(area.boundary, position);
    const regions = new Set(neighbours.map(n => n.id)), settlements = new Set(neighbours.flatMap(n => n.members));
    const municipalities = new Set(features.filter(f => f.kind === 2 && settlements.has(f.id)).map(f => f.municipalityId));
    return {
        area,
        box,
        border,
        // Whether a decoded feature belongs to Porabje.
        member(f) {
            if (!area || !f) return false;
            if (regions.has(f.id) || settlements.has(f.id) || municipalities.has(f.id)) return true;
            if (f.settlementId) return settlements.has(f.settlementId);
            if (f.municipalityId) return municipalities.has(f.municipalityId);
            return inside(f.position || (f.bounds && [(f.bounds[0] + f.bounds[2]) / 2, (f.bounds[1] + f.bounds[3]) / 2]));
        },
        // The part of the map in reach: Prekmurje, and Porabje when it is shown.
        bounds(view) {
            return area && view?.porabje !== false ? join(CONFIG.regionBounds, box) : CONFIG.regionBounds;
        },
        // The outlines left undimmed by the region mask, clockwise: Prekmurje's, or Prekmurje and
        // Porabje as one outline, since a mask cannot have holes that touch.
        holes(prekmurje, view) {
            if (!area || view?.porabje === false) return rings(prekmurje).map(clockwise);
            if (merged?.prekmurje !== prekmurje) merged = { prekmurje, rings: mergeOutlines(prekmurje, area.boundary).map(clockwise) };
            return merged.rings;
        },
    };
}

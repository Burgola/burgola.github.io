// Drawing input belongs to an issued native session. Incomplete points are
// drafts, and are never inserted into decoded/public application records.
//
// A click near a point of a village, street or place already on the map takes exactly that point,
// and two such clicks on the same outline follow it between them (Alt draws a straight line
// instead), so that neighbouring areas meet without gaps (snapping.js).
import { getLanguage, onLanguageChange } from '../i18n/i18n.js';
import { repository } from '../data/DataRepository.js';
import { outlinesIn, nearestPoint, between } from './snapping.js';

const SNAP_PIXELS = 10;
const SNAP_KINDS = new Set([2, 3, 6]); // settlements, streets and places
const SHOWN_FROM = 14; // the snapping points show from this zoom
const MAX_SHOWN = 6000;

export function createEditorDrawing(map, selection) {
    // steps: how many points each click added, so Backspace undoes one click. first/last: the
    // outline points the first and the latest click snapped to.
    let mode = null, session = null, coordinates = [], steps = [], saved = null, first = null, last = null;
    let outlines = [], hovered = null, pending = null;
    const empty = { type: 'FeatureCollection', features: [] };
    const points = list => ({ type: 'FeatureCollection', features: list.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } })) });
    map.addSource('tb-draft', { type: 'geojson', data: empty });
    map.addSource('tb-snap', { type: 'geojson', data: empty });
    map.addSource('tb-snap-hover', { type: 'geojson', data: empty });
    map.addLayer({ id: 'tb-draft-fill', type: 'fill', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#58a6ff', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'tb-draft-line', type: 'line', source: 'tb-draft', paint: { 'line-color': '#58a6ff', 'line-width': 3, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'tb-draft-point', type: 'circle', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#58a6ff', 'circle-radius': 6 } });
    map.addLayer({ id: 'tb-snap-points', type: 'circle', source: 'tb-snap', minzoom: SHOWN_FROM, paint: { 'circle-color': '#1f6feb', 'circle-radius': 2.5, 'circle-opacity': 0.75, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });
    map.addLayer({ id: 'tb-snap-hover', type: 'circle', source: 'tb-snap-hover', paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 7, 'circle-stroke-color': '#1f6feb', 'circle-stroke-width': 2.5 } });
    const bar = document.createElement('div'); bar.className = 'tb-draw-bar'; bar.hidden = true;
    const message = document.createElement('span'), finish = document.createElement('button'), cancel = document.createElement('button');
    bar.append(message, finish, cancel); map.getContainer().append(bar);
    function overlay(value) { map.getSource('tb-draft').setData(value ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: value }] } : empty); }
    function geometry() {
        if (!coordinates.length) return null;
        return mode === 'point' ? { type: 'Point', coordinates: coordinates[0] } : mode === 'line' ? { type: 'LineString', coordinates } : { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] };
    }
    function render() {
        const valid = mode === 'point' ? coordinates.length === 1 : mode === 'line' ? coordinates.length >= 2 : coordinates.length >= 3;
        finish.disabled = !valid;
        overlay(valid ? geometry() : coordinates.length ? { type: 'LineString', coordinates: coordinates.length === 1 ? [coordinates[0], coordinates[0]] : coordinates } : null);
        message.textContent = getLanguage() === 'sl'
            ? `${coordinates.length} točk. Klik doda točko; klik ob točki sosednjega območja se pripne nanjo, dva taka klika sledita njegovi meji (z Alt ravno). Enter konča, Escape prekliče, Backspace odstrani zadnji klik.`
            : `${coordinates.length} points. Click to add one; a click by a point of a neighbouring area takes that point, and two such clicks follow its border (with Alt, straight). Enter finishes, Escape cancels, Backspace undoes the last click.`;
    }
    function translate() { const sl = getLanguage() === 'sl'; finish.textContent = sl ? 'Končaj risanje' : 'Finish drawing'; cancel.textContent = sl ? 'Prekliči risanje' : 'Cancel drawing'; if (mode) render(); }
    translate(); onLanguageChange(translate);
    // The outlines in and around the view that a click can snap to.
    function gatherOutlines() {
        if (!mode) return;
        const b = map.getBounds(), padX = (b.getEast() - b.getWest()) / 2, padY = (b.getNorth() - b.getSouth()) / 2;
        const features = [...repository.features.values()].filter(f => SNAP_KINDS.has(f.kind));
        outlines = outlinesIn(features, [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY]);
        const view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        const shown = outlines.flatMap(o => o.points).filter(p => p[0] >= view[0] && p[0] <= view[2] && p[1] >= view[1] && p[1] <= view[3]);
        map.getSource('tb-snap').setData(points(map.getZoom() >= SHOWN_FROM && shown.length <= MAX_SHOWN ? shown : []));
    }
    // The outline point within reach of a screen point, if any.
    function snapAt(at) {
        const corner = (dx, dy) => map.unproject([at.x + dx, at.y + dy]);
        const a = corner(-SNAP_PIXELS, SNAP_PIXELS), b = corner(SNAP_PIXELS, -SNAP_PIXELS);
        return nearestPoint(outlines, at, [a.lng, a.lat, b.lng, b.lat], p => map.project(p), SNAP_PIXELS);
    }
    function hover(at) {
        hovered = at ? snapAt(at) : null;
        map.getSource('tb-snap-hover').setData(points(hovered ? [hovered.point] : []));
        map.getCanvas().style.cursor = mode ? (hovered ? 'pointer' : 'crosshair') : '';
    }
    function stop(clear = true) {
        mode = null; session = null; coordinates = []; steps = []; first = last = null; outlines = [];
        bar.hidden = true; selection.setSuspended(false); map.doubleClickZoom.enable(); map.getCanvas().style.cursor = '';
        map.getSource('tb-snap').setData(empty); map.getSource('tb-snap-hover').setData(empty);
        if (clear) overlay(saved);
    }
    function progress() { globalThis.tbmapNativeGeometryProgress?.({ session, mode, coordinates }); }
    function cancelDrawing() { const token = session; stop(); if (token) globalThis.tbmapNativeGeometryProgress?.({ session: token, cancel: true }); }
    function commit() {
        if (finish.disabled || !mode) return;
        // An area ending on the outline it started on follows it back to the start.
        if (mode === 'polygon' && first && last && first.outline.key === last.outline.key && steps.length > 1) coordinates.push(...between(last.outline, last.index, first.index));
        const value = geometry(), token = session; saved = value; stop(false); globalThis.tbmapNativeGeometry?.({ session: token, geometry: value });
    }
    function start(value, token, sketch = []) {
        if (!['point', 'line', 'polygon'].includes(value) || !token) throw new Error('Invalid drawing session');
        stop(); mode = value; session = token; coordinates = structuredClone(sketch); steps = coordinates.map(() => 1); bar.hidden = false;
        selection.setSuspended(true); map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair'; gatherOutlines(); render();
    }
    map.on('click', event => {
        if (!mode) return;
        const snap = snapAt(event.point);
        let added = [[event.lngLat.lng, event.lngLat.lat]];
        if (snap) {
            const follow = last && last.outline.key === snap.outline.key && !event.originalEvent?.altKey;
            added = [...(follow ? between(snap.outline, last.index, snap.index) : []), snap.point];
        }
        if (mode === 'point') { coordinates = [added.at(-1)]; steps = [1]; }
        else {
            const previous = coordinates.at(-1);
            if (previous && previous[0] === added[0][0] && previous[1] === added[0][1]) added.shift();
            if (!added.length) return;
            coordinates.push(...added); steps.push(added.length);
        }
        if (steps.length === 1) first = snap;
        last = snap;
        render(); progress();
    });
    map.on('mousemove', event => {
        if (!mode) return;
        pending = event.point;
        requestAnimationFrame(() => { if (pending) { hover(pending); pending = null; } });
    });
    map.on('moveend', gatherOutlines);
    repository.onChange(() => gatherOutlines());
    document.addEventListener('keydown', event => {
        if (!mode) return;
        if (event.key === 'Escape') { event.preventDefault(); cancelDrawing(); }
        else if (event.key === 'Enter') { event.preventDefault(); commit(); }
        else if (event.key === 'Backspace') { event.preventDefault(); coordinates.splice(-(steps.pop() || 1)); last = null; if (!coordinates.length) first = null; render(); progress(); }
    });
    finish.addEventListener('click', commit); cancel.addEventListener('click', cancelDrawing);
    return {
        start,
        show(value, sketch = {}) { stop(false); saved = value; if (sketch?.session) start(sketch.mode, sketch.session, sketch.coordinates); else overlay(saved); },
        clear() { saved = null; stop(); },
    };
}

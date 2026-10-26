// Drawing input belongs to an issued native session. Incomplete points are
// drafts, and are never inserted into decoded/public application records.
import { getLanguage, onLanguageChange } from '../i18n/i18n.js';
export function createEditorDrawing(map, selection) {
    let mode = null, session = null, coordinates = [], saved = null;
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('tb-draft', { type: 'geojson', data: empty });
    map.addLayer({ id: 'tb-draft-fill', type: 'fill', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#58a6ff', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'tb-draft-line', type: 'line', source: 'tb-draft', paint: { 'line-color': '#58a6ff', 'line-width': 3, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'tb-draft-point', type: 'circle', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#58a6ff', 'circle-radius': 6 } });
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
        message.textContent = getLanguage() === 'sl' ? `${coordinates.length} točk. Klik doda točko; Enter konča, Escape prekliče, Backspace odstrani zadnjo.` : `${coordinates.length} points. Click to add; Enter finishes, Escape cancels, Backspace removes the last point.`;
    }
    function translate() { const sl = getLanguage() === 'sl'; finish.textContent = sl ? 'Končaj risanje' : 'Finish drawing'; cancel.textContent = sl ? 'Prekliči risanje' : 'Cancel drawing'; if (mode) render(); }
    translate(); onLanguageChange(translate);
    function stop(clear = true) { mode = null; session = null; coordinates = []; bar.hidden = true; selection.setSuspended(false); map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ''; if (clear) overlay(saved); }
    function progress() { globalThis.tbmapNativeGeometryProgress?.({ session, mode, coordinates }); }
    function cancelDrawing() { const token = session; stop(); if (token) globalThis.tbmapNativeGeometryProgress?.({ session: token, cancel: true }); }
    function commit() { if (finish.disabled || !mode) return; const value = geometry(), token = session; saved = value; stop(false); globalThis.tbmapNativeGeometry?.({ session: token, geometry: value }); }
    function start(value, token, points = []) {
        if (!['point', 'line', 'polygon'].includes(value) || !token) throw new Error('Invalid drawing session');
        stop(); mode = value; session = token; coordinates = structuredClone(points); bar.hidden = false;
        selection.setSuspended(true); map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair'; render();
    }
    map.on('click', event => { if (!mode) return; coordinates.push([event.lngLat.lng, event.lngLat.lat]); if (mode === 'point') coordinates = coordinates.slice(-1); render(); progress(); });
    document.addEventListener('keydown', event => {
        if (!mode) return;
        if (event.key === 'Escape') { event.preventDefault(); cancelDrawing(); }
        else if (event.key === 'Enter') { event.preventDefault(); commit(); }
        else if (event.key === 'Backspace') { event.preventDefault(); coordinates.pop(); render(); progress(); }
    });
    finish.addEventListener('click', commit); cancel.addEventListener('click', cancelDrawing);
    return {
        start,
        show(value, sketch = {}) { stop(false); saved = value; if (sketch?.session) start(sketch.mode, sketch.session, sketch.coordinates); else overlay(saved); },
        clear() { saved = null; stop(); },
    };
}

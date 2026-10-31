// Drawing input belongs to an issued native session. Incomplete points are
// drafts, and are never inserted into decoded/public application records.
//
// A click near a point of a village, street or place already on the map takes exactly that point,
// and two such clicks on the same outline follow it between them (Alt draws a straight line
// instead), so that neighbouring areas meet without gaps (snapping.js).
import { getLanguage, onLanguageChange } from '../i18n/i18n.js';
import { repository } from '../data/DataRepository.js';
import { LocalSiteCategory } from '../data/DatDecoder.js';
import { outlinesIn, nearestPoint, between } from './snapping.js';
import { roadNetwork, nearestRoad, guidedRoadSection, insertRoadGuide } from './road-section.js';

const SNAP_PIXELS = 10;
const SNAP_KINDS = new Set([2, 3, 6]); // settlements, streets and places
const SHOWN_FROM = 14; // the snapping points show from this zoom
const MAX_SHOWN = 6000;

export function createEditorDrawing(map, selection) {
    // steps: how many points each click added, so Backspace undoes one click. first/last: the
    // outline points the first and the latest click snapped to.
    let mode = null, session = null, coordinates = [], steps = [], saved = null, first = null, last = null;
    let outlines = [], hovered = null, pending = null;
    let roadFeatures = new Map(), roads = null, roadMessage = '';
    let roadRoute = [], roadLegs = [], roadHistory = [], roadEdit = 'guide';
    const empty = { type: 'FeatureCollection', features: [] };
    const points = list => ({ type: 'FeatureCollection', features: list.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } })) });
    map.addSource('tb-draft', { type: 'geojson', data: empty });
    map.addSource('tb-snap', { type: 'geojson', data: empty });
    map.addSource('tb-snap-hover', { type: 'geojson', data: empty });
    map.addSource('tb-draft-ends', { type: 'geojson', data: empty });
    map.addLayer({ id: 'tb-draft-fill', type: 'fill', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#58a6ff', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'tb-draft-line', type: 'line', source: 'tb-draft', paint: { 'line-color': '#58a6ff', 'line-width': 3, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'tb-draft-point', type: 'circle', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#58a6ff', 'circle-radius': 6 } });
    map.addLayer({ id: 'tb-snap-points', type: 'circle', source: 'tb-snap', minzoom: SHOWN_FROM, paint: { 'circle-color': '#1f6feb', 'circle-radius': 2.5, 'circle-opacity': 0.75, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });
    map.addLayer({ id: 'tb-snap-hover', type: 'circle', source: 'tb-snap-hover', paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 7, 'circle-stroke-color': '#1f6feb', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'tb-draft-ends', type: 'circle', source: 'tb-draft-ends', paint: { 'circle-color': ['match', ['get', 'end'], 'start', '#218c54', 'end', '#d64b40', '#337fcc'], 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'tb-draft-end-labels', type: 'symbol', source: 'tb-draft-ends', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#244666', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    const bar = document.createElement('div'); bar.className = 'tb-draw-bar'; bar.hidden = true;
    const message = document.createElement('span'), finish = document.createElement('button'), cancel = document.createElement('button'), restart = document.createElement('button');
    const guide = document.createElement('button'), moveStart = document.createElement('button'), moveEnd = document.createElement('button'), undoPoint = document.createElement('button');
    const roadButtons = [guide, moveStart, moveEnd, undoPoint];
    finish.className = 'tb-draw-finish';
    roadButtons.forEach(b => { b.hidden = true; });
    restart.hidden = true;
    bar.append(message, finish, cancel, restart, ...roadButtons); map.getContainer().append(bar);
    function endpoints(list, controls = false) {
        const sl = getLanguage() === 'sl';
        const ends = list.length ? [{ type: 'Feature', properties: { end: 'start', label: sl ? 'Začetek' : 'Start' }, geometry: { type: 'Point', coordinates: list[0] } }] : [];
        if (list.length > 1 && (list.at(-1)[0] !== list[0][0] || list.at(-1)[1] !== list[0][1])) ends.push({ type: 'Feature', properties: { end: 'end', label: sl ? 'Konec' : 'End' }, geometry: { type: 'Point', coordinates: list.at(-1) } });
        if (controls) for (let i = 1; i < list.length - 1; i++) ends.push({ type: 'Feature', properties: { end: 'via', label: String(i) }, geometry: { type: 'Point', coordinates: list[i] } });
        map.getSource('tb-draft-ends').setData({ type: 'FeatureCollection', features: ends });
    }
    function overlay(value) {
        map.getSource('tb-draft').setData(value ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: value }] } : empty);
        endpoints(value?.type === 'LineString' ? value.coordinates : []);
    }
    function geometry() {
        if (!coordinates.length) return null;
        return mode === 'point' ? { type: 'Point', coordinates: coordinates[0] } : mode === 'road' ? { type: 'LineString', coordinates: roadRoute } : mode === 'line' ? { type: 'LineString', coordinates } : { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] };
    }
    function render() {
        const valid = mode === 'point' ? coordinates.length === 1 : mode === 'road' ? roadRoute.length >= 2 : mode === 'line' ? coordinates.length >= 2 : coordinates.length >= 3;
        finish.disabled = !valid;
        finish.hidden = false; restart.hidden = mode !== 'road' || coordinates.length === 0;
        roadButtons.forEach(b => { b.hidden = mode !== 'road'; });
        guide.disabled = coordinates.length < 2; moveStart.disabled = coordinates.length === 0; moveEnd.disabled = coordinates.length < 2; undoPoint.disabled = roadHistory.length === 0;
        const sl = getLanguage() === 'sl';
        guide.title = moveEnd.title = coordinates.length < 2 ? sl ? 'Najprej izberite začetek in konec' : 'Choose a start and end first' : '';
        moveStart.title = coordinates.length ? '' : sl ? 'Najprej izberite začetek' : 'Choose a start first';
        undoPoint.title = roadHistory.length ? '' : sl ? 'Ni korakov za razveljavitev; shranjene točke so ohranjene' : 'No point edits to undo; saved points are retained';
        for (const [button, action] of [[guide, 'guide'], [moveStart, 'start'], [moveEnd, 'end']]) {
            button.setAttribute('aria-pressed', String(roadEdit === action));
            button.className = 'tb-road-choice' + (roadEdit === action ? ' active' : '');
        }
        overlay(valid ? geometry() : mode !== 'road' && coordinates.length ? { type: 'LineString', coordinates: coordinates.length === 1 ? [coordinates[0], coordinates[0]] : coordinates } : null);
        if (mode === 'road') {
            endpoints(coordinates, true);
            message.textContent = roadMessage || (getLanguage() === 'sl'
                ? !coordinates.length ? 'Kliknite začetek odseka na obstoječi cesti. Približajte zemljevid, da je cesta jasno vidna.'
                    : coordinates.length === 1 ? 'Začetek je izbran. Kliknite konec odseka. Nato lahko dodate vmesne točke.'
                    : roadEdit === 'start' ? 'Kliknite nov začetek. Vmesne točke in konec se ohranijo.'
                    : roadEdit === 'end' ? 'Kliknite nov konec. Začetek in vmesne točke se ohranijo.'
                    : `${coordinates.length - 2} vmesnih točk. Kliknite želeno cesto za dodajanje vmesne točke. Končajte izbor, nato shranite lokacijo. Backspace razveljavi zadnji korak.`
                : !coordinates.length ? 'Click the start on the existing road. Zoom in until the road is clearly visible.'
                    : coordinates.length === 1 ? 'Start selected. Click the end, then add guide points if needed.'
                    : roadEdit === 'start' ? 'Click a new start. The guides and end stay in place.'
                    : roadEdit === 'end' ? 'Click a new end. The start and guides stay in place.'
                    : `${coordinates.length - 2} guide points. Click the desired road to add a guide. Finish selection, then Save location. Backspace undoes the last step.`);
            return;
        }
        message.textContent = getLanguage() === 'sl'
            ? `${coordinates.length} točk. Klik doda točko; klik ob točki sosednjega območja se pripne nanjo, dva taka klika sledita njegovi meji (z Alt ravno). Enter konča, Escape prekliče, Backspace odstrani zadnji klik.`
            : `${coordinates.length} points. Click to add one; a click by a point of a neighbouring area takes that point, and two such clicks follow its border (with Alt, straight). Enter finishes, Escape cancels, Backspace undoes the last click.`;
    }
    function translate() {
        const sl = getLanguage() === 'sl';
        finish.textContent = mode === 'road' ? sl ? 'Končaj izbor' : 'Finish selection' : sl ? 'Končaj risanje' : 'Finish drawing';
        cancel.textContent = sl ? 'Prekliči risanje' : 'Cancel drawing'; restart.textContent = sl ? 'Začni znova' : 'Start over';
        guide.textContent = sl ? 'Dodaj vmesno točko' : 'Add guide point'; moveStart.textContent = sl ? 'Premakni začetek' : 'Move start'; moveEnd.textContent = sl ? 'Premakni konec' : 'Move end'; undoPoint.textContent = sl ? 'Razveljavi zadnji korak' : 'Undo last step';
        if (mode) render();
    }
    translate(); onLanguageChange(translate);
    // The outlines in and around the view that a click can snap to.
    function gatherOutlines() {
        if (!mode) return;
        if (mode === 'road') { gatherRoads(); return; }
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
        hovered = at ? mode === 'road' ? roadAt(at) : snapAt(at) : null;
        map.getSource('tb-snap-hover').setData(points(hovered ? [hovered.point] : []));
        map.getCanvas().style.cursor = mode ? (hovered ? 'pointer' : 'crosshair') : '';
    }
    function stop(clear = true) {
        mode = null; session = null; coordinates = []; steps = []; first = last = null; outlines = [];
        roadFeatures.clear(); roads = null; roadMessage = ''; roadRoute = []; roadLegs = []; roadHistory = []; roadEdit = 'guide'; restart.hidden = true; roadButtons.forEach(b => { b.hidden = true; });
        bar.hidden = true; selection.setSuspended(false); map.doubleClickZoom.enable(); map.getCanvas().style.cursor = '';
        map.getSource('tb-snap').setData(empty); map.getSource('tb-snap-hover').setData(empty);
        if (clear) overlay(saved);
    }
    function gatherRoads() {
        if (map.getZoom() < 14) return;
        let changed = false;
        let features = [];
        try { features = map.querySourceFeatures?.('openmaptiles', { sourceLayer: 'transportation' }) || []; } catch {}
        for (const f of repository.features.values()) if (f.kind === 6 && f.category === LocalSiteCategory.roadOrPath && f.geometry)
            features.push({ properties: { class: 'road' }, geometry: f.geometry });
        for (const f of features) {
            if (!['LineString', 'MultiLineString'].includes(f.geometry?.type)) continue;
            const key = JSON.stringify([f.properties?.class, f.properties?.layer, f.properties?.brunnel, f.geometry]);
            if (!roadFeatures.has(key) && roadFeatures.size < 20000) { roadFeatures.set(key, f); roads = null; changed = true; }
        }
        if (changed && coordinates.length >= 2) rebuildRoad();
    }
    function roadAt(at) {
        if (map.getZoom() < 14) return null;
        if (!roads) { try { roads = roadNetwork(roadFeatures.values()); } catch { return null; } }
        return nearestRoad(roads, at, p => map.project(p));
    }
    function roadResult(controls) {
        if (!roads) { try { roads = roadNetwork(roadFeatures.values()); } catch { return null; } }
        return guidedRoadSection(roads, controls, p => map.project(p));
    }
    function rebuildRoad() {
        const result = roadResult(coordinates);
        roadRoute = result?.coordinates || []; roadLegs = result?.legs || [];
        roadMessage = result ? '' : getLanguage() === 'sl' ? 'Točke so ohranjene. Prikažite ceste med njimi, da se potek lahko obnovi.' : 'Your points are retained. Show the roads between them to rebuild the route.';
        render();
    }
    function changeRoad(next, remember = true) {
        const result = roadResult(next);
        if (!result) {
            roadMessage = getLanguage() === 'sl' ? 'Točk ni mogoče povezati po naloženih cestah. Prikažite celoten odsek ali izberite drugo točko. Prejšnji izbor je ohranjen.' : 'The loaded roads do not connect these points. Show the whole section or choose another point. Your previous selection is retained.';
            render(); return false;
        }
        if (remember) { roadHistory.push(structuredClone(coordinates)); if (roadHistory.length > 100) roadHistory.shift(); }
        coordinates = next; roadRoute = result.coordinates; roadLegs = result.legs; roadEdit = 'guide'; roadMessage = '';
        render(); progress(); return true;
    }
    function undoRoad() {
        if (!roadHistory.length) return;
        coordinates = roadHistory.pop(); roadEdit = 'guide';
        rebuildRoad(); progress();
    }
    function chooseRoad(event) {
        gatherRoads();
        const hit = roadAt(event.point), sl = getLanguage() === 'sl';
        if (!hit) {
            roadMessage = map.getZoom() < 14
                ? sl ? 'Približajte zemljevid, da je cesta jasno vidna, nato kliknite nanjo.' : 'Zoom in until the road is clearly visible, then click it.'
                : sl ? 'Tukaj ni naložene ceste. Počakajte na zemljevid in kliknite neposredno na cesto; potek lahko tudi narišete ročno.' : 'No loaded road here. Wait for the map and click directly on the road, or draw the route manually.';
            render(); return;
        }
        roadMessage = '';
        let next;
        if (!coordinates.length) next = [hit.point];
        else if (coordinates.length === 1) next = [coordinates[0], hit.point];
        else if (roadEdit === 'start') { next = coordinates.slice(); next[0] = hit.point; }
        else if (roadEdit === 'end') { next = coordinates.slice(); next[next.length - 1] = hit.point; }
        else {
            if (coordinates.length >= 1000) { roadMessage = sl ? 'Dosežena je omejitev 1000 točk.' : 'The selection has reached its 1000-point limit.'; render(); return; }
            next = insertRoadGuide(coordinates, roadLegs, hit.point, p => map.project(p));
        }
        changeRoad(next);
    }
    function progress() { globalThis.tbmapNativeGeometryProgress?.({ session, mode, coordinates }); }
    function cancelDrawing() { const token = session; stop(); if (token) globalThis.tbmapNativeGeometryProgress?.({ session: token, cancel: true }); }
    function commit() {
        if (finish.disabled || !mode) return;
        const road = mode === 'road';
        // An area ending on the outline it started on follows it back to the start.
        if (mode === 'polygon' && first && last && first.outline.key === last.outline.key && steps.length > 1) coordinates.push(...between(last.outline, last.index, first.index));
        const value = geometry(), token = session; saved = value; stop(false); globalThis.tbmapNativeGeometry?.({ session: token, geometry: value });
        if (road) {
            const box = value.coordinates.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
            map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 65, maxZoom: 18, duration: 300 });
        }
    }
    function start(value, token, sketch = []) {
        if (!['point', 'line', 'polygon', 'road'].includes(value) || !token || value === 'road' && sketch.length > 1000) throw new Error('Invalid drawing session');
        stop(); mode = value; session = token; coordinates = structuredClone(sketch); steps = coordinates.map(() => 1); bar.hidden = false;
        selection.setSuspended(true); map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair'; gatherOutlines(); if (mode === 'road' && coordinates.length >= 2) rebuildRoad(); translate();
    }
    map.on('click', event => {
        if (!mode) return;
        if (mode === 'road') { chooseRoad(event); return; }
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
    map.on('idle', gatherOutlines);
    repository.onChange(() => gatherOutlines());
    document.addEventListener('keydown', event => {
        if (!mode) return;
        if (event.key === 'Escape') { event.preventDefault(); cancelDrawing(); }
        else if (event.key === 'Enter') { event.preventDefault(); commit(); }
        else if (event.key === 'Backspace') { event.preventDefault(); if (mode === 'road') { undoRoad(); return; } coordinates.splice(-(steps.pop() || 1)); last = null; if (!coordinates.length) first = null; roadMessage = ''; render(); progress(); }
    });
    finish.addEventListener('click', commit); cancel.addEventListener('click', cancelDrawing);
    restart.addEventListener('click', () => { if (mode === 'road') { changeRoad([]); return; } coordinates = []; steps = []; roadMessage = ''; render(); progress(); });
    for (const [button, action] of [[guide, 'guide'], [moveStart, 'start'], [moveEnd, 'end']]) button.addEventListener('click', () => { roadEdit = action; roadMessage = ''; render(); });
    undoPoint.addEventListener('click', undoRoad);
    return {
        start,
        show(value, sketch = {}) { stop(false); saved = value; if (sketch?.session) start(sketch.mode, sketch.session, sketch.coordinates); else overlay(saved); },
        clear() { saved = null; stop(); },
    };
}

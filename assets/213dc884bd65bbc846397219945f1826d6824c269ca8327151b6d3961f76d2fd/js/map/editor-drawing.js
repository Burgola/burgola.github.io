// Drawing input belongs to an issued native session. Incomplete points are
// drafts, and are never inserted into decoded/public application records.
//
// A click near a point of a village, street, place or building already on the map takes exactly
// that point, and two such clicks on the same outline follow it between them (Alt draws a straight
// line instead), so that neighbouring areas meet without gaps (snapping.js).
//
// An area is drawn as a rectangle (both ends of one wall, then how deep it is) or corner by
// corner, and a building's corners near a right angle are made square (shapes.js). Its corners can
// then be dragged, the middle of a wall dragged to add a corner, a corner deleted with a right
// click, the whole shape dragged to move it or, with Shift, to turn it, and Square corners squares
// them all. Backspace undoes each of these.
import { getLanguage, onLanguageChange } from '../i18n/i18n.js';
import { repository } from '../data/DataRepository.js';
import { LocalSiteCategory } from '../data/DatDecoder.js';
import { outlinesIn, nearestPoint, between } from './snapping.js';
import { roadNetwork, nearestRoad, guidedRoadSection, insertRoadGuide } from './road-section.js';
import { rectangle, squareCorner, squareCorners, centreOf, moved, turned, inside } from './shapes.js';

const SNAP_PIXELS = 10;
const HANDLE_PIXELS = 9;
const MIDDLE_FROM = 28; // a wall shows its middle, to add a corner, from this length on screen
const SNAP_KINDS = new Set([2, 3, 4, 6]); // settlements, streets, buildings and places
const SHOWN_FROM = 14; // the snapping points show from this zoom
const MAX_SHOWN = 6000;

export function createEditorDrawing(map, selection) {
    // first/last: the outline points the first and the latest click snapped to. tool: how clicks
    // draw an area ('rectangle', 'corners', or 'shape' when they only adjust it). history: the
    // drawing before each change, for Backspace.
    let mode = null, session = null, coordinates = [], saved = null, first = null, last = null;
    let building = false, feature = null, tool = 'corners', history = [], pointer = null, drag = null, swallowClick = false;
    let outlines = [], hovered = null, pending = null;
    let roadFeatures = new Map(), roads = null, roadMessage = '';
    let roadRoute = [], roadLegs = [], roadHistory = [], roadEdit = 'guide';
    const empty = { type: 'FeatureCollection', features: [] };
    const points = list => ({ type: 'FeatureCollection', features: list.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } })) });
    map.addSource('tb-draft', { type: 'geojson', data: empty });
    map.addSource('tb-snap', { type: 'geojson', data: empty });
    map.addSource('tb-snap-hover', { type: 'geojson', data: empty });
    map.addSource('tb-draft-ends', { type: 'geojson', data: empty });
    map.addSource('tb-draft-handles', { type: 'geojson', data: empty });
    map.addLayer({ id: 'tb-draft-fill', type: 'fill', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#58a6ff', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'tb-draft-line', type: 'line', source: 'tb-draft', paint: { 'line-color': '#58a6ff', 'line-width': 3, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'tb-draft-point', type: 'circle', source: 'tb-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#58a6ff', 'circle-radius': 6 } });
    map.addLayer({ id: 'tb-snap-points', type: 'circle', source: 'tb-snap', minzoom: SHOWN_FROM, paint: { 'circle-color': '#1f6feb', 'circle-radius': 2.5, 'circle-opacity': 0.75, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });
    map.addLayer({ id: 'tb-snap-hover', type: 'circle', source: 'tb-snap-hover', paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 7, 'circle-stroke-color': '#1f6feb', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'tb-draft-ends', type: 'circle', source: 'tb-draft-ends', paint: { 'circle-color': ['match', ['get', 'end'], 'start', '#218c54', 'end', '#d64b40', '#337fcc'], 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'tb-draft-end-labels', type: 'symbol', source: 'tb-draft-ends', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#244666', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    map.addLayer({ id: 'tb-draft-handles', type: 'circle', source: 'tb-draft-handles', paint: { 'circle-color': '#ffffff', 'circle-radius': ['match', ['get', 'role'], 'corner', 5.5, 3.5], 'circle-opacity': ['match', ['get', 'role'], 'corner', 1, 0.8], 'circle-stroke-color': '#1f6feb', 'circle-stroke-width': ['match', ['get', 'role'], 'corner', 2, 1.5] } });
    const bar = document.createElement('div'); bar.className = 'tb-draw-bar'; bar.hidden = true;
    const message = document.createElement('span'), finish = document.createElement('button'), cancel = document.createElement('button'), restart = document.createElement('button');
    const guide = document.createElement('button'), moveStart = document.createElement('button'), moveEnd = document.createElement('button'), undoPoint = document.createElement('button');
    const rectangleTool = document.createElement('button'), cornersTool = document.createElement('button'), shapeTool = document.createElement('button'), square = document.createElement('button');
    const roadButtons = [guide, moveStart, moveEnd], tools = [[rectangleTool, 'rectangle'], [cornersTool, 'corners'], [shapeTool, 'shape']];
    const areaButtons = [rectangleTool, cornersTool, shapeTool, square];
    finish.className = 'tb-draw-finish';
    [...roadButtons, undoPoint, ...areaButtons].forEach(b => { b.hidden = true; });
    restart.hidden = true;
    bar.append(message, finish, cancel, restart, ...roadButtons, undoPoint, ...areaButtons); map.getContainer().append(bar);
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
    // Where a click at the pointer goes: a point of a neighbouring outline within reach, or the
    // pointer itself.
    function placed(at) {
        const snap = snapAt(at.point);
        return { snap, point: snap ? snap.point : [at.lngLat.lng, at.lngLat.lat] };
    }
    // The points a click adding a corner adds: those along a neighbouring outline to the snapped
    // point, or a building's corner made square to the wall before it.
    function added(point, snap, alt) {
        if (snap && last && last.outline.key === snap.outline.key && !alt) return [...between(snap.outline, last.index, snap.index), snap.point];
        if (!snap && !alt && building && mode === 'polygon' && coordinates.length >= 2) return [squareCorner(coordinates.at(-2), coordinates.at(-1), point)];
        return [point];
    }
    // The drawing with what a click at the pointer would add, or the rectangle it would make.
    function drawn() {
        let list = coordinates;
        if (pointer && !drag && coordinates.length && (mode === 'line' || mode === 'polygon' && tool !== 'shape')) {
            const { point, snap } = placed(pointer);
            if (mode === 'polygon' && tool === 'rectangle')
                list = coordinates.length === 1 ? [coordinates[0], point] : coordinates.length === 2 ? rectangle(coordinates[0], coordinates[1], point, pointer.shift) || coordinates : coordinates;
            else list = [...coordinates, ...added(point, snap, pointer.alt)];
        }
        if (!list.length) return null;
        if (mode === 'point') return { type: 'Point', coordinates: list[0] };
        if (mode === 'polygon' && list.length >= 3) return { type: 'Polygon', coordinates: [[...list, list[0]]] };
        return { type: 'LineString', coordinates: list.length === 1 ? [list[0], list[0]] : list };
    }
    // The corners of the drawing, and the middles of walls long enough on screen to add a corner.
    function handles() {
        if (mode !== 'line' && mode !== 'polygon') return [];
        const out = coordinates.map((point, index) => ({ role: 'corner', index, point }));
        const walls = mode === 'polygon' && coordinates.length >= 3 ? coordinates.length : coordinates.length - 1;
        for (let i = 0; i < walls; i++) {
            const a = coordinates[i], b = coordinates[(i + 1) % coordinates.length], pa = map.project(a), pb = map.project(b);
            if (Math.hypot(pa.x - pb.x, pa.y - pb.y) >= MIDDLE_FROM) out.push({ role: 'middle', index: i, point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
        }
        return out;
    }
    // The corner within reach of a screen point, else the middle of a wall.
    function handleAt(at) {
        let best = null, nearest = HANDLE_PIXELS * HANDLE_PIXELS;
        for (const role of ['corner', 'middle']) {
            for (const h of handles()) {
                if (h.role !== role) continue;
                const p = map.project(h.point), d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
                if (d <= nearest) { nearest = d; best = h; }
            }
            if (best) return best;
        }
        return null;
    }
    // Whether a press at a screen point takes the whole shape, to move or turn it.
    function holdsShape(at) {
        if (mode !== 'polygon' || tool !== 'shape' || coordinates.length < 3) return false;
        const p = map.unproject([at.x, at.y]);
        return inside([p.lng, p.lat], coordinates);
    }
    function areaMessage(sl) {
        const n = coordinates.length;
        if (mode === 'polygon' && tool === 'rectangle')
            return n === 0 ? sl ? 'Pravokotnik: kliknite en vogal stene, nato njen drugi konec, nato do kod sega stavba. S Shift nastane kvadrat.' : 'Rectangle: click one corner of a wall, then its other end, then how far the building reaches. Shift makes a square.'
                : n === 1 ? sl ? 'Kliknite drugi konec stene.' : 'Click the other end of the wall.'
                : sl ? 'Pomaknite se, do kod sega stavba, in kliknite. S Shift nastane kvadrat. Backspace razveljavi.' : 'Move to where the building reaches and click. Shift makes a square. Backspace undoes.';
        if (mode === 'polygon' && tool === 'shape')
            return sl ? 'Povlecite vogal, da ga premaknete, ali sredino stene, da dodate vogal; desni klik na vogal ga izbriše. Povlecite znotraj oblike, da jo premaknete, s Shift jo zavrtite. Enter konča, Backspace razveljavi.'
                : 'Drag a corner to move it, or the middle of a wall to add a corner; right-click a corner to delete it. Drag inside the shape to move it, with Shift to turn it. Enter finishes, Backspace undoes.';
        const squaring = building && mode === 'polygon';
        return sl
            ? `${n} točk. Klik doda točko${squaring ? '; vogal blizu pravega kota postane pravi' : ''}; klik ob točki sosednjega območja ali stavbe se pripne nanjo, dva taka klika sledita njegovi meji. Z Alt gre točka točno tja, kamor kliknete. Točke lahko povlečete. Enter konča, Escape prekliče, Backspace razveljavi.`
            : `${n} points. Click to add one${squaring ? '; a corner near a right angle is made square' : ''}; a click by a point of a neighbouring area or building takes that point, and two such clicks follow its border. With Alt a point goes exactly where you click. Points can be dragged. Enter finishes, Escape cancels, Backspace undoes.`;
    }
    function render() {
        const valid = mode === 'point' ? coordinates.length === 1 : mode === 'road' ? roadRoute.length >= 2 : mode === 'line' ? coordinates.length >= 2 : coordinates.length >= 3;
        finish.disabled = !valid;
        finish.hidden = false; restart.hidden = mode === 'point' || coordinates.length === 0;
        roadButtons.forEach(b => { b.hidden = mode !== 'road'; });
        areaButtons.forEach(b => { b.hidden = mode !== 'polygon'; });
        undoPoint.hidden = mode === 'point';
        guide.disabled = coordinates.length < 2; moveStart.disabled = coordinates.length === 0; moveEnd.disabled = coordinates.length < 2;
        undoPoint.disabled = mode === 'road' ? roadHistory.length === 0 : !history.length && !coordinates.length;
        square.disabled = coordinates.length < 3;
        const sl = getLanguage() === 'sl';
        guide.title = moveEnd.title = coordinates.length < 2 ? sl ? 'Najprej izberite začetek in konec' : 'Choose a start and end first' : '';
        moveStart.title = coordinates.length ? '' : sl ? 'Najprej izberite začetek' : 'Choose a start first';
        undoPoint.title = mode !== 'road' || roadHistory.length ? '' : sl ? 'Ni korakov za razveljavitev; shranjene točke so ohranjene' : 'No point edits to undo; saved points are retained';
        for (const [button, action] of [[guide, 'guide'], [moveStart, 'start'], [moveEnd, 'end']]) {
            button.setAttribute('aria-pressed', String(roadEdit === action));
            button.className = 'tb-road-choice' + (roadEdit === action ? ' active' : '');
        }
        for (const [button, value] of tools) {
            button.setAttribute('aria-pressed', String(tool === value));
            button.className = 'tb-road-choice' + (tool === value ? ' active' : '');
        }
        if (mode === 'road') {
            overlay(valid ? geometry() : null);
            map.getSource('tb-draft-handles').setData(empty);
            endpoints(coordinates, true);
            message.textContent = roadMessage || (sl
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
        overlay(drawn());
        map.getSource('tb-draft-handles').setData({ type: 'FeatureCollection', features: handles().map(h => ({ type: 'Feature', properties: { role: h.role }, geometry: { type: 'Point', coordinates: h.point } })) });
        message.textContent = roadMessage || areaMessage(sl);
    }
    function translate() {
        const sl = getLanguage() === 'sl';
        finish.textContent = mode === 'road' ? sl ? 'Končaj izbor' : 'Finish selection' : sl ? 'Končaj risanje' : 'Finish drawing';
        cancel.textContent = sl ? 'Prekliči risanje' : 'Cancel drawing'; restart.textContent = sl ? 'Začni znova' : 'Start over';
        guide.textContent = sl ? 'Dodaj vmesno točko' : 'Add guide point'; moveStart.textContent = sl ? 'Premakni začetek' : 'Move start'; moveEnd.textContent = sl ? 'Premakni konec' : 'Move end'; undoPoint.textContent = sl ? 'Razveljavi zadnji korak' : 'Undo last step';
        rectangleTool.textContent = sl ? 'Pravokotnik' : 'Rectangle'; cornersTool.textContent = sl ? 'Vogal za vogalom' : 'Corner by corner';
        shapeTool.textContent = sl ? 'Popravljaj obliko' : 'Adjust the shape'; square.textContent = sl ? 'Pravi koti' : 'Square corners';
        if (mode) render();
    }
    translate(); onLanguageChange(translate);
    // The outlines in and around the view that a click can snap to, except the drawn feature's own.
    function gatherOutlines() {
        if (!mode) return;
        if (mode === 'road') { gatherRoads(); return; }
        const b = map.getBounds(), padX = (b.getEast() - b.getWest()) / 2, padY = (b.getNorth() - b.getSouth()) / 2;
        const features = [...repository.features.values()].filter(f => SNAP_KINDS.has(f.kind) && f.id !== feature);
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
        const grab = at && (handleAt(at) || holdsShape(at));
        map.getCanvas().style.cursor = mode ? (grab ? 'grab' : hovered ? 'pointer' : 'crosshair') : '';
    }
    function stop(clear = true) {
        mode = null; session = null; coordinates = []; first = last = null; outlines = [];
        building = false; feature = null; tool = 'corners'; history = []; pointer = null; drag = null; swallowClick = false;
        roadFeatures.clear(); roads = null; roadMessage = ''; roadRoute = []; roadLegs = []; roadHistory = []; roadEdit = 'guide'; restart.hidden = true;
        [...roadButtons, undoPoint, ...areaButtons].forEach(b => { b.hidden = true; });
        bar.hidden = true; selection.setSuspended(false); map.doubleClickZoom.enable(); map.getCanvas().style.cursor = '';
        map.getSource('tb-snap').setData(empty); map.getSource('tb-snap-hover').setData(empty); map.getSource('tb-draft-handles').setData(empty);
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
    // Points, lines and areas keep the drawing before each change.
    function remember() {
        history.push({ coordinates: structuredClone(coordinates), first, last, tool });
        if (history.length > 200) history.shift();
    }
    function undoShape() {
        const previous = history.pop();
        if (previous) ({ coordinates, first, last, tool } = previous);
        else if (coordinates.length) { coordinates.pop(); last = null; if (!coordinates.length) first = null; }
        else return;
        roadMessage = ''; render(); progress();
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
        if (mode === 'polygon' && first && last && first !== last && first.outline.key === last.outline.key) coordinates.push(...between(last.outline, last.index, first.index));
        const value = geometry(), token = session; saved = value; stop(false); globalThis.tbmapNativeGeometry?.({ session: token, geometry: value });
        if (road) {
            const box = value.coordinates.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
            map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 65, maxZoom: 18, duration: 300 });
        }
    }
    // A building's area starts as a rectangle; an area already drawn starts ready to adjust.
    const startingTool = () => mode === 'polygon' && coordinates.length >= 3 ? 'shape' : mode === 'polygon' && building ? 'rectangle' : 'corners';
    function start(value, token, sketch = [], options = {}) {
        if (!['point', 'line', 'polygon', 'road'].includes(value) || !token || value === 'road' && sketch.length > 1000) throw new Error('Invalid drawing session');
        stop(); mode = value; session = token; coordinates = structuredClone(sketch || []); bar.hidden = false;
        building = !!options?.building; feature = options?.feature || null; tool = startingTool();
        selection.setSuspended(true); map.doubleClickZoom.disable(); map.getCanvas().style.cursor = 'crosshair'; gatherOutlines(); if (mode === 'road' && coordinates.length >= 2) rebuildRoad(); translate();
    }
    const pointerOf = event => ({ point: event.point, lngLat: event.lngLat, alt: !!event.originalEvent?.altKey, shift: !!event.originalEvent?.shiftKey });
    map.on('click', event => {
        if (!mode) return;
        if (mode === 'road') { chooseRoad(event); return; }
        if (swallowClick) { swallowClick = false; return; }
        if (mode === 'polygon' && tool === 'shape') return;
        const at = pointerOf(event), { point, snap } = placed(at);
        roadMessage = '';
        if (mode === 'polygon' && tool === 'rectangle') {
            if (coordinates.length >= 2) {
                const shape = rectangle(coordinates[0], coordinates[1], point, at.shift);
                if (!shape) return;
                remember(); coordinates = shape; tool = 'shape';
            } else {
                const previous = coordinates.at(-1);
                if (previous && previous[0] === point[0] && previous[1] === point[1]) return;
                remember(); coordinates.push(point);
            }
            first = last = null;
            render(); progress(); return;
        }
        if (mode === 'point') { remember(); coordinates = [point]; first = last = snap; render(); progress(); return; }
        let list = added(point, snap, at.alt);
        const previous = coordinates.at(-1);
        if (previous && previous[0] === list[0][0] && previous[1] === list[0][1]) list = list.slice(1);
        if (!list.length) return;
        remember();
        if (!coordinates.length) first = snap;
        coordinates.push(...list);
        last = snap;
        render(); progress();
    });
    // A press on a corner or a wall's middle drags it; a press inside a finished shape moves it, or
    // turns it with Shift. The map does not pan meanwhile.
    map.on('mousedown', event => {
        swallowClick = false;
        if (!mode || mode === 'road' || mode === 'point' || (event.originalEvent?.button ?? 0) !== 0) return;
        const handle = handleAt(event.point);
        if (!handle && !holdsShape(event.point)) return;
        event.preventDefault?.();
        swallowClick = true;
        remember();
        if (handle?.role === 'middle') { coordinates.splice(handle.index + 1, 0, handle.point); drag = { corner: handle.index + 1 }; }
        else if (handle) drag = { corner: handle.index };
        else drag = { from: [event.lngLat.lng, event.lngLat.lat], base: structuredClone(coordinates), turn: !!event.originalEvent?.shiftKey };
        first = last = null;
        map.getCanvas().style.cursor = 'grabbing';
        render();
    });
    function dragTo(at) {
        const point = [at.lngLat.lng, at.lngLat.lat];
        if (drag.corner !== undefined) { const snap = at.alt ? null : snapAt(at.point); coordinates[drag.corner] = snap ? snap.point : point; }
        else coordinates = drag.turn ? turned(drag.base, centreOf(drag.base), drag.from, point) : moved(drag.base, drag.from, point);
        drag.moved = true;
        render();
    }
    function endDrag() {
        if (!drag) return;
        const done = drag; drag = null;
        // A press that did not move changes nothing.
        if (!done.moved) ({ coordinates, first, last, tool } = history.pop());
        map.getCanvas().style.cursor = 'crosshair';
        render(); if (done.moved) progress();
    }
    map.on('mouseup', endDrag);
    map.on('mousemove', event => {
        if (!mode) return;
        pending = pointerOf(event);
        requestAnimationFrame(() => {
            if (!pending) return;
            const at = pending; pending = null;
            if (drag) { dragTo(at); return; }
            hover(at.point);
            if (mode !== 'road') { pointer = at; render(); }
        });
    });
    map.on('mouseout', () => { if (mode && mode !== 'road' && pointer && !drag) { pointer = null; render(); } });
    // A right click on a corner deletes it.
    map.on('contextmenu', event => {
        if (!mode || mode === 'road' || mode === 'point') return;
        const handle = handleAt(event.point);
        if (handle?.role !== 'corner') return;
        event.preventDefault?.(); event.originalEvent?.preventDefault?.();
        remember(); coordinates.splice(handle.index, 1); first = last = null;
        render(); progress();
    });
    map.on('moveend', gatherOutlines);
    map.on('idle', gatherOutlines);
    repository.onChange(() => gatherOutlines());
    document.addEventListener('keydown', event => {
        if (!mode) return;
        if (event.key === 'Escape') { event.preventDefault(); cancelDrawing(); }
        else if (event.key === 'Enter') { event.preventDefault(); commit(); }
        else if (event.key === 'Backspace') { event.preventDefault(); if (mode === 'road') undoRoad(); else undoShape(); }
    });
    document.addEventListener('mouseup', endDrag);
    finish.addEventListener('click', commit); cancel.addEventListener('click', cancelDrawing);
    restart.addEventListener('click', () => {
        if (mode === 'road') { changeRoad([]); return; }
        remember(); coordinates = []; first = last = null; tool = startingTool(); roadMessage = ''; render(); progress();
    });
    for (const [button, action] of [[guide, 'guide'], [moveStart, 'start'], [moveEnd, 'end']]) button.addEventListener('click', () => { roadEdit = action; roadMessage = ''; render(); });
    undoPoint.addEventListener('click', () => { if (mode === 'road') undoRoad(); else undoShape(); });
    // Rectangle starts a new one from the wall clicked so far, or anew; the other tools keep the shape.
    for (const [button, value] of tools) button.addEventListener('click', () => {
        if (tool === value) return;
        remember();
        if (value === 'rectangle' && coordinates.length >= 3) { coordinates = []; first = last = null; }
        tool = value; roadMessage = ''; render(); progress();
    });
    square.addEventListener('click', () => {
        const squared = squareCorners(coordinates);
        if (!squared) {
            roadMessage = getLanguage() === 'sl' ? 'Ta oblika nima dovolj sten za prave kote.' : 'This shape has too few walls for square corners.';
            render(); return;
        }
        remember(); coordinates = squared; first = last = null; roadMessage = ''; render(); progress();
    });
    return {
        start,
        show(value, sketch = {}) { stop(false); saved = value; if (sketch?.session) start(sketch.mode, sketch.session, sketch.coordinates, { building: sketch.building, feature: sketch.feature }); else overlay(saved); },
        clear() { saved = null; stop(); },
    };
}

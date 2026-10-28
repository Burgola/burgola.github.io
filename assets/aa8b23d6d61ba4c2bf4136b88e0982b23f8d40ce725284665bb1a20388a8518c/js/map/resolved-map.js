import { repository, title, primaryName } from '../data/DataRepository.js';
import { getLanguage, t } from '../i18n/i18n.js';
import { createRegions, contains, isMapRegion, REGION } from './regions.js';

const empty = () => ({ type: 'FeatureCollection', features: [] });
const collection = features => ({ type: 'FeatureCollection', features });
const geo = (geometry, properties) => ({ type: 'Feature', geometry, properties });
const point = coordinates => ({ type: 'Point', coordinates });
const labels = { en: ['Municipality', 'Settlement', 'Street', 'Building', 'House', 'Place', 'Group'], sl: ['Občina', 'Naselje', 'Ulica', 'Stavba', 'Hiša', 'Kraj', 'Skupina'] };
// A region of whole settlements, by its type: the map's own, one next to it, a subregion or a
// group of villages.
const regionLabels = { en: ['Region', 'Region', 'Subregion', 'Group of villages'], sl: ['Regija', 'Regija', 'Podregija', 'Skupina vasi'] };
const words = {
    en: { name: 'Name', inherited: 'Inherited from target', gurs: 'GURS name', local: 'Missing from GURS', sourceAbsent: 'Absent from current GURS release', unreviewed: 'Unreviewed', confirmed: 'Confirmed', uncertain: 'Uncertain', disputed: 'Disputed', rejected: 'Rejected', unreadable: 'Unreadable', stale: 'Needs recheck', language: 'Language', role: 'Role', target: 'Named feature', settlement: 'Settlement', municipality: 'Municipality', address: 'Address', postal: 'Post office', community: 'Local community', school: 'School district', unit: 'Administrative unit', building: 'Building', cadastral: 'Cadastral municipality', year: 'Year built', floors: 'Floors', dwellings: 'Dwellings', businesses: 'Business premises', historic: 'Historical', current: 'Current', unknown: 'Unknown', existence: 'Existence', place: 'Place', search: 'Search places, addresses and names…', noResults: 'No results', searchError: 'Search failed. Try again.', loadError: 'Could not load local map data', kindOf: 'Kind', reviewScope: 'Name text review', locationScope: 'Location review', oldNumbers: 'Historical house numbers', preferred: 'Preferred', alternative: 'Alternative', searchLoading: 'Loading search…' },
    sl: { name: 'Ime', inherited: 'Podedovano od cilja', gurs: 'Ime GURS', local: 'Manjka v GURS', sourceAbsent: 'Ni v trenutni izdaji GURS', unreviewed: 'Še ni preverjeno', confirmed: 'Potrjeno', uncertain: 'Negotovo', disputed: 'Sporno', rejected: 'Zavrnjeno', unreadable: 'Nečitljivo', stale: 'Potreben ponovni pregled', language: 'Jezik', role: 'Vloga', target: 'Poimenovani objekt', settlement: 'Naselje', municipality: 'Občina', address: 'Naslov', postal: 'Pošta', community: 'Krajevna skupnost', school: 'Šolski okoliš', unit: 'Upravna enota', building: 'Stavba', cadastral: 'Katastrska občina', year: 'Leto gradnje', floors: 'Etaže', dwellings: 'Stanovanja', businesses: 'Poslovni prostori', historic: 'Zgodovinsko', current: 'Sedanje', unknown: 'Neznano', existence: 'Obstoj', place: 'Kraj', search: 'Iščite kraje, hiše in imena …', noResults: 'Ni zadetkov', searchError: 'Iskanje ni uspelo. Poskusite znova.', loadError: 'Podatkov zemljevida ni bilo mogoče naložiti', kindOf: 'Vrsta', reviewScope: 'Pregled besedila imena', locationScope: 'Pregled lokacije', oldNumbers: 'Stare hišne številke', preferred: 'Prednostno', alternative: 'Drugo ime', searchLoading: 'Nalaganje iskanja …' },
};
const tr = key => (words[getLanguage()] || words.en)[key] || key;
const kindName = f => f.kind === REGION ? (regionLabels[getLanguage()] || regionLabels.en)[f.region?.type ?? 2] : (labels[getLanguage()] || labels.en)[f.kind - 1];
const status = review => review.stale ? tr('stale') : tr(['unreviewed', 'confirmed', 'uncertain', 'disputed', 'rejected', 'unreadable'][review.outcome]);
const sourceStatus = source => source === 0 ? tr('local') : source === 2 ? tr('sourceAbsent') : source === 3 ? (getLanguage() === 'sl' ? 'Pokritost vira ni na voljo' : 'Source coverage unavailable') : 'GURS';
const category = f => f.kind === REGION ? 'subregion' : f.kind === 4 || f.kind === 5 || f.category >= 1200 && f.category < 1300 ? 'building' : f.category >= 2100 && f.category < 2300 ? 'water' : f.category >= 3100 && f.category < 3200 ? 'relief' : f.category >= 1100 && f.category < 1200 ? 'hamlet' : f.category === 4102 ? 'region' : f.category >= 4100 && f.category < 4300 ? 'field' : 'other';
const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
// The selected thing's own label and point are hidden: its selected label takes their place.
// (A feature state, so selecting redraws nothing else.)
const LABEL_SOURCES = ['tb-labels', 'tb-addresses'];
const UNLESS_SELECTED = ['case', ['boolean', ['feature-state', 'selected'], false], 0, 1];
// The state border's colours on the map and over the aerial photo.
const STATE_BORDER = { map: { band: '#a8578f', line: '#5e2450' }, aerial: { band: '#ff6fc8', line: '#ffffff' } };
// Subregions and groups of villages, on the map and over the aerial photo.
const REGION_COLOURS = { map: { subregion: '#5d7a35', group: '#9a6532', text: '#4f6a2c' }, aerial: { subregion: '#d6f5a0', group: '#ffd29a', text: '#ffffff' } };
// An area (a place drawn as an area, a subregion, a group of villages) shows from the zoom where
// it is AREA_PIXELS across, until it is many screens wide. MapLibre's world is 512 px wide at
// zoom 0.
const AREA_PIXELS = 120;
const mercatorY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI);
export function areaZooms([west, south, east, north]) {
    const across = Math.max((east - west) / 360, mercatorY(north) - mercatorY(south));
    const min = across > 0 ? Math.max(0, Math.log2(AREA_PIXELS / (512 * across))) : 16;
    return { min, max: min + 6 };
}
// Places show a dot under their name from this zoom.
const DOTS_FROM = 15;
// A house has one label and no dot: its name from HOUSE_NAMES_FROM, and from NUMBERS_FROM its
// number with the name under it.
const HOUSE_NAMES_FROM = 15.5, NUMBERS_FROM = 16.5;
const houseText = (far, near) => ['step', ['zoom'], far, NUMBERS_FROM, near];
const formatted = value => ['format', value, {}];
const HOUSE_FAR = ['case', ['!=', ['get', 'name'], ''], formatted(['get', 'name']), formatted(['get', 'number'])];
const HOUSE_NEAR = ['case', ['==', ['get', 'name'], ''], formatted(['get', 'number']), ['==', ['get', 'number'], ''], formatted(['get', 'name']), ['format', ['get', 'number'], { 'font-scale': 0.9 }, '\n', {}, ['get', 'name'], {}]];
const isArea = f => f.bounds && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
export function createResolvedMap(selection) {
    let map, mode = 'map', language = getLanguage(), view = {}, selected = null, beforeId;
    let renderQueued = false, disposed = false, searchRoot, progressLegend;
    const layerIds = [], loadErrors = new Map();
    let regions = createRegions(null), regionsDocument = null, shownBorder = null;
    let houses = new Map(); // building id -> the houses (addresses) in it
    let towns = new Map();  // municipality id -> its settlements
    let regionsOf = new Map(); // settlement id -> the subregions and groups of villages it is in
    let pickingTowns = false; // the editor is choosing a region's villages
    let marked = null;      // the feature whose own label is hidden while it is selected
    // The zooms where something drawn appears or goes (its min or max), and how many of them the
    // filters were last set below: zooming only sets them again on crossing one (applyVisibility).
    let breaks = [], appliedBreaks = -1;
    // Which features belong to Porabje, for the map document now loaded.
    function region() {
        if (regionsDocument !== repository.mapDocument) { regionsDocument = repository.mapDocument; regions = createRegions(regionsDocument); }
        return regions;
    }
    // Porabje's features are left out while the visitor hides Porabje.
    const shown = f => view.porabje !== false || !region().member(f);
    function setMask() {
        const holes = region().holes(repository.mapDocument?.boundary, view);
        map.getSource('tb-mask')?.setData(holes.length ? collection([geo({ type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes] }, {})]) : empty());
    }
    const feature = id => repository.features.get(id) || repository.searchFeatures.get(id);
    const featureTitle = f => f ? title(f, language) : '—';
    const relation = (label, id) => ({ label, value: featureTitle(feature(id)), select: { kind: 'feature', id } });
    function error(error) {
        console.error('[TBMap data]', error);
        const el = document.getElementById('map-message');
        el.hidden = false;
        el.querySelector('strong').textContent = tr('loadError');
        el.querySelector('span').textContent = getLanguage() === 'sl' ? 'Poskusite znova naložiti stran za trenutno objavljeno izdajo.' : 'Reload the page to load the current published map.';
        if (!el.querySelector('button')) {
            const reload = document.createElement('button'); reload.textContent = getLanguage() === 'sl' ? 'Znova naloži' : 'Reload';
            reload.addEventListener('click', () => location.reload()); el.append(reload);
        }
    }
    // A house zooms to its building.
    function bounds(f) { const b = buildingOf(f)?.bounds || f.bounds; return b ? [[b[0], b[1]], [b[2], b[3]]] : f.position ? [f.position, f.position] : null; }
    function renderProgressLegend() {
        if (!progressLegend) return;
        progressLegend.replaceChildren();
        const heading = document.createElement('div'); heading.className = 'progress-legend-title'; heading.textContent = t('progress.title');
        const bar = document.createElement('div'); bar.className = 'progress-legend-bar'; bar.style.background = 'linear-gradient(to right,#d93025,#f2b705,#1e8e3e)';
        const ends = document.createElement('div'); ends.className = 'progress-legend-ends';
        for (const key of ['progress.none', 'progress.half', 'progress.all']) { const span = document.createElement('span'); span.textContent = t(key); ends.append(span); }
        const note = document.createElement('div'); note.className = 'progress-legend-note'; note.textContent = t('progress.what');
        progressLegend.append(heading, bar, ends, note);
    }
    function nameRows(names, targetId) {
        return names.map(n => ({ label: `${n.language.toUpperCase()} · ${tr(n.role === 2 || !n.current ? 'historic' : n.role === 1 ? 'alternative' : 'name')}`, value: n.text, badge: { text: status(n.textReview), tone: !n.textReview.stale && n.textReview.outcome === 1 ? 'confirmed' : 'gov' }, ...(n.subjectId !== targetId ? { select: { kind: 'feature', id: n.subjectId } } : {}) }));
    }
    function describe(f, name = null) {
        const names = name ? [name] : f.names;
        const rows = nameRows(names, f.id);
        rows.push({ label: 'GURS', value: sourceStatus(name?.source ?? f.source) });
        for (const n of names) if (n.official && n.official !== n.text) rows.push({ label: `${tr('gurs')} · ${n.language.toUpperCase()}`, value: n.official });
        if (name) rows.push(relation(tr('target'), f.id), { label: tr('reviewScope'), value: status(name.textReview) }, { label: getLanguage() === 'sl' ? 'Pregled povezave' : 'Attachment review', value: status(name.attachmentReview) });
        if (f.kind === 6 && f.category) rows.push({ label: tr('kindOf'), value: t(`names.type.${f.category}`) === `names.type.${f.category}` ? t('names.type.other') : t(`names.type.${f.category}`) });
        if (f.settlementId && f.settlementId !== f.id) rows.push(relation(tr('settlement'), f.settlementId));
        if (f.municipalityId && f.municipalityId !== f.id) rows.push(relation(tr('municipality'), f.municipalityId));
        // A village's subregions and groups; a municipality's and a region's villages.
        for (const region of regionsOf.get(f.id) || []) rows.push(relation(kindName(region), region.id));
        for (const town of townsOf(f)) rows.push(relation(tr('settlement'), town.id));
        const a = f.address;
        if (a) {
            const street = a.streetId ? featureTitle(feature(a.streetId)) : featureTitle(feature(a.settlementId));
            rows.push({ label: tr('address'), value: `${street} ${a.number ?? '?'}${a.suffix}` });
            if (a.buildingId) rows.push(relation(tr('building'), a.buildingId));
            // Other houses in the same building.
            if (a.buildingId) for (const other of housesOf(a.buildingId)) if (other.id !== f.id) rows.push(relation(tr('address'), other.id));
            rows.push({ label: tr('postal'), value: `${a.postalCode} ${a.postalName}`.trim() }, { label: tr('community'), value: a.community }, { label: tr('school'), value: a.schoolDistrict }, { label: tr('unit'), value: a.administrativeUnit });
        }
        // A house shows its building's figures too.
        const building = f.building ? f : buildingOf(f), b = building?.building;
        if (b) rows.push({ label: tr('cadastral'), value: `${b.cadastralCode} ${b.cadastralName}`.trim() }, ...(building === f ? [{ label: tr('building'), value: b.number }] : []), { label: tr('year'), value: b.year }, { label: tr('floors'), value: b.floors }, { label: tr('dwellings'), value: b.dwellings }, { label: tr('businesses'), value: b.businessPremises });
        rows.push({ label: tr('existence'), value: tr(['unknown', 'current', 'historic'][f.existence]) }, { label: tr('locationScope'), value: status(f.locationReview) });
        // Headed by what the place is (a settlement, a house…), also when one of its names was clicked.
        return { kind: kindName(f), title: name?.text || featureTitle(f), note: name?.notes || f.notes, rows, sections: f.oldNumbers.length ? [{ title: tr('oldNumbers'), rows: f.oldNumbers.map(n => ({ label: n.period || tr('unknown'), value: `${n.number}${n.settlement ? `, ${n.settlement}` : ''}` })) }] : [] };
    }
    // A municipality's or a region's settlements, by name.
    const townsOf = f => (f.kind === 1 ? towns.get(f.id) || [] : f.kind === REGION ? f.members.map(feature).filter(Boolean) : []).slice().sort((a, b) => featureTitle(a).localeCompare(featureTitle(b)));
    // The building a house (an address) stands in, when it is loaded.
    const buildingOf = f => f?.address?.buildingId ? feature(f.address.buildingId) || null : null;
    // The houses in a building, by number.
    const byNumber = (a, b) => (a.address.number ?? Infinity) - (b.address.number ?? Infinity) || a.address.suffix.localeCompare(b.address.suffix);
    const housesOf = id => (houses.get(id) || []).slice().sort(byNumber);
    // A house is one thing: its building, the building's name and its number all select the
    // house (the first, where a building has several). Also for data loaded since the last render.
    const houseOf = f => f?.kind !== 4 ? null : housesOf(f.id)[0] || [...repository.features.values()].filter(h => h.kind === 5 && h.address?.buildingId === f.id && shown(h)).sort(byNumber)[0] || null;
    const isHouse = id => { const f = feature(id); return f?.kind === 5 || !!houseOf(f); };
    // What a house's one label says: the name it shows (its own or its building's) and its number.
    const houseLabel = (f, name = null) => ({
        house: true,
        name: view.houseNames === false || view.building === false ? '' : (name || primaryName(f, language))?.text || '',
        number: view.houseNumbers === false || f.address?.number == null ? '' : `${f.address.number}${f.address.suffix}`,
    });
    function highlight(f, name = null) {
        selected = f ? { feature: f, name } : null;
        const targets = f?.kind === 7 ? f.members.map(id => feature(id)).filter(Boolean) : f ? [f] : [];
        // A house is drawn with its building.
        if (buildingOf(f)) targets.push(buildingOf(f));
        const shapes = targets.filter(t => t.geometry && t.geometry.type !== 'Point').map(t => geo(t.geometry, {}));
        if (f) for (const town of townsOf(f)) if (town.geometry) shapes.push(geo(town.geometry, { inner: true }));
        // Its own label is hidden (markSelected) and drawn here instead. A house's says what its
        // label says, its name and its number, without a dot.
        const house = f?.kind === 4 || f?.kind === 5;
        const text = (name || (f ? primaryName(f, language) : null))?.text;
        // The marker is the selected thing to a click as well (markAt): clicking it again unselects it.
        const own = { id: f?.id, use: house ? '' : name?.id || '', kind: f?.kind };
        const markers = f?.position ? [geo(point(f.position), house ? { ...own, house, name: text || '', number: f.address?.number == null ? '' : `${f.address.number}${f.address.suffix}` } : { ...own, label: text || featureTitle(f) })] : [];
        if (f?.kind === 7) for (const target of targets) if (target.position && target.geometry?.type === 'Point') markers.push(geo(point(target.position), {}));
        map.getSource('tb-selected-shape')?.setData(collection(shapes));
        map.getSource('tb-selected-point')?.setData(collection(markers));
        markSelected(f?.id || null);
    }
    function markSelected(id) {
        if (id === marked) return;
        for (const source of LABEL_SOURCES) {
            if (marked) map.setFeatureState({ source, id: marked }, { selected: false });
            if (id) map.setFeatureState({ source, id }, { selected: true });
        }
        marked = id;
    }
    function layer(value) { map.addLayer(value, beforeId); layerIds.push(value.id); }
    function queueRender() { if (renderQueued || disposed) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
    function render() {
        if (!map?.getSource('tb-labels')) return;
        const shapes = [], labelFeatures = [], numbers = [];
        houses = new Map(); towns = new Map(); regionsOf = new Map();
        const add = (index, key, value) => (index.get(key) || index.set(key, []).get(key)).push(value);
        for (const f of repository.features.values()) {
            // The map's own regions only decide what the map covers (regions.js).
            if (!shown(f) || isMapRegion(f)) continue;
            if (f.kind === 5 && f.address?.buildingId) add(houses, f.address.buildingId, f);
            if (f.kind === 2 && f.municipalityId) add(towns, f.municipalityId, f);
            if (f.kind === REGION) for (const id of f.members) add(regionsOf, id, f);
            const area = f.kind >= 6 && isArea(f) ? areaZooms(f.bounds) : null;
            if (f.geometry && f.geometry.type !== 'Point') shapes.push(geo(f.geometry, { id: f.id, kind: f.kind, type: f.region?.type ?? -1, category: category(f), local: f.source === 0, min: area?.min ?? (f.kind >= 6 ? 12 : 0), max: f.kind === REGION ? area?.max ?? 0 : 24 }));
            if (!f.position) continue;
            const name = primaryName(f, language);
            const ownName = name?.subjectId === f.id ? name : null;
            // A house is labelled once, by houseLabel below: its name (its own or its building's)
            // and its number. Its name never stands apart as a place with a dot.
            if (f.kind === 4 || f.kind === 5) continue;
            if (f.kind <= 3 || ownName) {
                const cat = category(f);
                let min = f.kind === 1 ? 8 : f.kind === 2 ? 11 : f.kind === 3 ? 14 : cat === 'building' ? 15.5 : cat === 'region' ? 9 : 14, max = f.kind === 1 ? 11 : f.kind === 2 ? 16 : 24;
                // An area's name shows while the area itself does.
                if (area) [min, max] = [area.min, f.kind === REGION ? area.max : 24];
                labelFeatures.push(geo(point(f.position), { id: f.id, use: ownName?.id || '', kind: f.kind, category: cat, local: f.source === 0, area: !!area, label: featureTitle(f), min: min + (f.kind > 3 && f.kind !== REGION ? view.namesZoom || 0 : 0), max, reviewed: !!name && !name.textReview.stale && name.textReview.outcome === 1 }));
            }
        }
        for (const f of repository.features.values()) {
            // A building with houses is labelled by its houses; one without, by its own name.
            if (!f.position || !shown(f) || !(f.kind === 5 || f.kind === 4 && !houses.has(f.id))) continue;
            const label = houseLabel(f);
            if (label.name || label.number) numbers.push(geo(point(f.position), { id: f.id, ...label, min: label.name ? HOUSE_NAMES_FROM + (view.namesZoom || 0) : NUMBERS_FROM, max: 24 }));
        }
            map.getSource('tb-shapes').setData(collection(shapes));map.getSource('tb-labels').setData(collection(labelFeatures));map.getSource('tb-addresses').setData(collection(numbers));
        breaks = [...new Set([...shapes, ...labelFeatures, ...numbers].flatMap(f => [f.properties.min, f.properties.max]))].sort((a, b) => a - b);
        // A settlement without houses has nothing to name and is left unshaded.
        const settlements = [...repository.features.values()].filter(f => f.kind === 2 && f.progress.total && shown(f));
        const progress = f => ({ p: f.progress.total ? f.progress.done / f.progress.total : 0, label: `${f.progress.total ? Math.floor(f.progress.done / f.progress.total * 100) : 0} % · ${f.progress.done}/${f.progress.total}` });
        map.getSource('tb-progress').setData(collection(settlements.filter(f => f.geometry).map(f => geo(f.geometry, progress(f)))));
        map.getSource('tb-progress-labels').setData(collection(settlements.filter(f => f.position).map(f => geo(point(f.position), progress(f)))));
        if (selected) { const f = feature(selected.feature.id); highlight(f || null, selected.name ? repository.names.get(selected.name.id) : null); }
        setMask();
        const border = region().border;
        if (border !== shownBorder) { shownBorder = border; map.getSource('tb-state-border').setData(border ? collection([geo(border, {})]) : empty()); }
        applyVisibility(true);
    }
    // The filters hold the zoom as a number, and setting one makes MapLibre lay out its source
    // again: while zooming that is done only where what is shown changes, not on every frame.
    function applyVisibility(force = false) {
        if (!map?.getLayer('tb-names')) return;
        const zoom = map.getZoom(), passed = breaks.filter(b => b <= zoom).length;
        if (!force && passed === appliedBreaks) return;
        appliedBreaks = passed;
        const visible = f => ['all', ['<=', ['get', 'min'], zoom], ['>', ['get', 'max'], zoom], f];
        const categoryFilters = ['all', ['>', ['get', 'kind'], 3], ['!=', ['get', 'kind'], REGION]];
        for (const key of ['region', 'hamlet', 'relief', 'water', 'field', 'building']) if (view[key] === false) categoryFilters.push(['!=', ['get', 'category'], key]);
        if (view.places === false) categoryFilters.push(['!=', ['get', 'local'], true]);
        if (view.houseNames === false) categoryFilters.push(['!=', ['get', 'category'], 'building']);
        map.setFilter('tb-names', visible(categoryFilters));
        map.setFilter('tb-name-points', visible([...categoryFilters, ['!', ['boolean', ['get', 'area'], false]]]));
        map.setFilter('tb-admin-labels', visible(['any', ['all', ['==', ['get', 'kind'], 1], view.obcine !== false], ['all', ['==', ['get', 'kind'], 2], view.naselja !== false], ['==', ['get', 'kind'], 3]]));
        for (const id of ['tb-region-labels', 'tb-region-lines']) map.setFilter(id, visible(['all', ['==', ['get', 'kind'], REGION], view.podregije !== false]));
        // Which of a house's name and number it shows is decided in its label (houseLabel).
        map.setFilter('tb-address-labels', visible(['literal', true]));
        map.setLayoutProperty('tb-municipal-lines', 'visibility', view.obcine === false ? 'none' : 'visible');
        map.setLayoutProperty('tb-settlement-lines', 'visibility', view.naselja === false ? 'none' : 'visible');
        map.setLayoutProperty('tb-region-mask', 'visibility', view.mask === false ? 'none' : 'visible');
        for (const id of ['tb-state-band', 'tb-state-line']) map.setLayoutProperty(id, 'visibility', view.drzava === false ? 'none' : 'visible');
        for (const id of ['tb-progress-fill', 'tb-progress-labels']) map.setLayoutProperty(id, 'visibility', view.progress ? 'visible' : 'none');
        if (progressLegend) progressLegend.hidden = !view.progress;
        const placeFilter = ['all', ['>=', ['get', 'kind'], 6], ['<', ['get', 'kind'], REGION]];
        if (view.places === false) placeFilter.push(['!=', ['get', 'local'], true]);
        for (const key of ['region', 'hamlet', 'relief', 'water', 'field', 'building']) if (view[key] === false) placeFilter.push(['!=', ['get', 'category'], key]);
        for (const id of ['tb-place-fill', 'tb-place-lines']) map.setFilter(id, visible(placeFilter));
    }
    async function loadVisible() {
        const generation = repository.generation;
        if (map.getZoom() < 15 + Math.min(0, view.namesZoom || 0)) return;
        const box = map.getBounds();
        const settlements = [...repository.features.values()].filter(f => f.kind === 2 && shown(f) && f.bounds && f.bounds[0] <= box.getEast() && f.bounds[2] >= box.getWest() && f.bounds[1] <= box.getNorth() && f.bounds[3] >= box.getSouth());
        // Limit concurrent downloads while quickly panning across village boundaries.
        for (let i = 0; i < settlements.length; i += 4) await Promise.all(settlements.slice(i, i + 4).map(async s => {
            if ((loadErrors.get(s.id) || 0) > Date.now() - 5000) return;
            try { await repository.loadArea(s.id);loadErrors.delete(s.id); } catch (e) { if (generation !== repository.generation) return; loadErrors.set(s.id, Date.now());error(e); }
        }));
    }
    function addSearch() {
        searchRoot = document.createElement('div');searchRoot.className = 'tb-search';
        const input = document.createElement('input');input.type = 'search';input.placeholder = tr('search');input.setAttribute('aria-label', tr('search'));
        const results = document.createElement('div');results.className = 'tb-search-results';results.hidden = true;searchRoot.append(input, results);map.getContainer().append(searchRoot);
        let request = 0, timer;
        // The search data is fetched once someone starts to search, not with the map: from the
        // focus rather than the first letters, which then wait less. (A failed fetch is tried again.)
        input.addEventListener('focus', () => repository.loadSearch().catch(() => {}));
        input.addEventListener('input', () => { clearTimeout(timer);const mine = ++request;timer = setTimeout(async () => {
            const query = normalize(input.value.trim());if (!query) { results.hidden = true;return; }
            results.hidden = false;results.textContent = tr('searchLoading');
            try {
                await repository.loadSearch();if (mine !== request) return;
                // What is called what was typed comes first, then what is called something starting with
                // it, then the rest that matches (such as each house of a village starting with it).
                const closeness = text => { const t = normalize(text); return t === query ? 0 : t.startsWith(query) ? 1 : 2; };
                // search.dat holds what map.dat does not; an area file's copy of a hint is the same thing.
                const candidates = [...new Map([...repository.searchFeatures, ...repository.features]).values()].map(f => {
                    if (f.kind === 4 && !f.names.some(n => n.current) && normalize(f.legacyId) !== query) return { match: false };
                    const parent = feature(f.settlementId), address = f.address ? `${f.address.number ?? ''}${f.address.suffix}` : '';
                    const terms = [featureTitle(f), parent ? featureTitle(parent) : '', address, f.legacyId];
                    const hay = normalize(terms.join(' '));const tokens = query.split(/\s+/);return { f, rank: closeness(featureTitle(f)), match: tokens.every(t => hay.includes(t)) };
                }).filter(m => m.match && shown(m.f) && !isMapRegion(m.f));
                for (const name of repository.names.values()) {
                    const target = feature(name.subjectId), hay = normalize(`${name.text} ${target?.settlementId ? featureTitle(feature(target.settlementId)) : ''}`);
                    if (target && shown(target) && !isMapRegion(target) && query.split(/\s+/).every(t => hay.includes(t))) candidates.push({ f: target, name, rank: closeness(name.text) - (normalize(name.text) === query) });
                }
                const matches = candidates.sort((a, b) => a.rank - b.rank || (a.name?.text || featureTitle(a.f)).localeCompare(b.name?.text || featureTitle(b.f))).slice(0, 35);
                results.replaceChildren();if (!matches.length) results.textContent = tr('noResults');
                for (const { f, name } of matches) {
                    const button = document.createElement('button');button.type = 'button';button.textContent = `${name?.text || featureTitle(f)} · ${name ? tr('name') + (name.current ? '' : ` (${tr('historic')})`) : kindName(f)}${f.settlementId && f.settlementId !== f.id ? ` · ${featureTitle(feature(f.settlementId))}` : ''}`;
                    button.addEventListener('click', () => { selection.select(name ? 'name' : 'feature', name?.id || f.id, { zoom: true });results.hidden = true;input.blur(); });results.append(button);
                }
            } catch (e) { if (mine === request) { results.textContent = tr('searchError');console.error(e); } }
        }, 150); });
        input.addEventListener('keydown', e => { if (e.key === 'Escape') { ++request;results.hidden = true;input.blur(); } });
    }
    return {
        add(mapInstance, context) {
            map = mapInstance;beforeId = context.beforeId;
            // Labels are known by their feature's id, to hide the selected one (markSelected).
            for (const id of ['tb-shapes', 'tb-labels', 'tb-addresses', 'tb-selected-shape', 'tb-selected-point', 'tb-mask', 'tb-progress', 'tb-progress-labels', 'tb-state-border']) map.addSource(id, { type: 'geojson', data: empty(), ...(LABEL_SOURCES.includes(id) ? { promoteId: 'id' } : {}) });
            setMask();
            layer({ id: 'tb-region-mask', type: 'fill', source: 'tb-mask', paint: { 'fill-color': '#15171c', 'fill-opacity': 0.4 } });
            const progressColor = ['interpolate', ['linear'], ['get', 'p'], 0, '#d93025', 0.5, '#f2b705', 1, '#1e8e3e'];
            layer({ id: 'tb-progress-fill', type: 'fill', source: 'tb-progress', layout: { visibility: 'none' }, paint: { 'fill-color': progressColor, 'fill-opacity': 0.24 } });
            // Places drawn as areas, from the zoom where each is big enough to matter (applyVisibility).
            layer({ id: 'tb-place-fill', type: 'fill', source: 'tb-shapes', filter: ['>=', ['get', 'kind'], 6], paint: { 'fill-color': '#ed856c', 'fill-opacity': 0.12 } });
            layer({ id: 'tb-place-lines', type: 'line', source: 'tb-shapes', filter: ['>=', ['get', 'kind'], 6], paint: { 'line-color': '#d46c55', 'line-width': 1.7, 'line-dasharray': [3, 2] } });
            // Subregions and groups of villages: a long dash along their villages' outer border.
            layer({ id: 'tb-region-lines', type: 'line', source: 'tb-shapes', filter: ['==', ['get', 'kind'], REGION], layout: { 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'type'], 3, REGION_COLOURS.map.group, REGION_COLOURS.map.subregion], 'line-width': 2.4, 'line-opacity': 0.8, 'line-dasharray': [6, 2.5] } });
            layer({ id: 'tb-buildings', type: 'fill', source: 'tb-shapes', minzoom: 16, filter: ['==', ['get', 'kind'], 4], paint: { 'fill-color': '#746a5c', 'fill-opacity': 0.22 } });
            layer({ id: 'tb-building-lines', type: 'line', source: 'tb-shapes', minzoom: 16, filter: ['==', ['get', 'kind'], 4], paint: { 'line-color': '#8d7562', 'line-width': 1 } });
            layer({ id: 'tb-municipal-lines', type: 'line', source: 'tb-shapes', filter: ['==', ['get', 'kind'], 1], paint: { 'line-color': '#93735d', 'line-width': 1.8 } });
            layer({ id: 'tb-settlement-lines', type: 'line', source: 'tb-shapes', minzoom: 11, filter: ['==', ['get', 'kind'], 2], paint: { 'line-color': '#4e83ad', 'line-width': 1.2, 'line-dasharray': [4, 2] } });
            layer({ id: 'tb-street-lines', type: 'line', source: 'tb-shapes', minzoom: 14, filter: ['==', ['get', 'kind'], 3], paint: { 'line-color': '#8b7e69', 'line-width': 2 } });
            // Slovenia's state border: a band on the Slovenian side (Slovenia lies left of each
            // line, hence the negative offset) under a dash-dot line, over every other border.
            const zoomed = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
            layer({ id: 'tb-state-band', type: 'line', source: 'tb-state-border', layout: { 'line-join': 'round' }, paint: { 'line-color': STATE_BORDER.map.band, 'line-opacity': 0.4, 'line-width': zoomed(8, 3, 13, 6, 17, 9), 'line-offset': zoomed(8, -1.5, 13, -3, 17, -4.5) } });
            layer({ id: 'tb-state-line', type: 'line', source: 'tb-state-border', layout: { 'line-join': 'round' }, paint: { 'line-color': STATE_BORDER.map.line, 'line-width': zoomed(8, 1.4, 13, 2.2, 17, 3), 'line-dasharray': [5, 1.6, 1, 1.6] } });
            const symbol = (id, source, minzoom = 0) => layer({ id, type: 'symbol', source, minzoom, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-max-width': 12 }, paint: { 'text-color': '#463c35', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2, 'text-opacity': UNLESS_SELECTED } });
            // The layer on top is placed first: village and municipality names win over local
            // names (such as Goričko) where they would collide.
            symbol('tb-names', 'tb-labels');symbol('tb-admin-labels', 'tb-labels');symbol('tb-address-labels', 'tb-addresses');
            // A house's one label: from afar its name, close up its number with the name under it.
            map.setLayoutProperty('tb-address-labels', 'text-field', houseText(HOUSE_FAR, HOUSE_NEAR));
            // From the zoom where a place shows its dot (tb-name-points), its name is just below the
            // dot instead of over it. An area's name has no dot and stays across its middle.
            const besideDot = (then, below) => ['step', ['zoom'], then, DOTS_FROM, ['case', ['boolean', ['get', 'area'], false], then, below]];
            map.setLayoutProperty('tb-names', 'text-anchor', besideDot('center', 'top'));
            map.setLayoutProperty('tb-names', 'text-offset', besideDot(['literal', [0, 0]], ['literal', [0, 0.5]]));
            // A subregion's or group's name, spaced out across its middle; placed before village names.
            layer({ id: 'tb-region-labels', type: 'symbol', source: 'tb-labels', filter: ['==', ['get', 'kind'], REGION], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Italic'], 'text-size': 15, 'text-letter-spacing': 0.14, 'text-transform': 'uppercase', 'text-max-width': 10 }, paint: { 'text-color': REGION_COLOURS.map.text, 'text-halo-color': '#ffffff', 'text-halo-width': 1.4, 'text-opacity': UNLESS_SELECTED } });
            layer({ id: 'tb-name-points', type: 'circle', source: 'tb-labels', minzoom: DOTS_FROM, filter: ['>', ['get', 'kind'], 3], paint: { 'circle-color': '#ee654a', 'circle-radius': 3, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1, 'circle-opacity': UNLESS_SELECTED, 'circle-stroke-opacity': UNLESS_SELECTED } });
            layer({ id: 'tb-progress-labels', type: 'symbol', source: 'tb-progress-labels', minzoom: 11, layout: { visibility: 'none', 'text-field': ['get', 'label'], 'text-offset': [0, 1.6], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': progressColor, 'text-halo-width': 2 } });
            // A municipality's or a region's villages are drawn thinly inside its outline.
            layer({ id: 'tb-selected-fill', type: 'fill', source: 'tb-selected-shape', filter: ['all', ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], ['!', ['boolean', ['get', 'inner'], false]]], paint: { 'fill-color': '#f35b40', 'fill-opacity': 0.25 } });
            layer({ id: 'tb-selected-line', type: 'line', source: 'tb-selected-shape', paint: { 'line-color': '#f35b40', 'line-width': ['case', ['boolean', ['get', 'inner'], false], 1, 3], 'line-opacity': ['case', ['boolean', ['get', 'inner'], false], 0.7, 1] } });
            // The selected thing's own label is hidden (markSelected) and drawn here instead, just
            // below a small point, so it shows once. A house has no point: its label stays as it was.
            const isHouseMarker = ['boolean', ['get', 'house'], false];
            layer({ id: 'tb-selected-marker', type: 'circle', source: 'tb-selected-point', filter: ['!', isHouseMarker], paint: { 'circle-color': '#f35b40', 'circle-radius': 4.5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
            layer({ id: 'tb-selected-label', type: 'symbol', source: 'tb-selected-point', layout: { 'text-field': houseText(['case', isHouseMarker, HOUSE_FAR, formatted(['coalesce', ['get', 'label'], ''])], ['case', isHouseMarker, HOUSE_NEAR, formatted(['coalesce', ['get', 'label'], ''])]), 'text-offset': ['case', isHouseMarker, ['literal', [0, 0]], ['literal', [0, 0.55]]], 'text-anchor': ['case', isHouseMarker, 'center', 'top'], 'text-size': 14, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#f35b40', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
            // What a click (or the pointer) is on. A name, its dot or a house's label is found within
            // a few pixels of it, the nearest first: a dot is small and text is thin, and a click
            // just beside one is meant for it. Areas and lines count only right under the pointer.
            const markLayers = ['tb-selected-label', 'tb-selected-marker', 'tb-region-labels', 'tb-names', 'tb-name-points', 'tb-address-labels', 'tb-admin-labels'];
            const areaLayers = ['tb-buildings', 'tb-street-lines', 'tb-place-fill', 'tb-place-lines', 'tb-region-lines', 'tb-settlement-lines', 'tb-municipal-lines'];
            const NEAR = 6;
            const markAt = p => {
                const layers = markLayers.filter(id => map.getLayer(id)), usable = h => h.properties?.id;
                const exact = map.queryRenderedFeatures(p, { layers }).find(usable);
                if (exact) return exact;
                const away = h => { if (h.geometry?.type !== 'Point') return Infinity; const at = map.project(h.geometry.coordinates); return Math.hypot(at.x - p.x, at.y - p.y); };
                return map.queryRenderedFeatures([[p.x - NEAR, p.y - NEAR], [p.x + NEAR, p.y + NEAR]], { layers }).filter(usable).sort((a, b) => away(a) - away(b))[0] || null;
            };
            // While the editor chooses a region's villages, a click anywhere in a village is that village.
            const townAt = ({ lng, lat }) => [...repository.features.values()].find(f => f.kind === 2 && shown(f) && f.bounds && lng >= f.bounds[0] && lng <= f.bounds[2] && lat >= f.bounds[1] && lat <= f.bounds[3] && contains(f.geometry, [lng, lat]));
            selection.register('feature', { priority: 1, hit: (p, lngLat) => {
                if (pickingTowns) { const town = lngLat && townAt(lngLat); if (town) return { id: town.id, label: false }; }
                // A house's name is the house too, not a name to select on its own.
                const mark = markAt(p), own = h => !h.properties.use || isHouse(h.properties.id);
                const hit = mark ? (own(mark) ? mark : null) : map.queryRenderedFeatures(p, { layers: areaLayers.filter(id => map.getLayer(id)) }).find(h => h.properties?.id && own(h));
                if (!hit) return null;
                return { id: houseOf(feature(hit.properties.id))?.id || hit.properties.id, label: !!mark };
            }, get: async id => { const f = await repository.get(id); if (f?.kind === 7) await Promise.all(f.members.map(id => repository.get(id))); if (f?.address?.buildingId) await repository.get(f.address.buildingId).catch(() => null); return houseOf(f) || f; }, describe, highlight, bounds, maxZoom: 18 });
            selection.register('name', { priority: 5, hit: p => {
                // While villages are chosen, a municipality's name stands for all its villages.
                const hit = markAt(p);
                return hit?.properties.use && !isHouse(hit.properties.id) && (!pickingTowns || hit.properties.kind === 1) ? { id: hit.properties.use, label: true } : null;
            }, get: async id => { await repository.loadMap();const name = repository.names.get(id);const target = name ? await repository.get(name.subjectId) : null;return name && target ? { name, feature: houseOf(target) || target } : null; }, describe: e => describe(e.feature, e.name), highlight: e => highlight(e?.feature, e?.name), bounds: e => bounds(e.feature), maxZoom: 18 });
            repository.onChange(queueRender);map.on('moveend', () => loadVisible());map.on('zoom', () => applyVisibility());
            // Drawn on the next frame, with the mode, language and view that map.js sets just after this:
            // each drawing has MapLibre lay out all of it again.
            queueRender();addSearch();loadVisible();
            progressLegend = document.createElement('div'); progressLegend.className = 'progress-legend'; progressLegend.hidden = true; map.getContainer().append(progressLegend); renderProgressLegend();
        },
        setMode(value) {
            mode = value;if (!map) return;const aerial = mode === 'aerial';
            for (const id of ['tb-admin-labels', 'tb-names', 'tb-address-labels']) { map.setPaintProperty(id, 'text-color', aerial ? '#ffffff' : '#463c35');map.setPaintProperty(id, 'text-halo-color', aerial ? '#202020' : '#ffffff'); }
            map.setPaintProperty('tb-state-band', 'line-color', STATE_BORDER[mode].band);map.setPaintProperty('tb-state-line', 'line-color', STATE_BORDER[mode].line);
            map.setPaintProperty('tb-region-lines', 'line-color', ['match', ['get', 'type'], 3, REGION_COLOURS[mode].group, REGION_COLOURS[mode].subregion]);
            map.setPaintProperty('tb-region-labels', 'text-color', REGION_COLOURS[mode].text);map.setPaintProperty('tb-region-labels', 'text-halo-color', aerial ? '#202020' : '#ffffff');
        },
        setLanguage(value) { language = value;queueRender();renderProgressLegend();if (searchRoot) { searchRoot.querySelector('input').placeholder = tr('search');searchRoot.querySelector('input').setAttribute('aria-label', tr('search')); } },
        applyView(value) { view = value;queueRender();loadVisible(); },
        async refreshNames() { await repository.loadMap();queueRender(); },
        async reload(base) { repository.reset(base);const generation = repository.generation;try { await repository.loadMap();if (generation !== repository.generation) return;render();await loadVisible();if (generation === repository.generation) await selection.refresh(); } catch (e) { if (generation === repository.generation) error(e); } },
        buildingOutline(id) { return feature(id)?.geometry || null; },
        // The editor chooses a region's villages: a click anywhere in a village selects it.
        setPickingTowns(on) { pickingTowns = !!on; },
    };
}

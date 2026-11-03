// The base map's own labels, from OpenStreetMap: businesses and other points
// of interest, street and road names, road numbers, waters, the places beyond
// the region and their house numbers.
//
// They make room for ours: businesses and road names are placed after our
// names, and a business whose name does not fit keeps its icon. Over the
// aerial photo they are written as ours are. Each of them can be clicked: its
// card says what it is, its names, and the building and village of ours it is
// in; a street name that is one of our streets opens our street. A building of
// ours lists the businesses in it (businessesIn).

import { repository, title } from '../data/DataRepository.js';
import { getLanguage, t } from '../i18n/i18n.js';
import { contains } from './regions.js';

const SOURCE = 'openmaptiles';
// Placed after our names: they go under them in the layer order, in the style's own order.
// (A road number above ours, say, would hide a name at some zooms and not others; under them it
// shows further along its road.)
const AFTER_OURS = ['poi', 'transportation_name', 'aerodrome_label'];
// The names a card shows besides the one in the visitor's language.
const LANGUAGES = ['sl', 'hu', 'de', 'hr', 'en'];
const NEAR = 6;        // px: a click this close to a label is on it
const IN_HOUSE = 20;   // m: a business this close to a building drawn as a point is in it
const ALONG = 2000;    // m: how far from the click a road is drawn as the one clicked
const AERIAL = { 'text-color': '#ffffff', 'text-halo-color': '#202020', 'text-halo-width': 1.2 };
const UNSET = { 'text-color': '#000000', 'text-halo-color': 'rgba(0, 0, 0, 0)', 'text-halo-width': 0 }; // MapLibre's own
const SELECTED = '#f35b40';

const empty = () => ({ type: 'FeatureCollection', features: [] });
const collection = features => ({ type: 'FeatureCollection', features });
const geo = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
const metres = ([x1, y1], [x2, y2]) => Math.hypot((x2 - x1) * 111320 * Math.cos((y1 + y2) / 2 * Math.PI / 180), (y2 - y1) * 110540);
const inBounds = (b, [x, y], margin = 0) => b && x >= b[0] - margin && x <= b[2] + margin && y >= b[1] - margin && y <= b[3] + margin;
const lines = g => g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
const points = g => g?.type === 'Point' ? [g.coordinates] : g?.type === 'MultiPoint' ? g.coordinates : [];

// Where on a line [a, b] the point p is nearest, as a fraction of it.
function along(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    return length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
}
function nearestOn(geometry, p) {
    let best = null, distance = Infinity;
    for (const line of lines(geometry)) for (let i = 1; i < line.length; ++i) {
        const a = line[i - 1], b = line[i], f = along(p, a, b), at = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        const d = Math.hypot(at[0] - p[0], at[1] - p[1]);
        if (d < distance) { distance = d; best = at; }
    }
    return best;
}

// What a label's thing is, in the visitor's language: the first of the
// OpenStreetMap values that has a word.
function word(...keys) {
    for (const key of keys) if (key) {
        const text = t(`background.kind.${key}`);
        if (text !== `background.kind.${key}`) return text;
    }
    return null;
}
export function kindOf(e) {
    if (e.shield) return t('background.kind.road_number');
    switch (e.sourceLayer) {
    case 'poi': return word(e.subclass, e.class) || t('background.kind.poi');
    case 'transportation_name': return word(`road_${e.class}`) || t('background.kind.road');
    case 'water_name': case 'waterway': return word(e.class) || t('background.kind.water');
    case 'place': return word(`place_${e.class}`) || t('background.kind.place');
    case 'aerodrome_label': return t('background.kind.airport');
    case 'housenumber': return t('background.kind.housenumber');
    default: return t('background.kind.poi');
    }
}
export function titleOf(e) {
    return e.shield ? e.ref : e.names[getLanguage()] || e.local || kindOf(e);
}

// A label as the card knows it. A point keeps its own place; a road, a river
// or a road number is the one clicked, near where it was clicked.
function entityOf(feature, sourceLayer, layerId, click) {
    const props = feature.properties || {};
    const shield = /shield/.test(layerId || '');
    const names = {};
    for (const language of LANGUAGES) if (props[`name:${language}`]) names[language] = props[`name:${language}`];
    const local = sourceLayer === 'housenumber' ? props.housenumber : props.name || '';
    const line = lines(feature.geometry).length > 0;
    const position = line ? click && nearestOn(feature.geometry, click) || click : points(feature.geometry)[0];
    if (!position) return null;
    const where = line ? position.map(n => n.toFixed(3)) : position.map(n => n.toFixed(5));
    const id = [sourceLayer, shield ? 'ref' : props.class || '', shield ? props.ref : local, ...where].join('|');
    return { id, sourceLayer, shield, line, class: props.class, subclass: props.subclass, ref: props.ref, names, local, position };
}

export function createBackground(selection, ourLabel = () => null) {
    let map, labelLayers = [], written = [], selected = null;
    const known = new Map(); // id -> the labels hovered, clicked or listed lately
    function remember(e) {
        known.delete(e.id);
        known.set(e.id, e);
        if (known.size > 300) known.delete(known.keys().next().value);
        return e;
    }

    // Ours where a label stands: the building it is in, and its village.
    function oursAt(at) {
        let building = null, inside = false, nearest = IN_HOUSE, settlement = null;
        for (const f of repository.features.values()) {
            if (f.kind === 2 && inBounds(f.bounds, at) && contains(f.geometry, at)) settlement = f;
            if (f.kind !== 4 || inside) continue;
            if (/Polygon/.test(f.geometry?.type)) {
                if (inBounds(f.bounds, at) && contains(f.geometry, at)) { building = f; inside = true; }
            } else if (f.position) {
                const d = metres(f.position, at);
                if (d < nearest) { nearest = d; building = f; }
            }
        }
        return { building, settlement };
    }
    // One of our streets by the name of a road there. (Asked while the pointer moves: the
    // streets are listed again only when the data changed.)
    let streets = [], streetsOf = '';
    function ourStreet(e) {
        if (e.sourceLayer !== 'transportation_name' || e.shield) return null;
        const version = `${repository.generation}/${repository.features.size}/${repository.searchFeatures.size}`;
        if (version !== streetsOf) {
            streetsOf = version;
            streets = [...new Map([...repository.searchFeatures, ...repository.features]).values()].filter(f => f.kind === 3)
                .map(f => ({ f, names: new Set(f.names.map(n => normalize(n.text))) }));
        }
        const wanted = [e.local, ...Object.values(e.names)].map(normalize).filter(Boolean);
        return streets.find(s => inBounds(s.f.bounds, e.position, 0.01) && wanted.some(name => s.names.has(name)))?.f || null;
    }
    // The road or river a label is on, near where it was clicked.
    function lineOf(e) {
        const filter = e.shield ? ['==', ['get', 'ref'], e.ref] : ['==', ['get', 'name'], e.local];
        let found = [];
        try { found = map.querySourceFeatures(SOURCE, { sourceLayer: e.sourceLayer, filter }) || []; } catch { /* the style may lack the layer */ }
        return found.map(f => f.geometry).filter(g => { const at = nearestOn(g, e.position); return at && metres(at, e.position) < ALONG; });
    }

    function hit(p) {
        const layers = labelLayers.filter(id => map.getLayer(id));
        if (!layers.length) return null;
        const { lng, lat } = map.unproject([p.x, p.y]), click = [lng, lat];
        const away = f => {
            const at = lines(f.geometry).length ? [nearestOn(f.geometry, click)].filter(Boolean) : points(f.geometry);
            return Math.min(Infinity, ...at.map(c => { const q = map.project(c); return Math.hypot(q.x - p.x, q.y - p.y); }));
        };
        const found = map.queryRenderedFeatures([[p.x - NEAR, p.y - NEAR], [p.x + NEAR, p.y + NEAR]], { layers });
        const nearest = found.map(f => ({ f, d: away(f) })).sort((a, b) => a.d - b.d)[0];
        const e = nearest && entityOf(nearest.f, nearest.f.layer?.['source-layer'] ?? nearest.f.sourceLayer, nearest.f.layer?.id, click);
        if (!e) return null;
        // A road that is one of our streets is our street.
        const street = ourStreet(e);
        return street ? { kind: 'feature', id: street.id, label: true } : { id: remember(e).id, label: true };
    }

    function describe(e) {
        const text = titleOf(e), rows = [];
        for (const [language, name] of Object.entries(e.names))
            if (name !== text) rows.push({ label: `${language.toUpperCase()} · ${t('names.name')}`, value: name });
        if (e.local && e.local !== text && !Object.values(e.names).includes(e.local)) rows.push({ label: t('names.name'), value: e.local });
        const { building, settlement } = oursAt(e.position);
        if (building) rows.push({ label: t('house.building'), value: ourLabel(building.id) || title(building, getLanguage()), select: { kind: 'feature', id: building.id } });
        if (settlement) rows.push({ label: t('selection.naselje'), value: title(settlement, getLanguage()), select: { kind: 'feature', id: settlement.id } });
        rows.push({ label: t('background.source'), value: 'OpenStreetMap' });
        return { kind: kindOf(e), title: text, rows, background: true };
    }

    function highlight(e) {
        selected = e;
        if (e?.line) e.lines = lineOf(e);
        const shapes = !e ? [] : e.line && e.lines.length ? e.lines.map(g => geo(g)) : [geo({ type: 'Point', coordinates: e.position })];
        map.getSource('tb-background-selected')?.setData(collection(shapes));
    }

    function bounds(e) {
        const all = e.line && e.lines?.length ? e.lines.flatMap(lines).flat() : [e.position];
        const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
        return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
    }

    return {
        add(m) {
            map = m;
            const style = map.getStyle().layers.filter(l => l.type === 'symbol' && l.source === SOURCE && l.layout?.['text-field'] !== undefined);
            labelLayers = style.map(l => l.id);
            for (const l of style) {
                if (!AFTER_OURS.includes(l['source-layer'])) continue;
                if (map.getLayer('tb-names')) map.moveLayer(l.id, 'tb-names');
                if (l['source-layer'] === 'poi' && l.layout['icon-image']) map.setLayoutProperty(l.id, 'text-optional', true);
                // A road number is written on its shield, not on the photo.
                if (!l.layout['icon-image'] || l['source-layer'] === 'poi')
                    written.push({ id: l.id, original: Object.fromEntries(Object.keys(AERIAL).map(key => [key, l.paint?.[key] ?? UNSET[key]])) });
            }
            map.addSource('tb-background-selected', { type: 'geojson', data: empty() });
            const under = ['tb-selected-line'].find(id => map.getLayer(id));
            map.addLayer({ id: 'tb-background-line', type: 'line', source: 'tb-background-selected', filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': SELECTED, 'line-width': 5, 'line-opacity': 0.55 } }, under);
            map.addLayer({ id: 'tb-background-ring', type: 'circle', source: 'tb-background-selected', filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]], paint: { 'circle-radius': 12, 'circle-opacity': 0, 'circle-stroke-color': SELECTED, 'circle-stroke-width': 2.5 } });
            selection.register('osm', {
                priority: 0, hit, picked: false,
                get: id => known.get(id) || (selected?.id === id ? selected : null),
                describe, highlight, bounds, maxZoom: 18,
            });
        },

        setMode(mode) {
            for (const { id, original } of written) for (const [key, value] of Object.entries(mode === 'aerial' ? AERIAL : original))
                if (map.getLayer(id)) map.setPaintProperty(id, key, value);
        },

        // The businesses in one of our buildings, as rows of its card.
        businessesIn(f) {
            if (!map || !f) return [];
            const outline = /Polygon/.test(f.geometry?.type) ? f.geometry : null;
            if (!outline && !f.position) return [];
            let found = [];
            try { found = map.querySourceFeatures(SOURCE, { sourceLayer: 'poi' }) || []; } catch { /* the style may lack the layer */ }
            const rows = [], seen = new Set();
            for (const poi of found) {
                const at = points(poi.geometry)[0];
                if (!at || (outline ? !contains(outline, at) : metres(f.position, at) > IN_HOUSE)) continue;
                const e = entityOf(poi, 'poi', null, null);
                if (!e || seen.has(e.id)) continue;
                seen.add(e.id);
                const text = titleOf(remember(e)), kind = kindOf(e);
                rows.push({ label: t('background.here'), value: text === kind ? kind : `${text} · ${kind}`, select: { kind: 'osm', id: e.id } });
            }
            return rows;
        },
    };
}

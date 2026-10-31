// Adjustments to the OpenFreeMap style itself: label language, house
// numbers outside the region, hiding its own place names and house
// numbers inside it (our clickable names and houses replace them there),
// and its Slovenian border (ours replaces it). Around the region it stays
// the drawn map in Satellite mode too (aerial.js), house numbers included.

const polygons = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

// Style layers whose names, inside the region, would duplicate ours:
// settlements (boundaries.js) and hamlets, waters and the rest (names.js,
// from the official topographic maps). Outside the region they stay.
const DUPLICATE_LABELS = [
    'label_village', 'label_town', 'label_city', 'label_city_capital', 'label_other',
    'water_name_point_label', 'water_name_line_label', 'waterway_line_label',
];
// In Porabje, while it is shown, only the village and town names: ours are its villages', in
// Slovene. Its hamlets and waters keep their names from the style.
const SETTLEMENT_LABELS = ['label_village', 'label_town', 'label_city', 'label_city_capital'];
// The style's country borders. Slovenia's is drawn from GURS instead (resolved-map.js), on the
// very line its municipalities follow.
const COUNTRY_BORDERS = ['boundary_2', 'boundary_disputed'];

export function createBasemap() {
    let map;
    let nameLayers = [];
    let outline = null, porabje = null, porabjeShown = false;
    const baseFilters = new Map();
    const outsideOf = (layerId, area) => {
        const filter = baseFilters.get(layerId), outside = ['!', ['within', area]];
        return filter ? ['all', filter, outside] : outside;
    };

    // Hides the style's names that ours replace: inside Prekmurje, and Porabje's villages while
    // it is shown.
    function refresh() {
        if (!outline) return;
        const both = porabjeShown ? { type: 'MultiPolygon', coordinates: [...polygons(outline), ...polygons(porabje)] } : outline;
        for (const id of DUPLICATE_LABELS)
            if (map.getLayer(id)) map.setFilter(id, outsideOf(id, SETTLEMENT_LABELS.includes(id) ? both : outline));
    }

    return {
        add(m, ctx) {
            map = m;
            const style = map.getStyle();

            nameLayers = style.layers
                .filter((l) => l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] ?? '').includes('"name'))
                .map((l) => l.id);

            outline = ctx.data?.outline.features[0]?.geometry || null;
            porabje = ctx.porabjeOutline || null;
            if (outline) {
                for (const id of DUPLICATE_LABELS) if (map.getLayer(id)) baseFilters.set(id, map.getFilter(id));
                refresh();
            }
            if (ctx.stateBorder) {
                for (const id of COUNTRY_BORDERS) {
                    if (!map.getLayer(id)) continue;
                    const notSlovenia = ['all', ['!=', ['get', 'adm0_l'], 'SVN'], ['!=', ['get', 'adm0_r'], 'SVN']];
                    const filter = map.getFilter(id);
                    map.setFilter(id, filter ? ['all', filter, notSlovenia] : notSlovenia);
                }
            }

            // OpenFreeMap carries house numbers; the style just does not draw
            // them. Inside the region the official, clickable ones from
            // houses.js take their place.
            map.addLayer({
                id: 'housenumber', type: 'symbol', source: 'openmaptiles', 'source-layer': 'housenumber',
                minzoom: 16.5,
                ...(outline ? { filter: ['!', ['within', outline]] } : {}),
                layout: {
                    'text-field': ['get', 'housenumber'],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 16.5, 10, 19, 13],
                },
                paint: { 'text-color': '#5f5a55', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
            });
        },

        setMode(mode) {
            if (map.getLayer('building-3d')) {
                // The lighter map (editor, little memory) has no 3D buildings. In Satellite
                // mode they would stand over the photo (a style filter cannot keep them off it).
                const shown = mode !== 'aerial' && !window.tbmapEditorOptions?.lite;
                map.setLayoutProperty('building-3d', 'visibility', shown ? 'visible' : 'none');
            }
        },

        applyView(view) {
            const shown = !!porabje && view.porabje !== false;
            if (shown === porabjeShown) return;
            porabjeShown = shown;
            refresh();
        },

        // Street, river and country names in the chosen language where
        // OpenStreetMap has it, else the local name.
        setLanguage(lang) {
            const field = ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
            for (const id of nameLayers) map.setLayoutProperty(id, 'text-field', field);
        },
    };
}

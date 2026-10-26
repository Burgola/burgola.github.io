// Adjustments to the OpenFreeMap style itself: label language, house
// numbers outside the region, and hiding its own place names and house
// numbers inside it (our clickable names and houses replace them there).

const PAINT = {
    map: {
        housenumber: { 'text-color': '#5f5a55', 'text-halo-color': '#ffffff' },
    },
    aerial: {
        housenumber: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)' },
    },
};

// Style layers whose names, inside the region, would duplicate ours:
// settlements (boundaries.js) and hamlets, waters and the rest (names.js,
// from the official topographic maps). Outside the region they stay.
const DUPLICATE_LABELS = [
    'label_village', 'label_town', 'label_city', 'label_city_capital', 'label_other',
    'water_name_point_label', 'water_name_line_label', 'waterway_line_label',
];

export function createBasemap() {
    let map;
    let nameLayers = [];

    return {
        add(m, ctx) {
            map = m;
            const style = map.getStyle();

            nameLayers = style.layers
                .filter((l) => l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] ?? '').includes('"name'))
                .map((l) => l.id);

            const outline = ctx.data?.outline.features[0]?.geometry;
            if (outline) {
                const outside = ['!', ['within', outline]];
                for (const id of DUPLICATE_LABELS) {
                    if (!map.getLayer(id)) continue;
                    const filter = map.getFilter(id);
                    map.setFilter(id, filter ? ['all', filter, outside] : outside);
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
                paint: { 'text-halo-width': 1.2 },
            });
        },

        setMode(mode) {
            if (map.getLayer('building-3d')) {
                // The lighter map (editor, little memory) has no 3D buildings.
                const shown = mode !== 'aerial' && !window.tbmapEditorOptions?.lite;
                map.setLayoutProperty('building-3d', 'visibility', shown ? 'visible' : 'none');
            }
            for (const [layerId, paint] of Object.entries(PAINT[mode])) {
                for (const [prop, value] of Object.entries(paint)) map.setPaintProperty(layerId, prop, value);
            }
        },

        // Street, river and country names in the chosen language where
        // OpenStreetMap has it, else the local name.
        setLanguage(lang) {
            const field = ['coalesce', ['get', `name:${lang}`], ['get', 'name']];
            for (const id of nameLayers) map.setLayoutProperty(id, 'text-field', field);
        },
    };
}

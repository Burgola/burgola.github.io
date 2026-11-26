// The map settings' text sizes: every label on the map (view.textScale),
// and on top of that our own names — local names, house numbers and names,
// our places (view.namesScale). Each symbol layer's text-size, as the style
// or the feature that added it set it, is scaled.

// Layers with our names (names.js, houses.js, places.js).
const OUR_NAMES = /^tb-(names$|address-labels$|selected-label$)/;
const STYLE_DEFAULT = 16; // MapLibre's text-size when a layer sets none

// A text-size value times f. Zoom curves must stay the outermost
// expression, so their outputs are scaled, not the curve.
function scaled(value, f) {
    if (value == null) return STYLE_DEFAULT * f;
    if (typeof value === 'number') return value * f;
    if (Array.isArray(value) && value[0] === 'interpolate') {
        return [...value.slice(0, 3), ...value.slice(3).map((v, i) => (i % 2 ? scaled(v, f) : v))];
    }
    if (Array.isArray(value) && value[0] === 'step') {
        return [...value.slice(0, 2), ...value.slice(2).map((v, i) => (i % 2 ? v : scaled(v, f)))];
    }
    if (value.stops) return { ...value, stops: value.stops.map(([z, v]) => [z, v * f]) };
    return ['*', value, f];
}

export function createTextSize() {
    let map;
    const original = new Map(); // layer id -> text-size as first seen
    const applied = new Map();  // layer id -> factor applied now

    return {
        add(m) {
            map = m;
        },

        applyView(view) {
            for (const layer of map.getStyle().layers) {
                if (layer.type !== 'symbol' || layer.layout?.['text-field'] === undefined) continue;
                if (!original.has(layer.id)) original.set(layer.id, map.getLayoutProperty(layer.id, 'text-size'));
                const f = view.textScale * (OUR_NAMES.test(layer.id) ? view.namesScale : 1);
                if ((applied.get(layer.id) ?? 1) === f) continue;
                map.setLayoutProperty(layer.id, 'text-size', scaled(original.get(layer.id), f));
                applied.set(layer.id, f);
            }
        },
    };
}

// Explicit editor-only inspection overlays. They never enter application data,
// ordinary selection, search, inheritance or exports.
import { getLanguage, onLanguageChange } from '../i18n/i18n.js';
export function createEditorContext(map) {
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('tb-context', { type: 'geojson', data: empty });
    map.addLayer({ id: 'tb-context-fill', type: 'fill', source: 'tb-context', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 } });
    map.addLayer({ id: 'tb-context-line', type: 'line', source: 'tb-context', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'tb-context-point', type: 'circle', source: 'tb-context', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'tb-context-label', type: 'symbol', source: 'tb-context', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'label'], 'text-offset': [0, 1.7], 'text-anchor': 'top', 'text-size': 13, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    const bar = document.createElement('div'); bar.className = 'tb-context-bar'; bar.hidden = true;
    const title = document.createElement('span'), close = document.createElement('button');
    bar.append(title, close); map.getContainer().append(bar);
    const translate = () => { close.textContent = getLanguage() === 'sl' ? 'Zapri pregled' : 'Close inspection'; };
    translate(); onLanguageChange(translate);
    function clear() { map.getSource('tb-context').setData(empty); bar.hidden = true; }
    close.addEventListener('click', clear);
    return {
        clear,
        show(items, fit = true) {
            const features = [], bounds = [];
            for (const item of items) {
                const properties = { label: item.label, color: item.color || '#9c76df' };
                if (item.geometry && item.geometry.type !== 'Point') features.push({ type: 'Feature', properties, geometry: item.geometry });
                if (item.position) features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: item.position } });
                if (item.bounds) bounds.push(item.bounds);
            }
            title.textContent = items.map(i => i.label).join(' · '); bar.hidden = false;
            map.getSource('tb-context').setData({ type: 'FeatureCollection', features });
            if (fit && bounds.length) map.fitBounds([[Math.min(...bounds.map(b => b[0])), Math.min(...bounds.map(b => b[1]))], [Math.max(...bounds.map(b => b[2])), Math.max(...bounds.map(b => b[3]))]], { padding: 60, maxZoom: 18 });
        },
    };
}

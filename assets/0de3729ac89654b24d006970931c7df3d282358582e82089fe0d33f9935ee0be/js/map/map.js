// Creates the map and wires its parts together.
//
// Each part (aerial photo, base style tweaks, boundaries, houses, ...) is a
// "map feature": an object with
//   add(map, ctx)      add sources, layers and events; ctx = { beforeId, data }
//   setMode(mode)      optional, 'map' | 'aerial'
//   setLanguage(lang)  optional, a key of i18n LANGUAGES
//   refreshNames()     optional, mapper data changed: redraw names from it
//   applyView(view)    optional, the map settings changed (view-settings.js)
// Features with selectable things register a selection kind
// (see selection/selection.js). New map functionality goes in as another
// feature, not into this file.

import { CONFIG } from '../config.js';
import { t, getLanguage, onLanguageChange, setLanguage as changeLanguage } from '../i18n/i18n.js';
import { load, save } from '../core/storage.js';
import { repository } from '../data/DataRepository.js';
import { BasemapControl } from './basemap-control.js';
import { createAerial } from './aerial.js';
import { createBasemap } from './basemap.js';
import { createResolvedMap } from './resolved-map.js';
import { createEditorDrawing } from './editor-drawing.js';
import { createEditorContext } from './editor-context.js';
import { createSelection } from './selection/selection.js';
import { createSelectionPanel } from './selection/panel.js';
import { createTextSize } from './text-size.js';
import { getView, setView, onViewChange } from './view-settings.js';
import { ViewControl } from './view-control.js';
import { lockToRegion } from './region-lock.js';
import { createRegions } from './regions.js';

const MODE_KEY = 'basemap';

// The editor client on a computer with little memory asks for a lighter map
// (window.tbmapEditorOptions.lite): fewer tiles kept in memory, no fading,
// no extra pixels on a scaled screen. (3D buildings: basemap.js.)
const LITE = window.tbmapEditorOptions?.lite
    ? { maxTileCacheZoomLevels: 2, fadeDuration: 0, pixelRatio: Math.min(window.devicePixelRatio || 1, 1) }
    : {};

// Our layers go under the first layer after the style's last non-label
// layer: above every fill, road, building and border line, below all labels.
// (The style interleaves a few symbol layers, e.g. one-way arrows, among the
// roads, so "first symbol layer" would be too low.)
function labelsStartId(map) {
    const layers = map.getStyle().layers;
    let last = -1;
    layers.forEach((l, i) => { if (l.type !== 'symbol') last = i; });
    return layers[last + 1]?.id;
}

// The attribution corner: the map and photo credits from their sources, one
// credit for all the GURS data in data/, one for Porabje's outline while it is shown, and who
// made the site. MapLibre fixes its text at creation, so a language or view change replaces
// the control.
function addCredits(map) {
    let control = null, porabje = null, shownPorabje = getView().porabje;
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const render = () => {
        if (control) map.removeControl(control);
        control = new maplibregl.AttributionControl({
            customAttribution: `${escape(repository.mapDocument?.attribution || 'GURS')}`
                + `${porabje && getView().porabje !== false ? ` | ${escape(porabje.attribution)}` : ''} | ${t('credits.site')}: `
                + '<a href="https://vladimirjanus.github.io" target="_blank" rel="noopener">Vladimir Januš</a>'
                + ` · ${t('credits.mapping')}: Tim Bunderla`,
        });
        map.addControl(control, 'bottom-right');
    };
    render();
    onLanguageChange(render);
    onViewChange(view => { if (porabje && view.porabje !== shownPorabje) { shownPorabje = view.porabje; render(); } });
    repository.onChange(document => { if (document.kind === 1) { porabje = createRegions(document).area; render(); } });
}

export function initMap() {
    const message = document.getElementById('map-message');
    const loading = document.getElementById('map-loading');
    const doneLoading = () => { if (loading) loading.hidden = true; };
    const showError = () => { doneLoading(); message.hidden = false; };

    if (!window.maplibregl) {
        showError();
        return;
    }

    // Start fetching our data while the style loads.
    const applicationData = repository.loadMap();
    // A visit without a map position in its address starts on the whole region. (The map
    // writes its position into the address as soon as it exists.)
    const firstVisit = !/[#&]pos=/.test(location.hash);

    let ready = false;
    const map = new maplibregl.Map({
        container: 'map',
        style: CONFIG.mapStyle,
        bounds: CONFIG.regionBounds,
        fitBoundsOptions: { padding: 24 },
        maxZoom: CONFIG.maxZoom,
        hash: 'pos',
        attributionControl: false,
        ...LITE,
    });

    addCredits(map);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-left');

    map.on('error', (e) => {
        console.error('[Map]', e.error);
        if (!ready) showError();
    });

    // Our parts go in once the style is there, not at 'load', which waits for the base map's first
    // tiles and fonts: our data then draws as soon as it is in, alongside them.
    map.once('style.load', async () => {
        ready = true;

        let data = null;
        try {
            const document = await applicationData;
            data = { outline: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: document.boundary }] } };
        } catch (err) {
            console.error('[Map] boundaries failed to load', err);
        }

        const regions = () => createRegions(repository.mapDocument);
        // porabje: its bounding box; porabjeOutline: its outline; stateBorder: Slovenia's border.
        const ctx = { beforeId: labelsStartId(map), data, porabje: regions().box, porabjeOutline: regions().area?.boundary || null, stateBorder: regions().border };
        const selection = createSelection(map, createSelectionPanel(document.getElementById('selection-panel')));
        const features = [createAerial(), createBasemap()];
        let resolved = null;
        if (data) {
            resolved = createResolvedMap(selection);
            features.push(resolved);
        }
        features.push(createTextSize()); // last: it scales every label layer added before it
        for (const feature of features) feature.add(map, ctx);

        const setMode = (mode) => features.forEach((f) => f.setMode?.(mode));
        const setLanguage = (lang) => features.forEach((f) => f.setLanguage?.(lang));

        const mode = load(MODE_KEY) === 'aerial' ? 'aerial' : 'map';
        setMode(mode);
        setLanguage(getLanguage());
        onLanguageChange(setLanguage);
        const applyView = (view) => features.forEach((f) => f.applyView?.(view));
        applyView(getView());
        onViewChange(applyView);
        map.addControl(new ViewControl(), 'top-right');

        map.addControl(new BasemapControl(mode, (next) => {
            setMode(next);
            save(MODE_KEY, next);
        }), 'top-left');

        // In reach: Prekmurje, and Porabje while it is shown. A first visit starts on all of it.
        const lock = () => lockToRegion(map, regions().bounds(getView()));
        lock();
        if (firstVisit) map.fitBounds(regions().bounds(getView()), { padding: 24, duration: 0 });
        map.on('resize', lock);
        onViewChange(lock);

        // For the editor client (TBMap/Editor), which adds its tools on top
        // of this page. Nothing on the public site listens.
        const drawing = window.tbmapEditorOptions ? createEditorDrawing(map, selection) : null;
        const context = window.tbmapEditorOptions ? createEditorContext(map) : null;
        window.tbmap = { map, selection, repository, drawing, context, setLanguage: changeLanguage, setView, reload: base => resolved?.reload(base), buildingOutline: id => resolved?.buildingOutline(id) || null, pickTowns: on => { resolved?.setPickingTowns(on); selection.setPicking(on); } };
        window.dispatchEvent(new CustomEvent('tbmap:ready', { detail: window.tbmap }));
        // Loaded once what is now on the map has been drawn.
        if (data) map.once('idle', doneLoading); else showError();
    });
}

// GURS DOF025 aerial photo, shown in Satellite mode. It sits above every
// drawn-map fill and road but below all labels, which gives a hybrid view.
//
// While the photo is on, a status line at the bottom of the map says when
// pieces of it are slow or missing and why (the GURS server timed out,
// answered with an error, or the computer is offline), with a button to
// ask for them again. Missing pieces are also asked for again by
// themselves every RETRY_EVERY while any are missing — MapLibre on its own
// never asks for a failed tile again until it leaves the screen.

import { CONFIG } from '../config.js';
import { t, onLanguageChange } from '../i18n/i18n.js';
import { cachedUrl, registerTileCache, onTileStatus, forgetFailures } from './tile-cache.js';

const tileUrl = () => cachedUrl(CONFIG.aerial.tiles);

const SLOW_AFTER = 4000;        // ms of loading before "still loading" shows
const RETRY_EVERY = 15000;      // ms between asking for missing pieces again

export function createAerial() {
    let map;
    let shown = false;
    let state = { loading: 0, failed: 0, error: null, retrying: 0 };
    let loadingSince = 0;
    let retryTimer = null;
    let slowTimer = null;
    let bar, text, button;

    // Every tile again: kept ones come from memory at once, missing ones are
    // fetched again.
    function retry() {
        forgetFailures();
        map.getSource('aerial')?.setTiles([tileUrl()]);
    }

    function message() {
        const e = state.error;
        if (state.failed) {
            const why = !e ? '' : t(`aerial.error.${e.kind}`, { detail: e.detail });
            return t('aerial.missing', { count: state.failed, why });
        }
        if (state.retrying) return t('aerial.retrying', { why: e ? t(`aerial.error.${e.kind}`, { detail: e.detail }) : '' });
        if (state.loading && Date.now() - loadingSince >= SLOW_AFTER) return t('aerial.slow', { count: state.loading });
        return '';
    }

    function render() {
        if (!bar) return;
        const msg = shown ? message() : '';
        bar.hidden = !msg;
        text.textContent = msg;
        button.textContent = t('aerial.retry');
        button.hidden = !state.failed;
        bar.classList.toggle('aerial-status-error', !!state.failed);
    }

    function addBar() {
        bar = document.createElement('div');
        bar.className = 'aerial-status';
        bar.setAttribute('role', 'status');
        bar.hidden = true;
        text = document.createElement('span');
        button = document.createElement('button');
        button.type = 'button';
        button.addEventListener('click', retry);
        bar.append(text, button);
        map.getContainer().append(bar);
        onLanguageChange(render);
    }

    function onStatus(next) {
        if (next.loading && !state.loading) loadingSince = Date.now();
        state = next;
        clearTimeout(slowTimer);
        if (state.loading) slowTimer = setTimeout(render, SLOW_AFTER + 50);
        if (state.failed && shown && !retryTimer) {
            retryTimer = setTimeout(() => {
                retryTimer = null;
                if (shown && state.failed) retry();
            }, RETRY_EVERY);
        }
        render();
    }

    return {
        add(m, ctx) {
            map = m;
            registerTileCache();
            const [[west, south], [east, north]] = CONFIG.regionBounds;
            map.addSource('aerial', {
                type: 'raster',
                tiles: [tileUrl()], // kept in the browser (tile-cache.js) or by the editor
                tileSize: CONFIG.aerial.tileSize,
                // Only requested in and just around the region.
                bounds: [west - 0.05, south - 0.05, east + 0.05, north + 0.05],
                maxzoom: CONFIG.maxZoom,
                attribution: CONFIG.aerial.attribution,
            });
            map.addLayer({ id: 'aerial', type: 'raster', source: 'aerial', layout: { visibility: 'none' } }, ctx.beforeId);
            addBar();
            onTileStatus(onStatus);
            // Back online: ask for what is missing straight away.
            window.addEventListener('online', () => { if (state.failed) retry(); });
        },

        setMode(mode) {
            shown = mode === 'aerial';
            map.setLayoutProperty('aerial', 'visibility', shown ? 'visible' : 'none');
            if (shown && state.failed) retry();
            render();
        },
    };
}

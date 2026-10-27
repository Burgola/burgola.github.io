// One selection for the whole map, shared by every kind of selectable thing.
//
// A map feature that has selectable things registers a KIND:
//
//   selection.register('house', {
//       priority,            higher wins when several kinds are under a click
//       hit(point, lngLat),  -> { id, label: bool } | null   (label = clicked
//                            its name, which beats any area click)
//       get(id, hint),       -> entity | null  (may return a Promise); hint is
//                            what the caller knows to find it (search)
//       describe(entity),    -> panel view (see panel.js), in the current language
//       highlight(entity),   draw it as selected; called with null to undo
//       bounds(entity),      -> [[w, s], [e, n]] for "Zoom to"
//       editInfo(entity),    optional, for the editor client: { gov, related }
//                            gov = the government name (string or { sl, hu })
//                            related = [{ kind, id, title, gov }] other mapper
//                            entries that decide this thing's name
//   });
//
// The manager does the rest: click handling, Escape, the panel, links between
// things (a panel row or button can select another kind), re-rendering on a
// language change, and attaching the mapper's note (data/mapper/<kind>.json).
// A new kind of thing (parcels, our own places, ...) is one more register()
// call — nothing here changes.

import { onLanguageChange } from '../../i18n/i18n.js';

export function createSelection(map, panel) {
    const kinds = new Map();
    let current = null; // { kind, id, entity }
    let request = 0;    // guards against a slow get() finishing after a newer select
    let suspended = false;
    let picking = false;   // the editor is picking things on the map (setPicking)

    function register(name, def) {
        kinds.set(name, { priority: 0, ...def });
    }

    function render() {
        if (!current) return;
        const view = kinds.get(current.kind).describe(current.entity);
        panel.show(view);
        announce(view);
    }

    // Tells the editor client (TBMap/Editor) what is selected; nothing on the
    // public site listens.
    function announce(view) {
        let detail = null;
        if (current) {
            const info = kinds.get(current.kind).editInfo?.(current.entity) || {};
            detail = { kind: current.kind, id: String(current.id), origin: current.origin, kindLabel: view.kind, title: view.title, gov: info.gov ?? null, related: info.related || [] };
        }
        window.dispatchEvent(new CustomEvent('tbmap:selection', { detail }));
    }

    function zoomTo() {
        if (!current) return;
        const def = kinds.get(current.kind);
        const bounds = def.bounds?.(current.entity);
        // A short flight: MapLibre's own pace takes seconds between a village and its municipality.
        if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: def.maxZoom ?? 17, duration: 700 });
    }

    // quiet: if the thing is not loaded (a house far away), just deselect
    // without announcing it — the editor client is showing it anyway.
    async function select(kind, id, { zoom = false, quiet = false, hint = null, origin = 'user' } = {}) {
        const mine = ++request;
        if (current) kinds.get(current.kind).highlight(null);
        current = null;

        const def = kind && kinds.get(kind);
        let entity = null;
        try { entity = def ? await def.get(id, hint) : null; }
        catch (error) {
            if (mine !== request || error.code === 'STALE_PREVIEW') return false;
            console.error('[Selection]', error); panel.hide(); return false;
        }
        if (mine !== request) return;
        if (!entity) {
            panel.hide();
            if (!quiet) announce(null);
            return false;
        }
        current = { kind, id, entity, origin };
        def.highlight(entity);
        render();
        if (zoom) zoomTo();
        else revealAboveSheet(def, entity);
        return true;
    }

    // On phones the panel is a sheet over the bottom of the map; if the
    // selected thing ended up under it, slide the map up to show it.
    function revealAboveSheet(def, entity) {
        const sheet = panel.sheetHeight();
        if (!sheet || !def.bounds) return;
        const bounds = def.bounds(entity);
        if (!bounds) return;
        const [[w, s], [e, n]] = bounds;
        const center = [(w + e) / 2, (s + n) / 2];
        const visibleBottom = map.getContainer().clientHeight - sheet - 16;
        if (map.project(center).y > visibleBottom) {
            map.easeTo({ center, offset: [0, -sheet / 2], duration: 400 });
        }
    }

    // A clicked name wins over any area; otherwise the highest-priority area.
    function hitAt(point, lngLat) {
        let area = null;
        const ordered = [...kinds.entries()].sort((a, b) => b[1].priority - a[1].priority);
        for (const [kind, def] of ordered) {
            const hit = def.hit?.(point, lngLat);
            if (!hit) continue;
            if (hit.label) return { kind, id: hit.id };
            if (!area) area = { kind, id: hit.id };
        }
        return area;
    }

    // The current thing again, e.g. after the mapper data changed: it may
    // have a new name, or (one of our own places) be gone.
    async function refresh() {
        if (!current) return;
        const { kind, id } = current;
        const entity = await kinds.get(kind).get(id);
        if (!current || current.kind !== kind || current.id !== id) return;
        if (!entity) {
            select(null);
            return;
        }
        current.entity = entity;
        kinds.get(kind).highlight(entity);
        render();
    }

    map.on('click', (e) => {
        if (suspended) return;
        const hit = hitAt(e.point, e.lngLat);
        // While the editor picks things, each click reports what is there; the selection stays.
        if (picking) {
            if (hit) window.dispatchEvent(new CustomEvent('tbmap:selection', { detail: { kind: hit.kind, id: String(hit.id), origin: 'user', picked: true } }));
            return;
        }
        if (!hit || (current && hit.kind === current.kind && hit.id === current.id)) select(null);
        else select(hit.kind, hit.id);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && current) select(null);
    });

    panel.onClose(() => select(null));
    panel.onZoom(zoomTo);
    panel.onSelect((kind, id) => select(kind, id, { zoom: true }));
    onLanguageChange(render);

    return {
        register,
        select,
        clear: () => select(null),
        refresh,
        // While true, map clicks select nothing (the editor drawing a shape).
        setSuspended(on) { suspended = on; },
        // While true, a click reports what it hit to the editor client without selecting it.
        setPicking(on) { picking = !!on; },
        get current() { return current && { kind: current.kind, id: current.id }; },
    };
}

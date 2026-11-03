// Keeps the whole region in reach and nothing more: the furthest the map
// zooms out is the view that fits the region, and panning stops at the edges
// of that view. Call again on resize, since the fit depends on the window
// shape.

export function lockToRegion(map, bounds) {
    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return; // hidden behind another page

    const padding = Math.round(Math.min(40, Math.min(w, h) * 0.05));
    map.setMaxBounds(null);
    map.setMinZoom(null);
    const cam = map.cameraForBounds(bounds, { padding });
    if (!cam) return;

    // Viewport at that zoom, centred on the region, in Web Mercator units.
    // MapLibre's world is 512 px wide at zoom 0. The extra pixel keeps
    // rounding from forcing the map one notch past the fit.
    const center = maplibregl.MercatorCoordinate.fromLngLat(cam.center);
    const worldPx = 512 * Math.pow(2, cam.zoom);
    const dx = (w / 2 + 1) / worldPx;
    const dy = (h / 2 + 1) / worldPx;
    const sw = new maplibregl.MercatorCoordinate(center.x - dx, center.y + dy).toLngLat();
    const ne = new maplibregl.MercatorCoordinate(center.x + dx, center.y - dy).toLngLat();

    map.setMinZoom(cam.zoom);
    map.setMaxBounds([sw, ne]);
}

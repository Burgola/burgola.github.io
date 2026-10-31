// Basemap services and view limits. Application facts come only from TBMap .dat files.
export const CONFIG = {
    regionBounds: [[15.98475, 46.47137], [16.59670, 46.87666]],
    maxZoom: 19,
    naseljaMinZoom: 11,
    mapStyle: 'https://tiles.openfreemap.org/styles/liberty',
    aerial: {
        tiles: 'https://ipi.eprostor.gov.si/wms-si-gurs-dts/wms?service=WMS&version=1.3.0'
            + '&request=GetMap&layers=SI.GURS.ZPDZ:DOF025&styles=&format=image/jpeg'
            + '&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=512&height=512',
        tileSize: 512,
        attribution: 'Ortofoto: <a href="https://www.e-prostor.gov.si/" target="_blank" rel="noopener">Geodetska uprava RS</a>, DOF025 (2026)',
    },
    // Porabje, in Hungary: the newest aerial photo Lechner publishes openly at full detail.
    // Where it has no photo (across the border) it is white, which is made see-through so the
    // GURS photo underneath shows (tile-cache.js, #clear-white).
    aerialPorabje: {
        tiles: 'https://inspire.lechnerkozpont.hu/geoservices/orthoimagery_2015/service?SERVICE=WMS&VERSION=1.3.0'
            + '&REQUEST=GetMap&LAYERS=OI_2015&STYLES=&FORMAT=image/jpeg'
            + '&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512#clear-white',
        attribution: 'Ortofotó 2015: <a href="https://lechnerkozpont.hu/" target="_blank" rel="noopener">Lechner Tudásközpont</a>, CC BY 4.0',
    },
};

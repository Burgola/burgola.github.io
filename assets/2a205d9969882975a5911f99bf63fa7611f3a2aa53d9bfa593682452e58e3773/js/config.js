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
};

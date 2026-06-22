// =========================================================================
// MÓDULO DE MALLA DE COORDENADAS (GRID) COMPATIBLE CON OBJETO "MAPA"
// =========================================================================

// 1. Convertidor de coordenadas a Grados, Minutos y Segundos (GMS)
function toGMS(deg, isLat) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = Math.round((abs - d - m / 60) * 3600);
    const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    return `${d}°${m}'${s}"${dir}`;
}

// 2. Función encargada de calcular y redibujar las líneas y textos
function triggerGridUpdate(MAPA) {
    try {
        if (!MAPA.getSource('grid-src') || !MAPA.getSource('label-src')) return;

        const bounds = MAPA.getBounds();

        // Control de desborde y acotado para proyecciones globales
        let w = Math.max(-180, bounds.getWest());
        let e = Math.min(180, bounds.getEast());
        let s = Math.max(-80, bounds.getSouth());
        let n = Math.min(80, bounds.getNorth());

        if (e <= w || Math.abs(e - w) > 350) { w = -180; e = 180; }
        if (n <= s) { s = -80; n = 80; }

        const gridFeatures = [];
        const labelFeatures = [];
        const latStep = (n - s) / 5;
        const lngStep = (e - w) / 5;

        for (let i = 1; i < 5; i++) {
            const currentLat = s + (i * latStep);
            const currentLng = w + (i * lngStep);

            // Líneas de Latitud Multi-Punto (Esencial para que se curven bien en el Globo)
            const latCoords = [];
            for (let step = 0; step <= 10; step++) {
                latCoords.push([w + (step * (e - w) / 10), currentLat]);
            }
            gridFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: latCoords } });
            labelFeatures.push({ type: 'Feature', properties: { text: toGMS(currentLat, true) }, geometry: { type: 'Point', coordinates: [w + (e - w) * 0.03, currentLat] } });

            // Líneas de Longitud Multi-Punto
            const lngCoords = [];
            for (let step = 0; step <= 10; step++) {
                lngCoords.push([currentLng, s + (step * (n - s) / 10)]);
            }
            gridFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: lngCoords } });
            labelFeatures.push({ type: 'Feature', properties: { text: toGMS(currentLng, false) }, geometry: { type: 'Point', coordinates: [currentLng, n - (n - s) * 0.03] } });
        }

        MAPA.getSource('grid-src').setData({ type: 'FeatureCollection', features: gridFeatures });
        MAPA.getSource('label-src').setData({ type: 'FeatureCollection', features: labelFeatures });
    } catch (err) {
        console.error("Error actualizando la malla de coordenadas:", err);
    }
}

const GRID_STYLES = {
    osm: {
        lineColor: '#000000',
        lineOpacity: 0.25,
        textColor: '#333333',
        textHalo: '#ffffff'
    },
    esri: {
        lineColor: '#ffffff',
        lineOpacity: 0.45,
        textColor: '#ffffff',
        textHalo: '#333333'
    }
};

function getActiveBasemap(MAPA) {
    if (MAPA.getLayer('osm-layer') && MAPA.getLayoutProperty('osm-layer', 'visibility') === 'visible') {
        return 'osm';
    }
    return 'esri';
}

function applyGridBasemapStyle(MAPA) {
    if (!MAPA.getLayer('grid-lines') || !MAPA.getLayer('grid-labels')) return;

    const basemap = getActiveBasemap(MAPA);
    const style = GRID_STYLES[basemap];

    MAPA.setPaintProperty('grid-lines', 'line-color', style.lineColor);
    MAPA.setPaintProperty('grid-lines', 'line-opacity', style.lineOpacity);
    MAPA.setPaintProperty('grid-labels', 'text-color', style.textColor);
    MAPA.setPaintProperty('grid-labels', 'text-halo-color', style.textHalo);
}

function wireBasemapGridStyle(MAPA) {
    if (MAPA._gridBasemapWired) return;
    MAPA._gridBasemapWired = true;

    ['btn-osm', 'btn-esri'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => applyGridBasemapStyle(MAPA));
        }
    });

    applyGridBasemapStyle(MAPA);
}

// 3. Función constructora inicial (Fuentes, Capas, Eventos y Botón HTML)
function initCoordinateGrid(MAPA) {
    // Crear fuentes GeoJSON si no existen
    if (!MAPA.getSource('grid-src')) {
        MAPA.addSource('grid-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!MAPA.getSource('label-src')) {
        MAPA.addSource('label-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    // Capa de Líneas (Inicialmente oculta)
    if (!MAPA.getLayer('grid-lines')) {
        MAPA.addLayer({
            id: 'grid-lines', type: 'line', source: 'grid-src',
            layout: { 'visibility': 'none' },
            paint: { 'line-color': '#000000', 'line-width': 0.8, 'line-opacity': 0.25 }
        });
    }

    // Capa de Números/Etiquetas (Inicialmente oculta)
    if (!MAPA.getLayer('grid-labels')) {
        MAPA.addLayer({
            id: 'grid-labels', type: 'symbol', source: 'label-src',
            layout: {
                'visibility': 'none',
                'text-field': ['get', 'text'], 
                'text-size': 11,
                'text-allow-overlap': true, 
                'text-ignore-placement': true
            },
            paint: { 
                'text-color': '#333333', 
                'text-halo-color': '#ffffff', 
                'text-halo-width': 1.5 
            }
        });
    }

    // Vincular el recálculo al movimiento del mapa (una sola vez)
    if (!MAPA._gridMoveHandler) {
        MAPA._gridMoveHandler = () => triggerGridUpdate(MAPA);
        MAPA.on('move', MAPA._gridMoveHandler);
    }

    triggerGridUpdate(MAPA);
    wireGridButton(MAPA);
    wireBasemapGridStyle(MAPA);
}

window.applyGridBasemapStyle = applyGridBasemapStyle;

function toggleCoordinateGrid(MAPA) {
    if (!MAPA?.getLayer('grid-lines') || !MAPA.getLayer('grid-labels')) return;
    const currentVis = MAPA.getLayoutProperty('grid-lines', 'visibility') || 'none';
    const nextVis = currentVis === 'none' ? 'visible' : 'none';
    MAPA.setLayoutProperty('grid-lines', 'visibility', nextVis);
    MAPA.setLayoutProperty('grid-labels', 'visibility', nextVis);
}

function wireGridButton(MAPA) {
    const btn = document.getElementById('grid-btn');
    if (!btn || btn._gridWired) return;
    btn._gridWired = true;
    btn.addEventListener('click', () => toggleCoordinateGrid(MAPA));
}
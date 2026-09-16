const MEASURE_SOURCE_ID = 'measure-source';
const MEASURE_LINE_LAYER_ID = 'measure-lines';
const MEASURE_FILL_LAYER_ID = 'measure-polygons';
const MEASURE_POINT_LAYER_ID = 'measure-points';

const EARTH_RADIUS_METERS = 6371008.8;
const NAUTICAL_MILE_METERS = 1852;
const RESULT_DECIMALS = 1;

const DISTANCE_UNITS = {
    meters: { factor: 1, label: 'm' },
    kilometers: { factor: 1 / 1000, label: 'km' },
    nauticalmiles: { factor: 1 / NAUTICAL_MILE_METERS, label: 'nmi' }
};

const AREA_UNITS = {
    m2: { factor: 1, label: 'm²' },
    hectares: { factor: 1 / 10000, label: 'ha' },
    km2: { factor: 1 / 1000000, label: 'km²' }
};

const state = {
    map: null,
    mode: null,
    drawing: false,
    coordinates: []
};

function initMeasureTool(map) {
    state.map = map;

    const btnMeasure = document.getElementById('measure-btn');
    const panel = document.getElementById('measure-panel');
    const btnDistance = document.getElementById('btn-distance');
    const btnArea = document.getElementById('btn-area');
    const btnClear = document.getElementById('btn-clear');
    const unitDistance = document.getElementById('unit-distance');
    const unitArea = document.getElementById('unit-area');

    if (!btnMeasure || !panel || !btnDistance || !btnArea || !btnClear || !unitDistance || !unitArea) {
        console.warn('Measure tool controls were not found.');
        return;
    }

    map.on('load', ensureMeasureLayers);
    if (map.loaded()) ensureMeasureLayers();

    btnMeasure.addEventListener('click', () => {
        $('#tool-panel, #layers-panel, #search-panel, #add-panel, #captura-panel, #malla-panel, #wind-panel').hide();
        $('#measure-panel').toggle();
        if (!panelIsVisible(panel)) deactivateMode();
    });

    btnDistance.addEventListener('click', () => setMode('distance'));
    btnArea.addEventListener('click', () => setMode('area'));
    btnClear.addEventListener('click', clearMeasurement);
    unitDistance.addEventListener('change', updateResult);
    unitArea.addEventListener('change', updateResult);

    map.on('click', handleMapClick);
    map.on('dblclick', handleDoubleClick);
    map.on('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);
}

function ensureMeasureLayers() {
    const map = state.map;
    if (!map || map.getSource(MEASURE_SOURCE_ID)) return;

    map.addSource(MEASURE_SOURCE_ID, {
        type: 'geojson',
        data: emptyFeatureCollection()
    });

    map.addLayer({
        id: MEASURE_FILL_LAYER_ID,
        type: 'fill',
        source: MEASURE_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
            'fill-color': '#2563eb',
            'fill-opacity': 0.22
        }
    });

    map.addLayer({
        id: MEASURE_LINE_LAYER_ID,
        type: 'line',
        source: MEASURE_SOURCE_ID,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']],
        paint: {
            'line-color': '#2563eb',
            'line-width': 3
        }
    });

    map.addLayer({
        id: MEASURE_POINT_LAYER_ID,
        type: 'circle',
        source: MEASURE_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-color': '#2563eb',
            'circle-stroke-width': 2
        }
    });
}

function setMode(mode) {
    state.mode = mode;
    state.drawing = true;
    state.coordinates = [];
    state.map.doubleClickZoom.disable();
    setMapCursor('crosshair');
    setActiveButton(mode);
    updateUi();
    updateMeasureSource();
    hideResult();
}

function deactivateMode() {
    state.mode = null;
    state.drawing = false;
    state.coordinates = [];
    if (state.map) state.map.doubleClickZoom.enable();
    setMapCursor('');
    setActiveButton(null);
    updateUi();
    updateMeasureSource();
}

function clearMeasurement() {
    state.coordinates = [];
    state.drawing = false;
    state.mode = null;
    if (state.map) state.map.doubleClickZoom.enable();
    setMapCursor('');
    setActiveButton(null);
    updateUi();
    updateMeasureSource();
    hideResult();
}

function handleMapClick(event) {
    if (!state.mode || !state.drawing) return;
    state.coordinates.push([event.lngLat.lng, event.lngLat.lat]);
    updateMeasureSource();
    updateResult();
}

function handleMouseMove(event) {
    if (!state.mode || !state.drawing || state.coordinates.length === 0) return;
    updateMeasureSource([event.lngLat.lng, event.lngLat.lat]);
}

function handleDoubleClick(event) {
    if (!state.mode || !state.drawing) return;
    event.preventDefault();
    finishDrawing();
}

function handleKeyDown(event) {
    if (!state.mode) return;
    if (event.key === 'Enter') finishDrawing();
    if (event.key === 'Escape') clearMeasurement();
}

function finishDrawing() {
    const minimumPoints = state.mode === 'area' ? 3 : 2;
    if (state.coordinates.length < minimumPoints) return;

    state.drawing = false;
    if (state.map) state.map.doubleClickZoom.enable();
    setMapCursor('');
    setActiveButton(null);
    updateUi();
    updateMeasureSource();
    updateResult();
}

function updateMeasureSource(previewCoordinate = null) {
    const map = state.map;
    const source = map && map.getSource(MEASURE_SOURCE_ID);
    if (!source) return;

    const coordinates = previewCoordinate ? [...state.coordinates, previewCoordinate] : [...state.coordinates];
    const features = coordinates.map((coordinate) => ({
        type: 'Feature',
        properties: { kind: 'vertex' },
        geometry: { type: 'Point', coordinates: coordinate }
    }));

    if (state.mode === 'area' && coordinates.length >= 3) {
        features.push({
            type: 'Feature',
            properties: { kind: 'measure' },
            geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
        });
    } else if (coordinates.length >= 2) {
        features.push({
            type: 'Feature',
            properties: { kind: 'measure' },
            geometry: { type: 'LineString', coordinates }
        });
    }

    source.setData({
        type: 'FeatureCollection',
        features
    });
}

function updateResult() {
    const resultBox = document.getElementById('measure-result');
    if (!resultBox || state.coordinates.length === 0) return;

    let text = '';
    if (state.mode === 'area' && state.coordinates.length >= 3) {
        const unitKey = document.getElementById('unit-area').value;
        const unit = AREA_UNITS[unitKey];
        const value = polygonAreaMeters(state.coordinates) * unit.factor;
        text = `Area: ${value.toFixed(RESULT_DECIMALS)} ${unit.label}`;
    } else if (state.coordinates.length >= 2) {
        const unitKey = document.getElementById('unit-distance').value;
        const unit = DISTANCE_UNITS[unitKey];
        const value = lineDistanceMeters(state.coordinates) * unit.factor;
        text = `Distance: ${value.toFixed(RESULT_DECIMALS)} ${unit.label}`;
    }

    resultBox.textContent = text;
    resultBox.style.display = text ? 'block' : 'none';
}

function lineDistanceMeters(coordinates) {
    let total = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
        total += distanceMeters(coordinates[i - 1], coordinates[i]);
    }
    return total;
}

function distanceMeters(from, to) {
    const lat1 = degreesToRadians(from[1]);
    const lat2 = degreesToRadians(to[1]);
    const dLat = lat2 - lat1;
    const dLon = degreesToRadians(to[0] - from[0]);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polygonAreaMeters(coordinates) {
    const ring = [...coordinates, coordinates[0]];
    let total = 0;

    for (let i = 0; i < ring.length - 1; i += 1) {
        const lon1 = degreesToRadians(ring[i][0]);
        const lon2 = degreesToRadians(ring[i + 1][0]);
        const lat1 = degreesToRadians(ring[i][1]);
        const lat2 = degreesToRadians(ring[i + 1][1]);
        total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    return Math.abs(total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS / 2);
}

function degreesToRadians(value) {
    return value * Math.PI / 180;
}

function setActiveButton(mode) {
    document.getElementById('btn-distance').classList.toggle('active', mode === 'distance');
    document.getElementById('btn-area').classList.toggle('active', mode === 'area');
}

function updateUi() {
    const unitDistance = document.getElementById('unit-distance');
    const unitArea = document.getElementById('unit-area');
    const hint = document.getElementById('measure-hint');

    unitDistance.style.display = state.mode === 'distance' && state.drawing ? 'block' : 'none';
    unitArea.style.display = state.mode === 'area' && state.drawing ? 'block' : 'none';
    hint.style.display = state.mode && state.drawing ? 'block' : 'none';
}

function hideResult() {
    const resultBox = document.getElementById('measure-result');
    if (resultBox) resultBox.style.display = 'none';
}

function setMapCursor(cursor) {
    if (!state.map || !state.map.getCanvas) return;
    state.map.getCanvas().style.cursor = cursor;
}

function panelIsVisible(panel) {
    return window.getComputedStyle(panel).display !== 'none';
}

function emptyFeatureCollection() {
    return {
        type: 'FeatureCollection',
        features: []
    };
}

function waitForMap() {
    if (window.MAPA) {
        initMeasureTool(window.MAPA);
        return;
    }

    window.setTimeout(waitForMap, 50);
}

waitForMap();

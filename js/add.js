const typeSel = document.getElementById('typeSelector');
const PROXY = 'proxy.php';
const LOG = '[add.js]';

function log(...args) { console.log(LOG, ...args); }
function logWarn(...args) { console.warn(LOG, ...args); }
function logErr(...args) { console.error(LOG, ...args); }

function getMap() {
    return window.MAPA;
}

function resolveServiceUrl(url) {
    const trimmed = url.trim();
    if (trimmed.startsWith('/')) {
        return window.location.origin + trimmed;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        return window.location.origin + '/' + trimmed.replace(/^\/+/, '');
    }
    return trimmed;
}

function normalizeServiceUrl(url) {
    return resolveServiceUrl(url).split('?')[0].replace(/\/+$/, '');
}

function buildCapabilitiesUrl(base, service) {
    const params = new URLSearchParams({
        SERVICE: service.toUpperCase(),
        REQUEST: 'GetCapabilities'
    });
    return `${normalizeServiceUrl(base)}?${params.toString()}`;
}

/** Mateix format que layers.js */
function buildWfsFeatureUrl(base, typeName) {
    return `${normalizeServiceUrl(base)}?service=WFS&version=1.0.0&request=GetFeature&typeName=${encodeURIComponent(typeName)}&outputFormat=application%2Fjson`;
}

async function fetchService(url) {
    const resolved = url.startsWith('http') ? url : resolveServiceUrl(url);
    const sameOrigin = new URL(resolved).origin === window.location.origin;

    log('Petició GetCapabilities:', resolved);

    if (sameOrigin) {
        log('→ Mateix origen, fetch directe');
        const res = await fetch(resolved);
        if (res.ok) {
            log('✓ GetCapabilities OK (directe, mateix origen)');
            return res;
        }
        logWarn('Fetch directe ha retornat', res.status);
    } else {
        try {
            log('→ Origen extern, fetch directe amb CORS');
            const res = await fetch(resolved, { credentials: 'omit', mode: 'cors' });
            if (res.ok) {
                log('✓ GetCapabilities OK (directe, CORS)');
                return res;
            }
            logWarn('Fetch CORS ha retornat', res.status);
        } catch (e) {
            logWarn('Fetch CORS fallit, provant proxy:', e.message);
        }
    }

    log('→ Fallback via proxy:', PROXY);
    const res = await fetch(`${PROXY}?url=${encodeURIComponent(resolved)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} (proxy)`);
    log('✓ GetCapabilities OK (proxy)');
    return res;
}

function watchSourceLoad(MAPA, sourceId, meta) {
    log(`→ Afegint al mapa: "${meta.layerName}" [${meta.type}]`, {
        sourceId,
        url: meta.url || '(dades locals)'
    });

    let loaded = false;
    const timeout = setTimeout(() => {
        if (!loaded) {
            logErr(`✗ Temps d'espera esgotat (15s) carregant "${meta.layerName}"`, meta);
        }
    }, 15000);

    const onSourceData = (e) => {
        if (e.sourceId !== sourceId || !e.isSourceLoaded) return;
        loaded = true;
        clearTimeout(timeout);
        MAPA.off('sourcedata', onSourceData);

        const features = MAPA.querySourceFeatures(sourceId);
        if (features.length > 0) {
            log(`✓ Capa "${meta.layerName}" carregada correctament`, {
                sourceId,
                tipus: meta.type,
                entitats: features.length,
                subcapes: meta.sublayers?.filter(l => MAPA.getLayer(l)) || [sourceId]
            });
        } else if (meta.type === 'wfs' || meta.type === 'geojson-local') {
            logWarn(`⚠ Capa "${meta.layerName}" carregada però sense entitats al viewport actual (potser cal fer zoom)`, {
                sourceId,
                url: meta.url
            });
        } else {
            log(`✓ Capa "${meta.layerName}" (${meta.type}) registrada al mapa`, { sourceId });
        }
    };

    const onError = (e) => {
        const msg = e?.error?.message || String(e?.error || '');
        if (msg && (msg.includes(sourceId) || msg.includes('geojson') || msg.includes('Failed to fetch'))) {
            loaded = true;
            clearTimeout(timeout);
            logErr(`✗ Error  MapLibre "${meta.layerName}"`, {
                sourceId,
                error: e.error,
                url: meta.url
            });
        }
    };

    MAPA.on('sourcedata', onSourceData);
    MAPA.on('error', onError);
}

function getSelectedLayerName() {
    return document.getElementById('selLayers').value
        || document.getElementById('inpLayerName').value.trim();
}

typeSel.onchange = () => {
    const v = typeSel.value;
    document.getElementById('fileCont').style.display = (v === 'geojson-local') ? 'block' : 'none';
    document.getElementById('urlCont').style.display = (v === 'geojson-local' || v === 'osm') ? 'none' : 'block';
};
typeSel.dispatchEvent(new Event('change'));
// --- EXPLORACIÓ WMS/WFS (via proxy same-origin) ---
document.getElementById('btnExplore').onclick = async () => {
    const type = typeSel.value;
    const baseUrl = document.getElementById('inpUrl').value;
    if (!baseUrl.trim()) {
        alert('Enter the server URL.');
        return;
    }

    try {
        const capUrl = buildCapabilitiesUrl(baseUrl, type);
        log(`Explorant servei ${type.toUpperCase()}...`, { baseUrl, capUrl });

        const res = await fetchService(capUrl);
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
        const selector = type === 'wms' ? 'Layer > Name' : 'FeatureType > Name';
        const layers = xml.querySelectorAll(selector);
        const sel = document.getElementById('selLayers');
        sel.innerHTML = '';

        if (!layers.length) {
            logWarn('Exploració OK però cap capa trobada al XML');
            alert('Failed layers service');
            return;
        }

        const names = [];
        layers.forEach(l => {
            const opt = document.createElement('option');
            opt.value = opt.textContent = l.textContent;
            sel.appendChild(opt);
            names.push(l.textContent);
        });
        log(`✓ ${names.length} layers:`, names);
    } catch (e) {
        logErr('✗ Error exploring service:', e.message || e);
        alert('Failed to explore service.');
    }
};

// --- AFEGIR CAPA ---
document.getElementById('btnAdd').onclick = async () => {
    const MAPA = getMap();
    if (!MAPA) {
        alert('Loading map');
        return;
    }

    const type = typeSel.value;
    const id = 'lyr-' + Date.now();
    let label = 'Capa';

    try {
        const fromSelect = document.getElementById('selLayers').value;
        const fromInput = document.getElementById('inpLayerName').value.trim();
        log('--- ADD LAYER ---', { tipus: type, id, capaSelect: fromSelect || '(buit)', capaManual: fromInput || '(buit)' });

        if (type === 'geojson-local') {
            const file = document.getElementById('inpFile').files[0];
            if (!file) {
                alert('Select a GEOJson file');
                return;
            }
            const data = JSON.parse(await file.text());
            log(`Capa escollida: fitxer "${file.name}"`, { features: data.features?.length ?? '?' });
            addGeoJSON(MAPA, id, data, file.name);
            label = file.name;
        } else if (type === 'wfs') {
            const layer = getSelectedLayerName();
            if (!layer) {
                alert('Explore service ');
                return;
            }
            const baseUrl = document.getElementById('inpUrl').value;
            const wfsUrl = buildWfsFeatureUrl(baseUrl, layer);
            log(`Capa escollida: "${layer}"`, {
                origen: fromSelect ? 'desplegable' : 'camp manual',
                wfsUrl
            });
            addWfsFromUrl(MAPA, id, wfsUrl, layer);
            label = layer;
        } else if (type === 'wms') {
            const layer = getSelectedLayerName();
            if (!layer) {
                alert('Explore service');
                return;
            }
            log(`Capa escollida: "${layer}"`, { origen: fromSelect ? 'desplegable' : 'camp manual' });
            addWMS(MAPA, id, document.getElementById('inpUrl').value, layer);
            label = layer;
        } else if (type === 'osm') {
            log('Capa escollida: OpenStreetMap');
            addOSM(MAPA, id);
            label = 'OpenStreetMap';
        }

        createControl(id, label, type);
        log(`Layer control: "${label}" (${id})`);
    } catch (e) {
        logErr('✗ Error adding layer:', e.message || e);
        alert('Failed to add layer. Check console for details..');
    }
};

function addWMS(MAPA, id, baseUrl, layer) {
    const url = `${normalizeServiceUrl(baseUrl)}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer)}&STYLES=&FORMAT=image/png&TRANSPARENT=true&WIDTH=256&HEIGHT=256&CRS=EPSG:3857&BBOX={bbox-epsg-3857}`;
    MAPA.addSource(id, { type: 'raster', tiles: [url], tileSize: 256 });
    MAPA.addLayer({ id, type: 'raster', source: id });
    watchSourceLoad(MAPA, id, { layerName: layer, type: 'wms', url });
}

function addOSM(MAPA, id) {
    const url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    MAPA.addSource(id, { type: 'raster', tiles: [url], tileSize: 256 });
    MAPA.addLayer({ id, type: 'raster', source: id });
    watchSourceLoad(MAPA, id, { layerName: 'OpenStreetMap', type: 'osm', url });
}

/** Carrega WFS igual que layers.js: URL directa a MapLibre */
function addWfsFromUrl(MAPA, id, url, layerName) {
    MAPA.addSource(id, { type: 'geojson', data: url });
    const sublayers = [id + '-l', id + '-p', id + '-f'];
    MAPA.addLayer({
        id: id + '-l', type: 'line', source: id,
        paint: { 'line-color': '#2ecc71', 'line-width': 2, 'line-opacity': 0.9 }
    });
    MAPA.addLayer({
        id: id + '-p', type: 'circle', source: id,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-color': '#e74c3c', 'circle-radius': 5, 'circle-opacity': 0.9 }
    });
    MAPA.addLayer({
        id: id + '-f', type: 'fill', source: id,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#3498db', 'fill-opacity': 0.5 }
    });
    watchSourceLoad(MAPA, id, { layerName, type: 'wfs', url, sublayers });
}

function addVectorLayers(MAPA, id) {
    MAPA.addLayer({ id: id + '-f', type: 'fill', source: id, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#3498db', 'fill-opacity': 0.5 } });
    MAPA.addLayer({ id: id + '-l', type: 'line', source: id, filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']], paint: { 'line-color': '#2ecc71', 'line-width': 2 } });
    MAPA.addLayer({ id: id + '-p', type: 'circle', source: id, filter: ['==', '$type', 'Point'], paint: { 'circle-color': '#e74c3c', 'circle-radius': 5 } });
}

function fitBoundsToCoords(MAPA, coordsList) {
    const bounds = new maplibregl.LngLatBounds();
    const extend = (c) => { if (Array.isArray(c[0])) c.forEach(extend); else bounds.extend(c); };
    coordsList.forEach(extend);
    if (!bounds.isEmpty()) MAPA.fitBounds(bounds, { padding: 50 });
}

function addGeoJSON(MAPA, id, data, layerName) {
    MAPA.addSource(id, { type: 'geojson', data });
    addVectorLayers(MAPA, id);
    const sublayers = [id + '-f', id + '-l', id + '-p'];
    if (data.features?.length) {
        log(`✓ GeoJSON local "${layerName}" parsejat`, { features: data.features.length });
        fitBoundsToCoords(MAPA, data.features.map(f => f.geometry.coordinates));
    } else {
        logWarn(`⚠ GeoJSON "${layerName}" sense features`);
    }
    watchSourceLoad(MAPA, id, { layerName, type: 'geojson-local', sublayers });
}

// --- CONTROL DE CAPES I SIMBOLOGIA ---
function createControl(id, label, type) {
    const isVector = (type === 'geojson-local' || type === 'wfs');
    const div = document.createElement('div');
    div.className = 'layer-card';
    div.id = 'card-' + id;

    div.innerHTML = `
    <div class="layer-header">
    
        <div class="layer-left">
            <input
                type="checkbox"
                checked
                onclick="toggleLyr('${id}', this.checked)"
                class="layer-check">
    
            <span class="layer-title">${label}</span>
        </div>
    
        <div class="layer-actions">
    
            <button class="icon-btn"
                    onclick="moveLyr('${id}', -1)"
                    title="Up">
                ⬆
            </button>
    
            <button class="icon-btn"
                    onclick="moveLyr('${id}', 1)"
                    title="Down">
                ⬇
            </button>
         
    
            ${isVector ? `
                <button class="icon-btn style-btn"
                        onclick="toggleEditor('${id}')"
                        title="Edit"><img src="img/pen-to-square-solid-full.svg"
            class="icono">
                </button>
            ` : ''}


            <button class="icon-btn delete-btn"
                    onclick="removeLyr('${id}')"
                    title="Delete layer">
                ✕
            </button>
    
        </div>
    
    </div>
    
    ${isVector ? `
    <div id="editor-${id}" class="symbol-editor">
    
        <div class="editor-row">
            <label>Color</label>
            <input type="color"
                   value="#3498db"
                   oninput="updateSymbol('${id}','color',this.value)">
        </div>
    
        <div class="editor-row">
            <label>Outline color</label>
            <input type="color"
                   value="#2ecc71"
                   oninput="updateSymbol('${id}','outlineColor',this.value)">
        </div>
    
        <div class="editor-row">
            <label>Size</label>
            <input type="range"
                   min="1"
                   max="20"
                   value="3"
                   oninput="updateSymbol('${id}','size',this.value)">
        </div>
    
        <div class="editor-row">
            <label>Opacity</label>
            <input type="range"
                   min="0"
                   max="1"
                   step="0.1"
                   value="0.7"
                   oninput="updateSymbol('${id}','opacity',this.value)">
        </div>
    
    </div>
    ` : ''}
    `;
    document.getElementById('layerControl').prepend(div);
}

window.toggleEditor = (id) => {
    const el = document.getElementById('editor-' + id);
    el.style.display = (el.style.display === 'block') ? 'none' : 'block';
};

window.updateSymbol = (id, property, value) => {
    const MAPA = getMap();
    if (!MAPA) return;

    if (property === 'color') {
        if (MAPA.getLayer(id + '-f')) MAPA.setPaintProperty(id + '-f', 'fill-color', value);
        if (MAPA.getLayer(id + '-p')) MAPA.setPaintProperty(id + '-p', 'circle-color', value);
    } else if (property === 'outlineColor') {
        if (MAPA.getLayer(id + '-l')) MAPA.setPaintProperty(id + '-l', 'line-color', value);
    } else if (property === 'size') {
        if (MAPA.getLayer(id + '-l')) MAPA.setPaintProperty(id + '-l', 'line-width', parseFloat(value));
        if (MAPA.getLayer(id + '-p')) MAPA.setPaintProperty(id + '-p', 'circle-radius', parseFloat(value));
    } else if (property === 'opacity') {
        if (MAPA.getLayer(id + '-f')) MAPA.setPaintProperty(id + '-f', 'fill-opacity', parseFloat(value));
        if (MAPA.getLayer(id + '-l')) MAPA.setPaintProperty(id + '-l', 'line-opacity', parseFloat(value));
        if (MAPA.getLayer(id + '-p')) MAPA.setPaintProperty(id + '-p', 'circle-opacity', parseFloat(value));
    }
};

window.toggleLyr = (id, v) => {
    const MAPA = getMap();
    if (!MAPA) return;
    const s = v ? 'visible' : 'none';
    [id + '-f', id + '-l', id + '-p', id].forEach(l => { if (MAPA.getLayer(l)) MAPA.setLayoutProperty(l, 'visibility', s); });
};

window.removeLyr = (id) => {
    const MAPA = getMap();
    if (!MAPA) return;
    [id + '-f', id + '-l', id + '-p', id].forEach(l => { if (MAPA.getLayer(l)) MAPA.removeLayer(l); });
    if (MAPA.getSource(id)) MAPA.removeSource(id);
    document.getElementById('card-' + id).remove();
};

window.moveLyr = (id, direction) => {
    const MAPA = getMap();
    if (!MAPA) return;

    const card = document.getElementById('card-' + id);
    const container = document.getElementById('layerControl');

    if (direction === -1 && card.previousElementSibling) {
        container.insertBefore(card, card.previousElementSibling);
    } else if (direction === 1 && card.nextElementSibling) {
        container.insertBefore(card.nextElementSibling, card);
    } else {
        return;
    }

    syncLayerOrder();
};

function syncLayerOrder() {
    const MAPA = getMap();
    if (!MAPA) return;

    const cards = Array.from(document.getElementById('layerControl').children);

    for (let i = cards.length - 1; i >= 0; i--) {
        const id = cards[i].id.replace('card-', '');
        const sublayers = [id + '-f', id + '-l', id + '-p', id];
        sublayers.forEach(layerId => {
            if (MAPA.getLayer(layerId)) MAPA.moveLayer(layerId);
        });
    }
}

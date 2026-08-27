import { LoadLayers } from './layers.js';
import { initCruiseDataPanel } from './cruiseCharts.js';

const WS_VESSEL = {
    ODB: "https://datahub.utm.csic.es/ws/getPoint/ODB/JSON/",
    SDG: "https://datahub.utm.csic.es/ws/getPoint/SDG/JSON/",
    HES: "https://datahub.utm.csic.es/ws/getPoint/HES/JSON/"
};

const VESSEL_NAME = {
    "HES": "Hespérides",
    "SDG": "Sarmiento de Gamboa",
    "ODB": "Odón de Buen"
};

const VESSEL_IDS_TRACK = ["SDG", "HES", "ODB"];

let latestPos = {
    ODB: null,
    SDG: null,
    HES: null
};
const COLOR_VESSEL = { ODB: "#CFCFCF", SDG: "#CFCFCF", HES: "#CFCFCF" };

const TRACK_COLORS = {
    "24": "#B61600",  // #B61600 VERMELL
    "72": "#C8553E",  // #C8553E  TARONJA
    "144": "#F18F3A"  // #F18F3A  GROC
};

const SKY_NIGHT = {
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 4, 0.6, 7, 0],
    'sky-color': '#0b1d3a',
    'horizon-color': '#2a6fd0',
    'fog-color': '#bcd8ff',
    'sky-horizon-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.0
};

const SKY_DAY = {
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.7, 7, 0],
    'sky-color': '#5aa6f0',
    'horizon-color': '#cfeaff',
    'fog-color': '#ffffff',
    'sky-horizon-blend': 0.7,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.0
};

function applySky(mode) {
    if (typeof MAPA.setSky !== 'function') return;
    MAPA.setSky(mode === 'day' ? SKY_DAY : SKY_NIGHT);
}

// 1. Obtenemos el estilo que genera tu función actual
let estiloConfigurado = getStyle("mercator");

// CASO A: Si getStyle devuelve un OBJETO JSON, le inyectamos las fuentes directamente
if (typeof estiloConfigurado === 'object' && estiloConfigurado !== null) {
    estiloConfigurado.glyphs = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
}

// 2. Inicializamos el objeto MAPA
const MAPA = new maplibregl.Map({
    container: "map",
    style: estiloConfigurado,
    center: [0, 30],
    zoom: 2,
    minZoom: 1.5,
    attributionControl: false,

});

// CASO B: Si getStyle devuelve un STRING (una URL externa como 'https://.../style.json')
// Este evento se ejecuta en cuanto se descarga el JSON de la URL, le añade las fuentes y actualiza el mapa
MAPA.on('style.load', () => {
    const style = MAPA.getStyle();
    if (style && !style.glyphs) {
        style.glyphs = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
        MAPA.setStyle(style); // Parche dinámico y seguro
    }
});


window.MAPA = MAPA;
let starfieldCtrl = null;

const vesselPopups = {};
const popupIntervals = {};


function getStyle(projectionType = "mercator") {
    return {
        version: 8,
        sources: {
            osm: {
                type: "raster",
                tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors'"
            },
            "esri-source": {
                type: "raster",
                tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                tileSize: 256,
                attribution: "Tiles ©  <a href='https://www.esri.com/'>Esri</a> — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"

            }
        },
        layers: [
            {
                id: "osm-layer",
                type: "raster",
                source: "osm",
                layout: { "visibility": "none" } // Apagada por defecto
            },
            {
                id: "esri-layer",
                type: "raster",
                source: "esri-source",
                layout: { "visibility": "visible" } // Encendida por defecto
            }
        ],
        projection: { type: projectionType }
    };
}


MAPA.addControl(new maplibregl.NavigationControl(), "top-right");
MAPA.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

function createBoatImage(color) {
    const ICONO_VESSEL = document.createElement('canvas');
    ICONO_VESSEL.width = 150;
    ICONO_VESSEL.height = 150;
    const ctx = ICONO_VESSEL.getContext('2d');
    const ORIGIN_X = 66,
        ORIGIN_Y = 85,
        SCALE_X = 0.18,
        SCALE_Y = 0.18;

    ctx.beginPath();
    ctx.moveTo(ORIGIN_X, ORIGIN_Y);
    ctx.bezierCurveTo(ORIGIN_X, ORIGIN_Y + (80 * SCALE_Y), ORIGIN_X + (100 * SCALE_X), ORIGIN_Y + (80 * SCALE_Y), ORIGIN_X + (100 * SCALE_X), ORIGIN_Y);
    ctx.quadraticCurveTo(ORIGIN_X + (100 * SCALE_X), ORIGIN_Y - (100 * SCALE_Y), ORIGIN_X + (50 * SCALE_X), ORIGIN_Y - (200 * SCALE_Y));
    ctx.quadraticCurveTo(ORIGIN_X, ORIGIN_Y - (100 * SCALE_Y), ORIGIN_X, ORIGIN_Y);
    ctx.fillStyle = color;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    ctx.closePath();
    const image = new Image();
    return new Promise(resolve => { image.onload = () => resolve(image); image.src = ICONO_VESSEL.toDataURL(); });
}
async function loadVesselIcons(mapInstance) {
    await Promise.all(Object.keys(COLOR_VESSEL).map(async key => {
        const img = await createBoatImage(COLOR_VESSEL[key]);
        if (!mapInstance.hasImage(`icon-${key}`)) mapInstance.addImage(`icon-${key}`, img);
    }));
}

// --- LÒGICA DADES SENSOR ---
function formatDateTime(d, t) {
    if (!d || !t) return "--";
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)} ${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}
//CANVI APLICAT A 04/05 comentar amb Xavi
/*function decimalToDMS(d) {
    if (isNaN(d)) return "--";
    const deg = Math.floor(d),
        min = Math.floor((d - deg) * 60), sec = ((d - deg - min / 60) * 3600).toFixed(2); return `${deg}° ${min}' ${sec}"`;
}*/
function decimalToDMS(d) {
    if (isNaN(d)) return "--";

    const absoluteD = Math.abs(d);
    const sign = d < 0 ? "-" : "";

    const deg = Math.floor(absoluteD);
    const min = Math.floor((absoluteD - deg) * 60);
    const sec = ((absoluteD - deg - min / 60) * 3600).toFixed(2);

    return `${sign}${deg}° ${min}' ${sec}"`;
}
function parseAndFormat(v) { let p = parseFloat(v); return isNaN(p) ? "--" : p.toFixed(2); }

window.actualizarDatosNAV = function () {
    const v = $('#vessel-selector').val();
    $.get(`https://datahub.utm.csic.es/udp/${v}POS`, (data) => {
        const rows = data.trim().split('\n'), cols = rows[rows.length - 1].split(',');
        latestPos[v] = [parseFloat(cols[3]), parseFloat(cols[4])];
        $('#last').text(formatDateTime(cols[1], cols[2]));
        $('#lat').text(decimalToDMS(parseFloat(cols[4])));
        $('#lon').text(decimalToDMS(parseFloat(cols[3])));
        $('#depth').text(cols[7] || "--"); $('#sog').text(cols[9] || "--");
        if ($('#followVessel').is(':checked') && latestPos[v]) MAPA.easeTo({ center: latestPos[v] });
    }, 'text');
};
window.actualizarDatosMET = function () {
    const v = $('#vessel-selector').val();
    $.get(`https://datahub.utm.csic.es/udp/${v}MET`, (data) => {
        const r = data.trim().split('\n'), c = r[r.length - 1].split(',');
        const i = {
            'ODB': { d: 1, t: 2, s: 3, tp: 5, p: 9 },
            'HES': { d: 1, t: 2, s: 3, tp: 6, p: 9 },
            'SDG': { d: 1, t: 2, s: 4, tp: 6, p: 10 }
        }[v];
        if (i) {
            $('#lastMET').text(formatDateTime(c[i.d], c[i.t]));
            $('#wind_speed').text(parseAndFormat(c[i.s]));
            $('#air_temp').text(parseAndFormat(c[i.tp]));
            $('#pressure').text(parseAndFormat(c[i.p]));
        }
    }, 'text');
};
window.actualizarDatosTSS = function () {
    const v = $('#vessel-selector').val();
    $.get(`https://datahub.utm.csic.es/udp/${v}TSS`, (data) => {
        const r = data.trim().split('\n'), c = r[r.length - 1].split(',');
        const i = { 'ODB': { d: 1, t: 2, tp: 5, s: 7 }, 'HES': { d: 1, t: 2, tp: 3, s: 4 }, 'SDG': { d: 1, t: 2, tp: 3, s: 4 } }[v];
        if (i) {
            $('#lastTSS').text(formatDateTime(c[i.d], c[i.t]));
            $('#salinity').text(parseAndFormat(c[i.s]));
            $('#water_temp').text(parseAndFormat(c[i.tp]));
        }
    }, 'text');
};

window.zoomToVessel = () => { const c = latestPos[$('#vessel-selector').val()]; if (c) MAPA.flyTo({ center: c, zoom: 8 }); };

// --- MAPA VAIXELLS I POPUPS ---
async function updateVesselsOnMap() {

    const bounds = new maplibregl.LngLatBounds();
    let validPoints = 0;

    const DIBUIXAR_VESSEL = Object.keys(WS_VESSEL).map(async (id) => {
        try {
            const res = await fetch(WS_VESSEL[id] + "?_=" + Date.now());
            const data = await res.json();

            if (data && data.geometry && data.geometry.coordinates) {
                const coords = data.geometry.coordinates;
                bounds.extend(coords);
                validPoints++;
            }

            if (!MAPA.getSource(id)) {
                MAPA.addSource(id, { type: "geojson", data });
                MAPA.addLayer({
                    id, type: "symbol", source: id,
                    layout: {
                        "icon-image": `icon-${id}`, "icon-size": 0.8,
                        "icon-allow-overlap": true,
                        "icon-rotate": ["to-number", ["coalesce", ["get", "heading"], ["get", "COG"], 0]]
                    }
                });
                addInteractionToLayer(id);
            } else {
                MAPA.getSource(id).setData(data);
            }
        } catch (e) {
            console.error(`❌ Error processant el vaixell ${id}:`, e);
        }
    });

    await Promise.all(DIBUIXAR_VESSEL);
    if (validPoints > 0 && !window.mapCenteredInitially) {
        try {
            MAPA.fitBounds(bounds, {
                padding: 100,
                maxZoom: 6
            });
            window.mapCenteredInitially = true;

        } catch (err) {
            console.error("❌ Error executant fitBounds:", err);
        }
    }
}

function addInteractionToLayer(layerId) {
    if (!MAPA.getLayer(layerId)) return;
    MAPA.on('click', layerId, (e) => {
        $('#vessel-selector').val(layerId).trigger('change');
        if (vesselPopups[layerId]) return;
        const initialCoords = e.features[0].geometry.coordinates.slice();

        vesselPopups[layerId] = new maplibregl.Popup({ closeButton: false })
            .setLngLat(initialCoords)
            .setHTML(`<div style="font-size:9px; background:rgba(255,255,255,0.9); padding:5px;"><b>${VESSEL_NAME[layerId]}</b><br>Cargando...</div>`)
            .addTo(MAPA);

        const actualizarPopup = () => {
            $.get(`https://datahub.utm.csic.es/udp/${layerId}POS`, (data) => {
                const rows = data.trim().split('\n');
                const cols = rows[rows.length - 1].split(',');

                const lastDate = formatDateTime(cols[1], cols[2]);
                const sog = cols[9] || "--";
                const lng = parseFloat(cols[3]);
                const lat = parseFloat(cols[4]);

                const html = `<div style="font-size:9px; background:rgba(255,255,255,0.9); padding:5px;">
                                <b>${VESSEL_NAME[layerId]}</b><br>
                                ${lastDate}<br>
                                ${sog} Kn
                              </div>`;


                if (vesselPopups[layerId]) {
                    vesselPopups[layerId].setHTML(html);
                    if (!isNaN(lng) && !isNaN(lat)) {
                        vesselPopups[layerId].setLngLat([lng, lat]);
                    }
                }
            }, 'text');
        };


        actualizarPopup();

        popupIntervals[layerId] = setInterval(actualizarPopup, 1000);

        vesselPopups[layerId].on('close', () => {
            clearInterval(popupIntervals[layerId]);
            delete popupIntervals[layerId];
            delete vesselPopups[layerId];
        });
    });

    MAPA.on('mouseenter', layerId, () => MAPA.getCanvas().style.cursor = 'pointer');
    MAPA.on('mouseleave', layerId, () => MAPA.getCanvas().style.cursor = '');
}


// --- INICIALITZACIÓ ---
MAPA.on("load", () => {
    initCruiseDataPanel(MAPA);
    LoadLayers(MAPA);
    applySky('night');

    loadVesselIcons(MAPA).then(() => {
        updateVesselsOnMap();
        setInterval(updateVesselsOnMap, 10000);
        setInterval(() => { actualizarDatosNAV(); actualizarDatosMET(); actualizarDatosTSS(); }, 2000);
        startTrackUpdates();
    });
    starfieldCtrl = initStarfield();

    document.getElementById('starfield').style.display = 'none';
});

// --- LISTENERS GENERALS ---

$('#vessel-selector').on('change', () => { actualizarDatosNAV(); actualizarDatosMET(); actualizarDatosTSS(); });
$('input[name="basemap"]').on('change', function () {
    MAPA.setLayoutProperty('osm-layer', 'visibility', this.value === 'osm' ? 'visible' : 'none');
    MAPA.setLayoutProperty('esri-layer', 'visibility', this.value === 'esri' ? 'visible' : 'none');
    if (typeof applyGridBasemapStyle === 'function') applyGridBasemapStyle(MAPA);
});

window.cerrarIframe = function () { $('#lateral').css('left', '-500px'); $('#iframe').attr('src', ''); };
['ODB', 'SDG', 'HES', 'eez-wms'].forEach(id => {
    $(`#${id}-check, #${id}`).on('change', (e) => {
    if (MAPA.getLayer(id.replace('-check', ''))) MAPA.setLayoutProperty(id.replace('-check', ''),
            'visibility', e.target.checked ? 'visible' : 'none');
    });
});


$('#projection').on('change', (e) => {

    const projectionValue = e.target.value;
    
    // Extract base projection type (globe or mercator)
    let projType = projectionValue.split('-')[0]; // 'globe-night' -> 'globe', 'mercator' -> 'mercator'
    
    const isGlobe = (projType === 'globe');
    const isNightGlobe = (projectionValue === 'globe-night');

    console.log('Projection changed to:', projectionValue, 'Type:', projType, 'IsGlobe:', isGlobe);
    
    MAPA.setProjection({ type: projType });

    const starfield = document.getElementById('starfield');

    if (isGlobe) {
        // Show starfield for any globe mode
        starfield.style.display = 'block';
        starfieldCtrl?.start();
        
        // Apply appropriate sky based on projection mode
        if (isNightGlobe) {
            applySky('night');
            starfieldCtrl?.setMode?.('night');
        } else {
            applySky('day');
            starfieldCtrl?.setMode?.('day');
        }
    } else {
        // Mercator mode - hide starfield
        starfield.style.display = 'none';
        starfieldCtrl?.stop();
    }
});


// === LÒGICA DE RUTES: COLORS DINÀMICS + LLEGENDA + DADES ===

function startTrackUpdates() {
    refreshTracks();
    setInterval(refreshTracks, 60000);
}

$('#track-time-selector').on('change', function () {
    refreshTracks();
});

async function refreshTracks() {
    const hours = $('#track-time-selector').val() || "24";

    for (const vessel of VESSEL_IDS_TRACK) {
        try {
            const url = `https://datahub.utm.csic.es/ws/getLine/${vessel}/JSON/indexTime.php?last=${hours}&_t=${Date.now()}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error("Network error");
            const rawText = await response.text();

            // Netejar possibles comentaris '#'
            const cleanText = rawText.split('\n')
                .filter(line => line.trim() !== '' && !line.trim().startsWith('#'))
                .join('\n');

            let json;
            try { json = JSON.parse(cleanText); } catch (err) { continue; }

            const cleanGeoJSON = normalizarTrack(json);

            if (cleanGeoJSON) {
                upsertTrackLine(vessel, cleanGeoJSON, hours);
            }

        } catch (e) {
            console.warn(`Error procesando track para ${vessel}:`, e);
        }
    }
}

function normalizarTrack(data) {
    if (!data) return null;
    // Array en brut
    if (Array.isArray(data)) {
        if (data.length > 1 && Array.isArray(data[0])) {
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: data }, properties: {} };
        }
        return null;
    }
    // GeoJSON estàndard
    if (data.type === 'Feature' && data.geometry.type === 'LineString') return data;
    if (data.type === 'LineString') return { type: 'Feature', geometry: data, properties: {} };
    // FeatureCollection
    if (data.type === 'FeatureCollection') {
        let coords = [];
        data.features.forEach(f => {
            if (f.geometry) {
                if (f.geometry.type === 'Point') coords.push(f.geometry.coordinates);
                else if (f.geometry.type === 'LineString') coords = coords.concat(f.geometry.coordinates);
            }
        });
        if (coords.length >= 2) return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
    }
    return null;
}

function upsertTrackLine(vessel, trackData, hours) {
    const sourceId = `source-track-${vessel}`;
    const layerId = `layer-track-${vessel}`;
    const isChecked = $(`#${vessel}-track-check`).prop('checked');
    const selectedColor = TRACK_COLORS[hours] || "#3388FF";
    let beforeId = null;

    if (MAPA.getSource(sourceId)) {
        MAPA.getSource(sourceId).setData(trackData);
        if (MAPA.getLayer(layerId)) {
            MAPA.setPaintProperty(layerId, 'line-color', selectedColor);
        }
    } else {
        MAPA.addSource(sourceId, { type: 'geojson', data: trackData });
        const capas = MAPA.getStyle().layers;
        const capaBarcoMasBaja = capas.find(layer => ['ODB', 'SDG', 'HES'].includes(layer.id));

        if (capaBarcoMasBaja) {
            beforeId = capaBarcoMasBaja.id;
        }

        MAPA.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round',
                'visibility': isChecked ? 'visible' : 'none'
            },
            paint: {
                'line-color': selectedColor,
                'line-width': 4,
                'line-opacity': 0.8
            }
        }, beforeId);
    }

    $(`#${vessel}-track-check`).next('.legend-icon').css('background-color', selectedColor);
}

['ODB', 'SDG', 'HES'].forEach(vessel => {
    $(`#${vessel}-track-check`).on('change', (e) => {
        const layerId = `layer-track-${vessel}`;
        if (MAPA.getLayer(layerId)) {
            MAPA.setLayoutProperty(layerId, 'visibility', e.target.checked ? 'visible' : 'none');
        }
    });
});




// --- TUTORIAL ---
window.closeTutorial = function () {
    $('#tutorial-overlay').removeClass('active');
    localStorage.setItem('tutorialSeen', 'true');
};

// Comprovar si ja s'ha vist el tutorial
$(document).ready(function () {
    if (!localStorage.getItem('tutorialSeen')) {

        setTimeout(() => $('#tutorial-overlay').addClass('active'), 500);
    } else {
        // setTimeout(() => $('#tutorial-overlay').addClass('active'), 500);
    }
});

//coordenades
function toGMS(deg, isLat) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = Math.round((abs - d - m / 60) * 3600);
    const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    return `${d}°${m}'${s}"${dir}`;
}

const coordsDiv = document.getElementById('coordinates');
MAPA.on('mousemove', (e) => {
    coordsDiv.innerHTML = `${toGMS(e.lngLat.lat, true)} | ${toGMS(e.lngLat.lng, false)}`;
});

//----pestanyes---


// Capa Base estrelles o cel generades
function initStarfield() {

    const canvas = document.getElementById('starfield');
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return { start() {}, stop() {} };

    const btn = document.getElementById('globe-theme-toggle');

    let mode = "night"; // "night" | "day"
    let stars = [];
    let staticStars = [];
    let twinklers = [];
    let nightBase = null;
    let clouds = [];
    let cloudSprites = [];
    let skyBase = null;

    const STARFIELD_FPS = 30;
    const TWINKLER_COUNT = 100;
    const frameInterval = 1000 / STARFIELD_FPS;

    function createBuffer(w, h) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, w);
        c.height = Math.max(1, h);
        return c;
    }

    function generateStars(w, h) {
        stars = [];
        for (let i = 0; i < 2000; i++) {
            stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 1.3,
                a: 0.2 + Math.random() * 0.8,
                tw: 0.5 + Math.random() * 2,
                ph: Math.random() * Math.PI * 2
            });
        }
        // twinklers = brightest-by-prominence (size × alpha) so the dominant twinkle
        // (currently alpha-modulated across all stars) is preserved.
        twinklers = [...stars].sort((a, b) => (b.r * b.a) - (a.r * a.a)).slice(0, TWINKLER_COUNT);
        const twSet = new Set(twinklers);
        staticStars = stars.filter(s => !twSet.has(s));
    }

    function bakeNightBase(w, h) {
        const buf = createBuffer(w, h);
        const c = buf.getContext('2d');
        for (const s of staticStars) {
            c.fillStyle = `rgba(255,255,255,${s.a})`;
            c.beginPath();
            c.arc(Math.floor(s.x), Math.floor(s.y), s.r, 0, Math.PI * 2);
            c.fill();
        }
        return buf;
    }

    function bakeSky(w, h) {
        const buf = createBuffer(w, h);
        const c = buf.getContext('2d');
        // White background for day mode (no blue sky, no clouds)
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, h);
        return buf;
    }

    function generateClouds(w, h) {
        clouds = [];
        const cloudCount = Math.max(5, Math.round(w / 320));
        for (let i = 0; i < cloudCount; i++) {
            clouds.push({
                x: Math.random() * w,
                y: h * (0.08 + Math.random() * 0.45),
                scale: 0.5 + Math.random() * 1.3,
                speed: 4 + Math.random() * 12,
                opacity: 0.18 + Math.random() * 0.30
            });
        }
    }

    function bakeCloud(cloud) {
        const b = 55 * cloud.scale;
        // worst-case puff reach: underbelly r=1.7b at +0.25b → 1.95b down / 1.7b sideways.
        const halfW = b * 2.4;
        const halfH = b * 2.2;
        const buf = createBuffer(Math.ceil(halfW * 2), Math.ceil(halfH * 2));
        const c = buf.getContext('2d');
        drawCloud(c, halfW, halfH, cloud.scale, cloud.opacity);
        return { buf, halfW, halfH };
    }

    // -----------------------------
    // RESIZE + STAR GENERATION
    // -----------------------------
    function resize() {

        const w = window.innerWidth;
        const h = window.innerHeight;

        canvas.width = w;
        canvas.height = h;

        generateStars(w, h);
        nightBase = bakeNightBase(w, h);

        generateClouds(w, h);
        skyBase = bakeSky(w, h);
        cloudSprites = clouds.map(bakeCloud);

        repaint();
    }

    // -----------------------------
    // CLOUD HELPER
    // -----------------------------
    function puff(c, cx, cy, r, op, rgb) {
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${rgb},${op})`);
        g.addColorStop(0.55, `rgba(${rgb},${op * 0.55})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        c.fillStyle = g;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
    }

    function drawCloud(c, cx, cy, scale, opacity) {
        const b = 55 * scale;
        // soft grey-blue underbelly for depth
        puff(c, cx, cy + b * 0.25, b * 1.7, opacity * 0.35, "200,214,228");
        // bright white body
        puff(c, cx - b * 1.0, cy, b * 0.95, opacity, "255,255,255");
        puff(c, cx + b * 1.0, cy, b * 1.00, opacity, "255,255,255");
        puff(c, cx, cy - b * 0.55, b * 1.15, opacity, "255,255,255");
        puff(c, cx - b * 0.45, cy - b * 0.15, b * 0.90, opacity, "255,255,255");
        puff(c, cx + b * 0.55, cy - b * 0.10, b * 0.95, opacity, "255,255,255");
    }

    // -----------------------------
    // RENDER FRAME
    // -----------------------------
    function renderFrame(now) {

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const t = now / 1000;

        // =========================
        // 🌙 NIGHT MODE
        // =========================
        if (mode === "night") {

            ctx.drawImage(nightBase, 0, 0);

            for (const s of twinklers) {
                const a = s.a * (0.65 + 0.35 * Math.sin(t * s.tw + s.ph));
                ctx.fillStyle = `rgba(255,255,255,${a})`;
                ctx.beginPath();
                ctx.arc(Math.floor(s.x), Math.floor(s.y), s.r, 0, Math.PI * 2);
                ctx.fill();
            }

        }

        // =========================
        // ☀️ DAY MODE
        // =========================
        else {
            // Draw white background only (MapLibre globe handles the earth glare)
            ctx.drawImage(skyBase, 0, 0);
        }
    }

    let rafId = null;
    let last = 0;

    function loop(now) {
        rafId = requestAnimationFrame(loop);
        if (now - last < frameInterval) return;
        last = now - ((now - last) % frameInterval);
        renderFrame(now);
    }

    function start() {
        if (rafId === null) {
            last = 0;
            rafId = requestAnimationFrame(loop);
        }
    }

    function stop() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    function repaint() {
        renderFrame(performance.now());
    }


    // -----------------------------
    // INIT
    // -----------------------------
    resize();
    let resizeTimer = null;
    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
    }
    window.addEventListener('resize', onResize);

    canvas.dataset.mode = mode;

    return { start, stop, setMode: (newMode) => { mode = newMode; canvas.dataset.mode = mode; applySky(mode); repaint(); } };
}
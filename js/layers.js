import { openCruiseDataPanel } from "./cruiseCharts.js";
import { initWindLayers } from "./windLayers.js";

const CRUISE_LAYER_IDS = new Set(["sdgcruises", "odbcruises", "hescruises", "gdccruises"]);
const TRACK_LAYER_IDS = new Set(["sdgtracks", "odbtracks", "hestracks", "gdctracks"]);
// URL de los endpoints WFS de GeoServer
const wcp = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3AWCP&outputFormat=application%2Fjson";
const dre = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ADRE&outputFormat=application%2Fjson"
const ctd = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACTD&outputFormat=application%2Fjson"
const cor = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACOR&outputFormat=application%2Fjson"

const sdgcruises = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27SARMIENTO%20DE%20GAMBOA%27";
const odbcruises = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27OD%C3%93N%20DE%20BUEN%27";
const hescruises = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27HESP%C3%89RIDES%27";
const gdccruises = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27GARCIA%20DEL%20CID%27";

const sdgtracks = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_annual&outputFormat=application%2Fjson&cql_filter=vessel=%27SARMIENTO%20DE%20GAMBOA%27";
const odbtracks = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_annual&outputFormat=application%2Fjson&cql_filter=vessel=%27OD%C3%93N%20DE%20BUEN%27";
const hestracks = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_annual&outputFormat=application%2Fjson&cql_filter=vessel=%27HESPERIDES%27";
const gdctracks = "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_annual&outputFormat=application%2Fjson&cql_filter=vessel=%27GARCIA%20DEL%20CID%27";


// VARIABLES GLOBALES DEL MÓDULO PARA SELECCIÓN
let selectedCruiseId = null;
let activePopup = null;

/**
 * Inicializa las capas de OSM/Esri, capas WFS, WMS, malla de coordenadas y botones de utilidad
 * @param {maplibregl.Map} MAPA - Instancia del mapa de MapLibre
 */
export function LoadLayers(MAPA) {

    // ==========================================
    // 1. CONTROL DE TARJETAS VISUALES UI (capas base ya definidas en getStyle de fleet.js)
    // ==========================================
    const elements = {
        'osm': document.getElementById('btn-osm'),
        'esri': document.getElementById('btn-esri')
    };

    function switchLayer(id) {
        ['osm-layer', 'esri-layer'].forEach(lyr => {
            if (MAPA.getLayer(lyr)) {
                MAPA.setLayoutProperty(lyr, 'visibility', lyr.includes(id) ? 'visible' : 'none');
            }
        });
        Object.keys(elements).forEach(key => {
            if (elements[key]) elements[key].classList.toggle('active', key === id);
        });
    }

    if (elements['osm']) elements['osm'].onclick = () => switchLayer('osm');
    if (elements['esri']) elements['esri'].onclick = () => switchLayer('esri');

    // ==========================================
    // 3. CARGAR CAPAS EXTRA, MALLA (GRID) Y BOTONES
    // ==========================================
    addWFSLayers(MAPA);
    addEEZWMSLayer(MAPA);
    addIDEIHMWMSLayer(MAPA);
    initWindLayers(MAPA);

    initCoordinateGrid(MAPA);

    applyLayerVisibilityFromUI(MAPA);
    wireCheckboxes(MAPA);
}



// ==========================================================================
// CAPAS WFS Y POPUPS CON LOGICA DE CONTEXTO
// ==========================================================================

function addWFSLayers(MAPA) {
    try {

        const tracks = [
            { id: "gdctracks", url: gdctracks, color: "#74B9BC" },
            { id: "hestracks", url: hestracks, color: "#FFC928" },
            { id: "sdgtracks", url: sdgtracks, color: "#93B253" },
            { id: "odbtracks", url: odbtracks, color: "#FFFFFF" }
        ];

        tracks.forEach(t => {
            if (!MAPA.getSource(t.id)) {
                MAPA.addSource(t.id, { type: "geojson", data: t.url });
                MAPA.addLayer({
                    id: t.id,
                    type: "line",
                    source: t.id,
                    paint: {
                        "line-width": 1.5,
                        "line-color": t.color,
                        // Apliquem la línia discontinua aquí:
                        "line-dasharray": [2, 2]
                    }
                });
            }
        });


        const cruises = [
            { id: "gdccruises", url: gdccruises, color: "#74B9BC" },
            { id: "hescruises", url: hescruises, color: "#FFC928" },
            { id: "sdgcruises", url: sdgcruises, color: "#93B253" },
            { id: "odbcruises", url: odbcruises, color: "#FFFFFF" }
        ];

        const targetId = selectedCruiseId || "__NONE__";

        cruises.forEach(c => {
            if (!MAPA.getSource(c.id)) {
                MAPA.addSource(c.id, { type: "geojson", data: c.url });
                MAPA.addLayer({
                    id: c.id, type: "line", source: c.id,
                    paint: {
                        "line-width": [
                            "case",
                            ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cruise_id"], targetId]],
                            6, 2
                        ],
                        "line-color": c.color,
                        "line-opacity": [
                            "case",
                            ["==", targetId, "__NONE__"], 1.0,
                            ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                            0.15
                        ]
                    }
                });
            }
        });

        if (!MAPA.getSource("WCP")) {
            MAPA.addSource("WCP", { type: "geojson", data: wcp });
            MAPA.addLayer({
                id: "WCP", type: "circle", source: "WCP",
                paint: {
                    "circle-radius": [
                        "case",
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]],
                        5, 3
                    ],
                    "circle-color": "#00aaff",
                    "circle-stroke-width": 0.5,
                    "circle-stroke-color": "#fff",
                    "circle-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ],
                    "circle-stroke-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ]
                }
            });
        }
        if (!MAPA.getSource("DRE")) {
            MAPA.addSource("DRE", { type: "geojson", data: dre });
            MAPA.addLayer({
                id: "DRE", type: "circle", source: "DRE",
                paint: {
                    "circle-radius": [
                        "case",
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]],
                        5, 3
                    ],
                    "circle-color": "#5d6366",
                    "circle-stroke-width": 0.5,
                    "circle-stroke-color": "#fff",
                    "circle-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ],
                    "circle-stroke-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ]
                }
            });
        }
        if (!MAPA.getSource("CTD")) {
            MAPA.addSource("CTD", { type: "geojson", data: ctd });
            MAPA.addLayer({
                id: "CTD", type: "circle", source: "CTD",
                paint: {
                    "circle-radius": [
                        "case",
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]],
                        5, 3
                    ],
                    "circle-color": "#BC8AE8",
                    "circle-stroke-width": 0.5,
                    "circle-stroke-color": "#fff",
                    "circle-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ],
                    "circle-stroke-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ]
                }
            });
        }
        if (!MAPA.getSource("COR")) {
            MAPA.addSource("COR", { type: "geojson", data: cor });
            MAPA.addLayer({
                id: "COR", type: "circle", source: "COR",
                paint: {
                    "circle-radius": [
                        "case",
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]],
                        5, 3
                    ],
                    "circle-color": "#AF2D1B",
                    "circle-stroke-width": 0.5,
                    "circle-stroke-color": "#fff",
                    "circle-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ],
                    "circle-stroke-opacity": [
                        "case",
                        ["==", targetId, "__NONE__"], 1.0,
                        ["any", ["==", ["get", "cruiseid"], targetId], ["==", ["get", "cuiseid"], targetId], ["==", ["get", "cruise_id"], targetId]], 1.0,
                        0.15
                    ]
                }
            });
        }



    } catch (err) {
        console.warn("addWFSLayers error:", err);
    }
    registerPopupHandlers(MAPA);
}

function applyHighlight(MAPA) {
    const targetId = selectedCruiseId || "__NONE__";

    // Llista de totes les capes de tipus línia que volem gestionar
    const lineLayers = [
        "gdccruises", "hescruises", "sdgcruises", "odbcruises",
        "gdctracks", "hestracks", "sdgtracks", "odbtracks"
    ];

    // Llista de capes de tipus cercle (punts)
    const pointLayers = ["WCP", "DRE", "CTD", "COR"];

    // Expressió comuna per filtrar les propietats (redueix repeticions)
    const filterExpression = [
        "any",
        ["==", ["get", "cruiseid"], targetId],
        //    ["==", ["get", "cruiseid"], targetId], 
        ["==", ["get", "cruise_id"], targetId]
    ];

    // 1. Ressaltar Línies (Cruises i Tracks)
    lineLayers.forEach(layerId => {
        if (MAPA.getLayer(layerId)) {
            const isCruise = layerId.includes("cruises");
            MAPA.setPaintProperty(layerId, "line-width", ["case", filterExpression, isCruise ? 4 : 2, isCruise ? 2 : 1.5]);
            MAPA.setPaintProperty(layerId, "line-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
            
        }
    });

    // 2. Ressaltar Cercles (WCP, DRE, CTD, COR)
    pointLayers.forEach(layerId => {
        if (MAPA.getLayer(layerId)) {
            MAPA.setPaintProperty(layerId, "circle-radius", ["case", filterExpression, 7, 5]);
            MAPA.setPaintProperty(layerId, "circle-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
            MAPA.setPaintProperty(layerId, "circle-stroke-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
            

        }
    });
}

function clearHighlight(MAPA) {
    selectedCruiseId = null; activePopup = null;
    applyHighlight(MAPA);
}

function makePopupDraggable(popup, map) {
    const el = popup.getElement();
    if (!el) return;

    const handle = el.querySelector(".popup-drag-handle");
    if (!handle) return;

    let offset = [0, 0];
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startOffset = [0, 0];

    const onMove = (clientX, clientY) => {
        offset = [
            startOffset[0] + (clientX - startX),
            startOffset[1] + (clientY - startY)
        ];
        popup.setOffset(offset);
    };

    const pointerCoords = (e) => {
        if (e.touches?.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    };

    const onPointerDown = (e) => {
        if (e.target.closest(".maplibregl-popup-close-button")) return;
        const { x, y } = pointerCoords(e);
        dragging = true;
        startX = x;
        startY = y;
        startOffset = [...offset];
        handle.classList.add("dragging");
        map.dragPan.disable();
        e.preventDefault();
        e.stopPropagation();
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const { x, y } = pointerCoords(e);
        onMove(x, y);
        e.preventDefault();
    };

    const onPointerUp = () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove("dragging");
        map.dragPan.enable();
    };

    handle.addEventListener("mousedown", onPointerDown);
    handle.addEventListener("touchstart", onPointerDown, { passive: false });
    document.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("touchmove", onPointerMove, { passive: false });
    document.addEventListener("touchend", onPointerUp);

    popup.on("close", () => {
        document.removeEventListener("mousemove", onPointerMove);
        document.removeEventListener("mouseup", onPointerUp);
        document.removeEventListener("touchmove", onPointerMove);
        document.removeEventListener("touchend", onPointerUp);
        map.dragPan.enable();
    });
}

function showFeaturePopup(MAPA, e, feature) {
    const coords = e.lngLat;
    const props = feature.properties || {};
    const layerId = feature.layer.id;
    const cruiseId = props.cruiseid || props.cuiseid || props.cruise_id || null;
    const cruiseName = props.cruise || cruiseId;
    const isCruise = CRUISE_LAYER_IDS.has(layerId);
    const configuracionCapas = {
        "WCP": {
            campos: ["vessel", "cruiseid", "met_cat", "data_download", "data_view"],
            diccionario: {
                "vessel": "Vessel",
                "cruiseid": "ID",
                "met_cat": "Metadata",
                "data_download": "Download data",
                "data_view": "View data"
            }
        },
        "DRE": {
            campos: ["vessel", "cruiseid", "met_cat"],
            diccionario: {
                "vessel": "Vessel",
                "cruiseid": "ID",
                "met_cat": "Metadata",
            }
        },
        "CTD": {
            campos: ["vessel", "cruiseid", "met_cat"],
            diccionario: {
                "vessel": "Vessel",
                "cruiseid": "ID",
                "met_cat": "Metadata",
            }
        },
        "COR": {
            campos: ["vessel", "cruiseid", "met_cat"],
            diccionario: {
                "vessel": "Vessel",
                "cruiseid": "ID",
                "met_cat": "Metadata",
            }
        },

        "default": {
            campos: ["vessel", "year", "distance_nm", "met_cat"],
            diccionario: {
                "vessel": "Vessel",
                "distance_nm": "Distance (nm)",
                "met_cat": "Metadata",
                "year": "Year"

            }
        }
    };

    const configActual = configuracionCapas[layerId] || configuracionCapas["default"];
    const camposAMostrar = configActual.campos;
    const diccionarioNombres = configActual.diccionario;


    const nombresCompletosCapas = {
        "WCP": "Water Column Profile",
        "COR": "Sediment Corer",
        "DRE": "Dredge",
        "CTD": "CTD"    
    };
    let tituloPopup = "";
    if (layerId === "WCP" || layerId === "DRE" || layerId === "CTD" || layerId === "COR") {
        const nombreMostrar = nombresCompletosCapas[layerId] || layerId;
        tituloPopup = `<strong>Station: ${nombreMostrar}</strong>`;
    }
    else {
        const cruise = props.cruise || "";
        tituloPopup = `<strong> ${cruise}</strong>`;

    }

    let html = `<div class="popup-drag-handle" title="Drag to move">${tituloPopup}</div>`;
    html += `<table class="popup-table" style="font-size:11px; margin-top:5px;">`;

    camposAMostrar.forEach((key, index) => {
        let val = props[key];

        if (val !== null && val !== undefined && String(val).trim() !== "") {

            if (key === "distance_nm" && !isNaN(val)) {
                val = parseFloat(val).toFixed(2);
            }
            const nombreVisible = diccionarioNombres[key] || key;

            let estilos = [];

            if (key === "met_cat" || key === "vessel" || key === "distance_nm") {
                estilos.push("white-space: nowrap;");
            }

            if (index === 0) {
                estilos.push("border-top: none;");
            }

            const estiloCelda = estilos.length > 0 ? `style="${estilos.join(' ')}"` : '';

            html += `<tr>
                <td ${estiloCelda} ${index === 0 ? 'style="border-top: none;"' : ''}><strong>${nombreVisible}</strong></td>
                <td ${estiloCelda}>${val}</td>
            </tr>`;
        }
    });

    html += "</table>";

    if (isCruise && cruiseId) {
        html += `<button type="button" class="cruise-data-btn">View data</button>`;
    }
    if (activePopup) { activePopup.remove(); activePopup = null; }
    activePopup = new maplibregl.Popup({ maxWidth: "350px", closeOnClick: false, className: "draggable-popup" })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(MAPA);
    makePopupDraggable(activePopup, MAPA);

    if (isCruise && cruiseId) {
        const btn = activePopup.getElement()?.querySelector(".cruise-data-btn");
        console.log("[layers] Popup cruise:", { layerId, cruiseId, isCruise, btn: !!btn, props });
        btn?.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            console.log("[layers] Clic View data:", { cruiseId, cruiseName, layerId });
            openCruiseDataPanel(cruiseId, layerId, "met", cruiseName);
        });
    } else {
        console.log("[layers] No boton view data:", { layerId, cruiseId, isCruise });
    }

    activePopup.on("close", () => clearHighlight(MAPA));
}

function handleClick(MAPA, e) {
    if (e.features?.length) {
        if (activePopup) { activePopup.remove(); activePopup = null; }
        const feature = e.features[0];
        selectedCruiseId = feature.properties.cruiseid || feature.properties.cuiseid || feature.properties.cruise_id || null;
        showFeaturePopup(MAPA, e, feature);
        applyHighlight(MAPA);
    }
}

function registerPopupHandlers(MAPA) {
    const layerIDs = ["WCP", "sdgcruises", "odbcruises", "hescruises", "gdccruises", "COR", "DRE", "CTD"];
    layerIDs.forEach(id => {
        if (MAPA.getLayer(id)) {
            MAPA.off('click', id, (e) => handleClick(MAPA, e));
            MAPA.on('click', id, (e) => handleClick(MAPA, e));
            MAPA.on('mouseenter', id, () => MAPA.getCanvas().style.cursor = 'pointer');
            MAPA.on('mouseleave', id, () => MAPA.getCanvas().style.cursor = '');
        }
    });
}

function addEEZWMSLayer(MAPA) {
    try {
        if (!MAPA.getSource("eez-wms")) {
            MAPA.addSource("eez-wms", {
                type: "raster",
                tiles: ["https://geo.vliz.be/geoserver/MarineRegions/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=eez&STYLES=&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256"],
                tileSize: 256
            });
        }
        const before = MAPA.getLayer("sdgcruises") ? "sdgcruises" : undefined;
        if (!MAPA.getLayer("eez-wms")) {
            MAPA.addLayer({ id: "eez-wms", type: "raster", source: "eez-wms", paint: { "raster-opacity": 0.4 }, layout: { "visibility": "none" } }, before);
        }
    } catch (err) { }
}

function addIDEIHMWMSLayer(MAPA) {
    try {
        if (!MAPA.getSource("ideihm-wms")) {
            MAPA.addSource("ideihm-wms", {
                type: "raster",
                tiles: ["https://ideihm.covam.es/wms/cartaENCp4?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=ENC_ES4&STYLES=&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256"],
                tileSize: 256
            });
        }
        const before = MAPA.getLayer("sdgcruises") ? "sdgcruises" : undefined;
        if (!MAPA.getLayer("ideihm-wms")) {
            MAPA.addLayer({ id: "ideihm-wms", type: "raster", source: "ideihm-wms", paint: { "raster-opacity": 0.8 }, layout: { "visibility": "none" } }, before);
        }
    } catch (err) { }
}

const LAYER_CHECKBOX_MAP = {
    "WCP": "WCP",
    "DRE": "DRE",
    "CTD": "CTD",
    "COR": "COR",
    "sdgcruises": "sdgcruises",
    "odbcruises": "odbcruises",
    "hescruises": "hescruises",
    "gdccruises": "gdccruises",
    "sdgtracks": "sdgtracks",
    "odbtracks": "odbtracks",
    "hestracks": "hestracks",
    "gdctracks": "gdctracks",
    "ODB": "ODB",
    "SDG": "SDG",
    "HES": "HES",
    "eez-wms": "eez-wms",
    "ihm-wms": "ideihm-wms"
};

function applyLayerVisibilityFromUI(MAPA) {
    Object.entries(LAYER_CHECKBOX_MAP).forEach(([checkboxId, layerId]) => {
        const checkbox = document.getElementById(checkboxId);
        if (!checkbox || !MAPA.getLayer(layerId)) return;
        MAPA.setLayoutProperty(layerId, "visibility", checkbox.checked ? "visible" : "none");
    });
}

function wireCheckboxes(MAPA) {
    Object.entries(LAYER_CHECKBOX_MAP).forEach(([checkboxId, layerId]) => {
        const checkbox = document.getElementById(checkboxId);
        if (!checkbox) return;
        checkbox.addEventListener("change", (e) => {
            if (MAPA.getLayer(layerId)) MAPA.setLayoutProperty(layerId, "visibility", e.target.checked ? "visible" : "none");
        });
    });
}

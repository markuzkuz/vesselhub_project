import { openCruiseDataPanel } from "./cruiseCharts.js";

const VESSEL_PREFIX = {
    sdg: "29SG",
    odb: "29OD",
    hes: "29HE",
    gdc: "29GD"
};

const VESSEL_LAYER = {
    sdg: "sdgcruises",
    odb: "odbcruises",
    hes: "hescruises",
    gdc: "gdccruises"
};

const CRUISE_SOURCE_URLS = {
    sdgcruises: "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27SARMIENTO%20DE%20GAMBOA%27",
    odbcruises: "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27OD%C3%93N%20DE%20BUEN%27",
    hescruises: "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27HESP%C3%89RIDES%27",
    gdccruises: "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27GARCIA%20DEL%20CID%27"
};

const LINE_LAYERS = [
    "gdccruises", "hescruises", "sdgcruises", "odbcruises",
    "gdctracks", "hestracks", "sdgtracks", "odbtracks", 
    "SEI"
];

const POINT_LAYERS = ["WCP", "DRE", "CTD", "COR","MOC", "NET", "ROV", "OBS", "OBS", "MOC", "NET", "ROV"];

let activeDeepLinkPopup = null;

function getFeatureCruiseId(props = {}) {
    return props.cruiseid || props.cuiseid || props.cruise_id || null;
}

function sameCruise(feature, cruiseId) {
    return String(getFeatureCruiseId(feature?.properties || {}) || "").toUpperCase() === String(cruiseId || "").toUpperCase();
}

function getDeepLinkPath() {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("deepLink") || params.get("route") || window.location.hash.slice(1) || window.location.pathname;
    return decodeURIComponent(candidate || "");
}

function buildDeepLink(vessel, date, datatype) {
    const normalizedVessel = String(vessel || "").toLowerCase();
    const normalizedDatatype = String(datatype || "").toLowerCase();
    const prefix = VESSEL_PREFIX[normalizedVessel];

    if (!prefix || !/^\d{8}$/.test(date || "") || !["met", "tss"].includes(normalizedDatatype)) {
        return null;
    }

    return {
        vessel: normalizedVessel,
        date,
        datatype: normalizedDatatype,
        cruiseId: `${prefix}${date}`,
        layerId: VESSEL_LAYER[normalizedVessel],
        displayName: `${prefix}${date}`
    };
}

function parseCampaignDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const queryLink = buildDeepLink(params.get("vessel"), params.get("cruise"), params.get("dataset"));
    if (queryLink) return queryLink;

    const match = getDeepLinkPath().match(/\/set\/([^/]+)\/(\d{8})\/open\/(met|tss)\/view\/?$/i);
    return match ? buildDeepLink(match[1], match[2], match[3]) : null;
}

function cleanDeepLinkUrl() {
    if (!window.history?.replaceState) return;
    window.history.replaceState({}, document.title, `${window.location.origin}/vesselhub/`);
}

function collectCoordinates(geometry, out = []) {
    if (!geometry) return out;

    if (geometry.type === "Point") out.push(geometry.coordinates);
    if (geometry.type === "LineString" || geometry.type === "MultiPoint") out.push(...geometry.coordinates);
    if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
        geometry.coordinates.forEach((part) => out.push(...part));
    }
    if (geometry.type === "MultiPolygon") {
        geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => out.push(...ring)));
    }
    if (geometry.type === "GeometryCollection") {
        geometry.geometries.forEach((item) => collectCoordinates(item, out));
    }

    return out.filter((coord) => Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
}

function boundsFromFeature(feature) {
    const coords = collectCoordinates(feature?.geometry);
    if (!coords.length) return null;

    const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
    coords.slice(1).forEach((coord) => bounds.extend(coord));
    return bounds;
}

function centerFromBounds(bounds) {
    const center = bounds.getCenter();
    return { lng: center.lng, lat: center.lat };
}

function focusPadding(MAPA) {
    const container = MAPA.getContainer?.();
    const width = container?.clientWidth || window.innerWidth || 800;
    const height = container?.clientHeight || window.innerHeight || 600;

    return {
        top: Math.min(90, Math.max(35, height * 0.12)),
        right: Math.min(90, Math.max(35, width * 0.08)),
        bottom: Math.min(110, Math.max(45, height * 0.16)),
        left: Math.min(90, Math.max(35, width * 0.08))
    };
}

async function findCruiseFeature(MAPA, cruiseId, layerId) {
    const sourceFeatures = MAPA.querySourceFeatures?.(layerId) || [];
    const sourceMatch = sourceFeatures.find((feature) => sameCruise(feature, cruiseId));
    if (sourceMatch) return sourceMatch;

    const url = CRUISE_SOURCE_URLS[layerId];
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load cruise layer (${response.status})`);

    const data = await response.json();
    return (data.features || []).find((feature) => sameCruise(feature, cruiseId)) || null;
}

function cruiseFilter(cruiseId) {
    return [
        "any",
        ["==", ["get", "cruiseid"], cruiseId],
        ["==", ["get", "cuiseid"], cruiseId],
        ["==", ["get", "cruise_id"], cruiseId]
    ];
}

function applyDeepLinkHighlight(MAPA, cruiseId) {
    const targetId = cruiseId || "__NONE__";
    const filterExpression = cruiseFilter(targetId);

    LINE_LAYERS.forEach((layerId) => {
        if (!MAPA.getLayer(layerId)) return;

        const isCruise = layerId.includes("cruises");
        MAPA.setPaintProperty(layerId, "line-width", ["case", filterExpression, isCruise ? 4 : 2, isCruise ? 2 : 1.5]);
        MAPA.setPaintProperty(layerId, "line-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
    });

    POINT_LAYERS.forEach((layerId) => {
        if (!MAPA.getLayer(layerId)) return;

        MAPA.setPaintProperty(layerId, "circle-radius", ["case", filterExpression, 7, 5]);
        MAPA.setPaintProperty(layerId, "circle-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
        MAPA.setPaintProperty(layerId, "circle-stroke-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
    });
}

function popupHtml(props, cruiseId) {
    const title = props.cruise || cruiseId;
    const rows = [
        ["Vessel", props.vessel],
        ["Year", props.year],
        ["Distance (nm)", Number.isFinite(Number(props.distance_nm)) ? Number(props.distance_nm).toFixed(2) : props.distance_nm],
        ["Metadata", props.met_cat]
    ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");

    const tableRows = rows.map(([label, value]) => `
        <tr>
            <td><strong>${label}</strong></td>
            <td>${value}</td>
        </tr>
    `).join("");

    return `
        <div class="popup-drag-handle" title="Drag to move"><strong>${title}</strong></div>
        <table class="popup-table" style="font-size:11px; margin-top:5px;">${tableRows}</table>
        <button type="button" class="cruise-data-btn">View data</button>
    `;
}

function showDeepLinkPopup(MAPA, deepLink, feature, bounds) {
    if (activeDeepLinkPopup) {
        activeDeepLinkPopup.remove();
        activeDeepLinkPopup = null;
    }

    const props = feature.properties || {};
    const cruiseId = getFeatureCruiseId(props) || deepLink.cruiseId;
    const displayName = props.cruise || deepLink.displayName;

    activeDeepLinkPopup = new maplibregl.Popup({ maxWidth: "350px", closeOnClick: false, className: "draggable-popup" })
        .setLngLat(centerFromBounds(bounds))
        .setHTML(popupHtml(props, cruiseId))
        .addTo(MAPA);

    activeDeepLinkPopup.getElement()?.querySelector(".cruise-data-btn")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openCruiseDataPanel(cruiseId, deepLink.layerId, deepLink.datatype, displayName);
    });

    activeDeepLinkPopup.on("close", () => {
        activeDeepLinkPopup = null;
        applyDeepLinkHighlight(MAPA, null);
    });
}

async function focusCruiseOnMap(MAPA, deepLink) {
    const feature = await findCruiseFeature(MAPA, deepLink.cruiseId, deepLink.layerId);
    if (!feature) return false;

    const bounds = boundsFromFeature(feature);
    if (!bounds) return false;

    applyDeepLinkHighlight(MAPA, deepLink.cruiseId);
    MAPA.fitBounds(bounds, {
        padding: focusPadding(MAPA),
        maxZoom: 8,
        duration: 900
    });
    showDeepLinkPopup(MAPA, deepLink, feature, bounds);
    return true;
}

export function initCampaignDeepLinks(MAPA) {
    const deepLink = parseCampaignDeepLink();
    if (!deepLink) return;

    openCruiseDataPanel(deepLink.cruiseId, deepLink.layerId, deepLink.datatype, deepLink.displayName);
    focusCruiseOnMap(MAPA, deepLink).catch((error) => console.warn("Could not focus deep-linked cruise:", error));
    cleanDeepLinkUrl();
}

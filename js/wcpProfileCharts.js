import { closeCruiseDataPanel } from "./cruiseCharts.js";

const LOG_PREFIX = "[wcpProfileCharts]";

const VESSEL_PREFIX_TO_FOLDER = {
    "29SG": "sdg",
    "29OD": "odb",
    "29HE": "hes",
    "29GD": "gdc",
    "29GC": "gdc"
};

const DATA_BASE = "https://data.utm.csic.es/set";

let mapInstance = null;
let activeChart = null;
let currentProfile = null;

function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

function getRealMap() {
    if (typeof window !== "undefined" && window.MAPA) return window.MAPA;
    if (typeof MAPA !== "undefined") return MAPA;
    if (!mapInstance) return null;
    if (mapInstance.map) return mapInstance.map;
    if (mapInstance._map) return mapInstance._map;
    if (typeof mapInstance.getMap === "function") return mapInstance.getMap();
    return mapInstance;
}

function parseProfileId(profileId) {
    if (!profileId || profileId.length < 12) return null;

    const prefix = profileId.substring(0, 4);
    const date = profileId.substring(4, 12);
    const vessel = VESSEL_PREFIX_TO_FOLDER[prefix];

    if (!vessel || !/^\d{8}$/.test(date)) return null;

    return { profileId, prefix, date, vessel };
}

function extractHrefFromHtml(html) {
    if (!html || typeof html !== "string") return "";
    const match = html.match(/href=["']?([^"'\s>]+)/i);
    return match ? match[1] : "";
}

function extractProfileIdFromViewHtml(html) {
    const href = extractHrefFromHtml(html);
    if (!href) return null;

    try {
        const url = new URL(href, window.location.origin);
        return url.searchParams.get("svpid");
    } catch {
        const match = href.match(/svpid=([^&"'>\s]+)/i);
        return match ? decodeURIComponent(match[1]) : null;
    }
}

function buildProfileDataUrl({ vessel, date, profileId }) {
    return `${DATA_BASE}/${vessel}/${date}/open/svp/odv/${profileId}.txt`;
}

function buildOpenDirUrl({ vessel, date }) {
    return `${DATA_BASE}/${vessel}/${date}/open/`;
}

function parseOdvProfile(text) {
    const cruiseIndex = text.indexOf("Cruise");
    if (cruiseIndex === -1) throw new Error("Invalid profile file");

    const headerPart = text.substring(0, cruiseIndex);
    const lineNumber = headerPart.split("\n").length;
    const dataLines = text.split("\n").slice(lineNumber - 1).filter((line) => line.trim());

    if (dataLines.length < 2) throw new Error("The file contains no data");

    const headers = dataLines[0].split("\t").map((h) => h.trim());
    const rows = dataLines.slice(1).map((line) => {
        const cols = line.split("\t");
        const row = {};
        headers.forEach((header, index) => {
            row[header] = cols[index]?.trim() ?? "";
        });
        return row;
    });

    return { headers, rows };
}

function buildProfileSeries(rows, headers) {
    const depthKey = "Depth [Metres]";
    const svpKey = "Sound Velocity [Metres per second]";
    const svpIndex = headers.indexOf(svpKey);
    const qvKey = svpIndex >= 0 ? headers[svpIndex + 1] : null;

    const raw = [];
    const processed = [];

    rows.forEach((row) => {
        const depth = Number(row[depthKey]);
        const svp = Number(row[svpKey]);
        if (!Number.isFinite(depth) || !Number.isFinite(svp)) return;

        raw.push({ x: svp, y: depth });

        if (qvKey && row[qvKey] === "1") {
            processed.push({ x: svp, y: depth });
        }
    });

    if (!raw.length) throw new Error("No valid data to display");

    return { raw, processed };
}

function destroyChart() {
    if (activeChart) {
        try {
            activeChart.destroy();
        } catch (error) {
            logError("Error destroying chart:", error);
        }
        activeChart = null;
    }
}

function setPanelState({ loading = false, error = "" } = {}) {
    const loadingEl = document.getElementById("wcp-profile-loading");
    const errorEl = document.getElementById("wcp-profile-error");
    const canvas = document.getElementById("wcp-profile-chart");

    if (loadingEl) loadingEl.classList.toggle("hidden", !loading);
    if (errorEl) {
        errorEl.classList.toggle("hidden", !error);
        errorEl.textContent = error;
    }
    if (canvas) canvas.style.display = error ? "none" : "block";
}

function waitForPanelLayout() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setTimeout(resolve, 80));
        });
    });
}

function resizeMap() {
    setTimeout(() => {
        const map = getRealMap();
        map?.resize?.();
        activeChart?.resize();
    }, 320);
}

async function loadAndRenderProfile() {
    if (!currentProfile) return;

    const { profileId, displayName, vessel, date } = currentProfile;
    const titleEl = document.getElementById("wcp-profile-title");
    const urlEl = document.getElementById("wcp-profile-url");
    const canvas = document.getElementById("wcp-profile-chart");

    if (!canvas) {
        logError("Canvas #wcp-profile-chart not found");
        return;
    }

    destroyChart();
    setPanelState({ loading: true, error: "" });

    if (titleEl) {
        titleEl.textContent = displayName || profileId;
    }

    const openDirUrl = buildOpenDirUrl({ vessel, date });
    if (urlEl) {
        urlEl.innerHTML = `<a href="${openDirUrl}" target="_blank" rel="noopener noreferrer">Download data</a>`;
    }

    try {
        const dataUrl = buildProfileDataUrl({ vessel, date, profileId });
        const response = await fetch(dataUrl);
        if (!response.ok) throw new Error(`Profile not found (${response.status})`);

        const text = await response.text();
        const { headers, rows } = parseOdvProfile(text);
        const { raw, processed } = buildProfileSeries(rows, headers);

        const ChartClass = window.Chart || Chart;
        if (!ChartClass) throw new Error("Chart.js is not loaded");

        await waitForPanelLayout();
        canvas.style.display = "block";

        const scaleOpts = {
            ticks: {
                callback: (val, index, ticks) =>
                    index === 0 || index === ticks.length - 1 ? null : val
            },
            grid: {
                borderColor: "rgba(0,0,0,0.1)",
                color: "rgba(0,0,0,0.1)"
            }
        };

        const profileDataset = {
            borderWidth: 2,
            pointRadius: 1.5,
            parsing: false
        };

        activeChart = new ChartClass(canvas.getContext("2d"), {
            type: "scatter",
            data: {
                datasets: [
                    {
                        ...profileDataset,
                        label: "Non-processed",
                        data: raw,
                        borderColor: "rgba(30,155,239,1)",
                        backgroundColor: "rgba(30,155,239,0.3)",
                        showLine: false,
                        hidden: true
                    },
                    {
                        ...profileDataset,
                        label: "Pre-processed",
                        data: processed,
                        borderColor: "rgba(0,200,0,1)",
                        backgroundColor: "rgba(0,200,0,0.3)",
                        showLine: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { position: "top" },
                    tooltip: { enabled: true }
                },
                scales: {
                    x: {
                        type: "linear",
                        position: "top",
                        title: { display: true, text: "Sound Velocity m/s" },
                        ...scaleOpts
                    },
                    y: {
                        type: "linear",
                        reverse: true,
                        position: "right",
                        title: { display: true, text: "Depth m" },
                        ...scaleOpts
                    }
                }
            }
        });

        log("Profile chart rendered", { profileId, points: raw.length });

        activeChart.resize();
        setPanelState({ loading: false });
    } catch (error) {
        logError("Error loading profile:", error);
        setPanelState({ loading: false, error: error.message || "Error loading profile" });
    }
}

export function closeWcpProfilePanel() {
    const panel = document.getElementById("wcp-profile-panel");
    if (!panel) return;

    panel.classList.remove("open");
    document.body.classList.remove("wcp-panel-open");
    destroyChart();
    currentProfile = null;
    resizeMap();
}

export function openWcpProfilePanel(profileId, displayName = "", downloadHtml = "") {
    const parsed = parseProfileId(profileId);
    if (!parsed) {
        logError("Invalid profile id:", profileId);
        return;
    }

    const panel = document.getElementById("wcp-profile-panel");
    if (!panel) return;

    closeCruiseDataPanel();

    const downloadUrl = extractHrefFromHtml(downloadHtml);
    currentProfile = {
        ...parsed,
        displayName: String(displayName || "").trim() || parsed.profileId,
        downloadUrl
    };

    panel.classList.add("open");
    document.body.classList.add("wcp-panel-open");
    log("Opening profile panel", currentProfile);
    resizeMap();
    loadAndRenderProfile();
}

export function openWcpProfileFromFeature(props = {}) {
    const profileId = props.cdiid || extractProfileIdFromViewHtml(props.data_view);
    if (!profileId) {
        logError("No profile id found in feature properties");
        return;
    }

    const label = props.parameter_ || props.parameter || "Water column profile";
    const title = props.cdiid ? `${label} — ${props.cdiid}` : label;
    openWcpProfilePanel(profileId, title, props.data_download || "");
}

export function initWcpProfilePanel(map) {
    mapInstance = map;
    const closeBtn = document.getElementById("wcp-profile-close");
    closeBtn?.addEventListener("click", closeWcpProfilePanel);

    if (typeof window !== "undefined") {
        window.openWcpProfilePanel = openWcpProfilePanel;
        window.openWcpProfileFromFeature = openWcpProfileFromFeature;
        window.closeWcpProfilePanel = closeWcpProfilePanel;
    }
}

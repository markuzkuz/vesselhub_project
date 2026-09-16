const LOG_PREFIX = "[cruiseCharts]";

function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

function logWarn(...args) {
    console.warn(LOG_PREFIX, ...args);
}

function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

const VESSEL_PREFIX_TO_FOLDER = {
    "29SG": "sdg",
    "29OD": "odb",
    "29HE": "hes",
    "29GD": "gdc"
};

const FOLDER_TO_PREFIX = {
    sdg: "29SG",
    odb: "29OD",
    hes: "29HE",
    gdc: "29GD"
};

const LAYER_TO_VESSEL = {
    sdgcruises: "sdg",
    odbcruises: "odb",
    hescruises: "hes",
    gdccruises: "gdc"
};

const DATA_TYPES = {
    ts: {
        label: "Thermosalinity (TS)",
        chartTitle: "Temperature & Salinity"
    },
    met: {
        label: "Meteorology (MET)",
        chartTitle: "Meteorological variables"
    }
};

const MAX_POINTS_PER_DATASET = 5000;

let mapInstance = null;
let activeChart = null;
let currentCruise = null;
let chartMapMarkerEl = null; // Element HTML del marcador en el mapa
let syncWithMap = true;      // Activat per defecte perquè el vegis funcionar immediatament

// Es connecta directament a la teva instància global de Maplibre anomenada MAPA
function getRealMap() {
    if (typeof window !== "undefined" && window.MAPA) return window.MAPA;
    if (typeof MAPA !== "undefined") return MAPA;
    if (!mapInstance) return null;
    if (mapInstance.map) return mapInstance.map;
    if (mapInstance._map) return mapInstance._map;
    if (typeof mapInstance.getMap === 'function') return mapInstance.getMap();
    return mapInstance;
}

function parseCruiseCode(cruiseId) {
    log("parseCruiseCode input:", cruiseId, "length:", cruiseId?.length);
    if (!cruiseId || cruiseId.length < 12) {
        logWarn("parseCruiseCode: cruiseId invàlid o massa curt");
        return null;
    }
    const prefix = cruiseId.substring(0, 4);
    const date = cruiseId.substring(4, 12);
    const vessel = VESSEL_PREFIX_TO_FOLDER[prefix];
    log("parseCruiseCode parsed:", { prefix, date, vessel });
    if (!vessel || !/^\d{8}$/.test(date)) {
        logWarn("parseCruiseCode: prefix o data no reconeguts", { prefix, date, vessel });
        return null;
    }
    return { vessel, date, prefix, cruiseId };
}

function resolveVessel(cruiseId, layerId) {
    log("resolveVessel:", { cruiseId, layerId });
    const parsed = parseCruiseCode(cruiseId);
    if (parsed) {
        log("resolveVessel: resolt per codi de campanya", parsed);
        return parsed;
    }
    if (layerId && LAYER_TO_VESSEL[layerId]) {
        const date = cruiseId?.substring(4, 12);
        log("resolveVessel: intent fallback per capa", { layerId, vessel: LAYER_TO_VESSEL[layerId], date });
        if (date && /^\d{8}$/.test(date)) {
            const vessel = LAYER_TO_VESSEL[layerId];
            const prefix = FOLDER_TO_PREFIX[vessel];
            const result = { vessel, date, prefix, cruiseId: `${prefix}${date}` };
            log("resolveVessel: resolt per capa", result);
            return result;
        }
    }
    logWarn("resolveVessel: no s'ha pogut resoldre", { cruiseId, layerId });
    return null;
}

const DATA_BASE = "https://data.utm.csic.es/set";

function buildDataDirUrl({ vessel, date, datatype }) {
    return `${DATA_BASE}/${vessel}/${date}/open/${datatype}/csv/`;
}

function parseCsvLinksFromListing(html) {
    const files = [];
    const re = /href="([^"?]+\.csv)"/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
        const name = match[1].split("/").pop();
        if (name && !files.includes(name)) files.push(name);
    }
    return files;
}

function pickCsvFile(files, datatype) {
    if (!files.length) return null;
    const suffix = `_${datatype}.csv`;
    const exact = files.find((f) => f.endsWith(suffix));
    if (exact) return exact;
    if (files.length === 1) return files[0];
    return files.find((f) => f.toLowerCase().includes(`_${datatype}`)) || files[0];
}

async function discoverCsvUrl({ vessel, date, datatype }) {
    const dirUrl = buildDataDirUrl({ vessel, date, datatype });
    log("discoverCsvUrl: llistant directori", dirUrl);

    const response = await fetch(dirUrl);
    log("discoverCsvUrl: resposta directori", { ok: response.ok, status: response.status });

    if (!response.ok) throw new Error(`No ${datatype} data available for this cruise (${response.status})`);

    const html = await response.text();
    const files = parseCsvLinksFromListing(html);
    log("discoverCsvUrl: fitxers CSV trobats", files);

    const fileName = pickCsvFile(files, datatype);
    if (!fileName) throw new Error(`No ${datatype} data available for this cruise`);

    const url = `${dirUrl}${fileName}`;
    log("discoverCsvUrl: fitxer seleccionat", { fileName, url });
    return { url, fileName, dirUrl };
}

function parseCSV(text) {
    const lines = text.trim().split("\n");
    log("parseCSV: línies totals", lines.length);
    if (lines.length < 2) {
        logWarn("parseCSV: fitxer buit o sense dades");
        return [];
    }
    const headers = lines[0].split(",").map((h) => h.trim());
    log("parseCSV: capçaleres", headers);

    return lines.slice(1)
        .filter((line) => line.trim())
        .map((line) => {
            const cols = line.split(",");
            const row = {};
            headers.forEach((header, i) => {
                const value = cols[i]?.trim();
                if (value === "" || value === undefined) row[header] = null;
                else if (!isNaN(value)) row[header] = +value;
                else row[header] = value;
            });
            return row;
        });
}

function timeColumn(row) {
    return row["YYYY-MM-DDThh:mm:ss.sss"];
}

function parseChartTime(value) {
    if (value == null || value === "") return null;
    const normalized = String(value).replace(/\//g, "-").replace(" ", "T");
    const ts = Date.parse(normalized);
    return Number.isFinite(ts) ? ts : null;
}

function minMaxFinite(values) {
    let min = Infinity;
    let max = -Infinity;
    let count = 0;

    values.forEach((value) => {
        if (!Number.isFinite(value)) return;
        if (value < min) min = value;
        if (value > max) max = value;
        count += 1;
    });

    return count ? { min, max } : null;
}

function validLatitude(value) {
    return Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value) {
    return Number.isFinite(value) && value >= -180 && value <= 180;
}

function thinSeries(series, maxPoints = MAX_POINTS_PER_DATASET) {
    if (!series || series.length <= maxPoints) return series;

    const step = Math.ceil(series.length / maxPoints);
    const thinned = [];

    for (let i = 0; i < series.length; i += step) {
        thinned.push(series[i]);
    }

    const last = series[series.length - 1];
    if (thinned[thinned.length - 1] !== last) {
        thinned.push(last);
    }

    logWarn("Sèrie reduïda per evitar saturar el gràfic", {
        original: series.length,
        visible: thinned.length
    });

    return thinned;
}

function buildXYSeries(records, yKey) {
    if (!records || !records.length) return [];

    const headers = Object.keys(records[0] || {});
    const latKey = headers.find(h => h.toLowerCase().includes("lat"));
    const lonKey = headers.find(h => h.toLowerCase().includes("lon") || h.toLowerCase().includes("lng"));

    const series = records
        .map((row) => {
            const x = parseChartTime(timeColumn(row));
            const y = Number(row[yKey]);

            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return null;
            }

            const lat = latKey ? Number(row[latKey]) : null;
            const lon = lonKey ? Number(row[lonKey]) : null;

            return {
                x,
                y,
                lat: validLatitude(lat) ? lat : null,
                lon: validLongitude(lon) ? lon : null
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.x - b.x);

    return thinSeries(series);
}

function axisLimits(series, padding = 0.08) {
    const limits = minMaxFinite(series.map((p) => p.y));
    if (!limits) return {};

    const { min, max } = limits;
    const range = max - min || Math.abs(max) * 0.05 || 1;

    return {
        min: min - range * padding,
        max: max + range * padding
    };
}

function timeLimits(...seriesList) {
    let min = Infinity;
    let max = -Infinity;
    let count = 0;

    seriesList.forEach((series) => {
        series.forEach((point) => {
            const value = point.x;
            if (!Number.isFinite(value)) return;
            if (value < min) min = value;
            if (value > max) max = value;
            count += 1;
        });
    });

    if (!count) return {};

    // Igual que els eixos Y, deixem un petit marge perquè el primer i l'últim
    // punt no quedin enganxats als límits del gràfic. Per a una sola mostra,
    // usem una hora com a rang base en lloc d'un percentatge del timestamp.
    const range = max - min || 60 * 60 * 1000;
    const padding = range * 0.08;

    return {
        min: min - padding,
        max: max + padding
    };
}

const LINE_DATASET = {
    tension: 0.15,
    pointRadius: 0,
    pointHoverRadius: 4,
    borderWidth: 0.5,
    fill: false,
    spanGaps: true,
    parsing: false
};

function waitForPanelLayout() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setTimeout(resolve, 80));
        });
    });
}

// Projecta i dibuixa el punter a la capa de continguts del teu objecte MAPA de Maplibre
function updateMapMarker(lat, lon) {
    if (!syncWithMap) {
        hideMapMarker();
        return;
    }

    const map = getRealMap();
    if (!map || lat == null || lon == null) {
        hideMapMarker();
        return;
    }

    try {
        const container = typeof map.getContainer === "function" ? map.getContainer() : null;
        if (!container) return;

        if (!chartMapMarkerEl) {
            chartMapMarkerEl = document.createElement("div");
            chartMapMarkerEl.className = "cruise-chart-map-marker";
            chartMapMarkerEl.innerHTML = '<div class="cruise-chart-map-marker-pin"></div>';
            chartMapMarkerEl.style.position = "absolute";
            chartMapMarkerEl.style.width = "28px";
            chartMapMarkerEl.style.height = "40px";
            chartMapMarkerEl.style.pointerEvents = "none";
            chartMapMarkerEl.style.zIndex = "99999";
            chartMapMarkerEl.style.filter = "drop-shadow(0 3px 4px rgba(0,0,0,0.35))";
            container.appendChild(chartMapMarkerEl);
        }

        const pixel = map.project([lon, lat]); // Format Maplibre: [lng, lat]
        if (pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y)) {
            chartMapMarkerEl.style.display = "block";
            chartMapMarkerEl.style.left = `${pixel.x - 14}px`;
            chartMapMarkerEl.style.top = `${pixel.y - 40}px`;
        } else {
            hideMapMarker();
        }
    } catch (error) {
        logError("Error posicionant el marcador a MAPA:", error);
    }
}

function hideMapMarker() {
    if (chartMapMarkerEl) {
        chartMapMarkerEl.style.display = "none";
    }
}

function destroyChart() {
    if (activeChart) {
        try {
            activeChart.destroy();
        } catch (e) {
            logError("Error destruint la instància de Chart:", e);
        }
        activeChart = null;
    }
    hideMapMarker();
}

function setPanelState({ loading = false, error = "" } = {}) {
    const loadingEl = document.getElementById("cruise-data-loading");
    const errorEl = document.getElementById("cruise-data-error");
    const canvas = document.getElementById("cruise-data-chart");
    if (loadingEl) loadingEl.classList.toggle("hidden", !loading);
    if (errorEl) {
        errorEl.classList.toggle("hidden", !error);
        errorEl.textContent = error;
    }
    if (canvas) canvas.style.display = error ? "none" : "block";
}

function buildTsChart(records) {
    const tempSeries = buildXYSeries(records, "Temperature [Degrees Celsius]");
    const salSeries = buildXYSeries(records, "Salinity [Dimensionless]");
    return {
        data: {
            datasets: [
                {
                    ...LINE_DATASET,
                    label: "Temperature (°C)",
                    data: tempSeries,
                    borderColor: "#e53e3e",
                    backgroundColor: "rgba(229,62,62,0.15)",
                    yAxisID: "y"
                },
                {
                    ...LINE_DATASET,
                    label: "Salinity (psu)",
                    data: salSeries,
                    borderColor: "#3182ce",
                    backgroundColor: "rgba(49,130,206,0.15)",
                    yAxisID: "y2"
                }
            ]
        },
        options: {
            scales: {
                x: {
                    type: "time",
                    ...timeLimits(tempSeries, salSeries),
                    time: { tooltipFormat: "yyyy-MM-dd HH:mm" },
                    title: { display: true, text: "Time" }
                },
                y: {
                    position: "left",
                    title: { display: true, text: "Temperature (°C)" },
                    ...axisLimits(tempSeries)
                },
                y2: {
                    position: "right",
                    title: { display: true, text: "Salinity (psu)" },
                    grid: { drawOnChartArea: false },
                    ...axisLimits(salSeries)
                }
            }
        }
    };
}

function buildMetChart(records) {
    const tempSeries = buildXYSeries(records, "Air temperature [Degrees Celsius]");
    const windSeries = buildXYSeries(records, "Wind speed [Metres per second]");
    const pressSeries = buildXYSeries(records, "Air pressure [Hectopascals]");
    return {
        data: {
            datasets: [
                {
                    ...LINE_DATASET,
                    label: "Air temperature (°C)",
                    data: tempSeries,
                    borderColor: "#e53e3e",
                    backgroundColor: "rgba(229,62,62,0.15)",
                    yAxisID: "y"
                },
                {
                    ...LINE_DATASET,
                    label: "Wind speed (m/s)",
                    data: windSeries,
                    borderColor: "#ef990e",
                    backgroundColor: "rgba(206, 177, 49, 0.15)",
                    yAxisID: "yWind"
                },
                {
                    ...LINE_DATASET,
                    label: "Air pressure (hPa)",
                    data: pressSeries,
                    borderColor: "#38a169",
                    backgroundColor: "rgba(56,161,105,0.15)",
                    yAxisID: "y2"
                }
            ]
        },
        options: {
            scales: {
                x: {
                    type: "time",
                    ...timeLimits(tempSeries, windSeries, pressSeries),
                    time: { tooltipFormat: "yyyy-MM-dd HH:mm" },
                    title: { display: true, text: "Time" }
                },
                y: {
                    position: "left",
                    title: { display: true, text: "Temperature (°C)" },
                    ...axisLimits(tempSeries)
                },
                yWind: {
                    position: "right",
                    title: { display: true, text: "Wind speed (m/s)" },
                    grid: { drawOnChartArea: false },
                    ...axisLimits(windSeries)
                },
                y2: {
                    position: "right",
                    offset: true,
                    title: { display: true, text: "Pressure (hPa)" },
                    grid: { drawOnChartArea: false },
                    ...axisLimits(pressSeries)
                }
            }
        }
    };
}

function handleChartHover(event, activeElements, chartInstance) {
    if (!syncWithMap) {
        hideMapMarker();
        return;
    }

    const chart = chartInstance || this || activeChart;
    if (!chart || !chart.data) return;

    if (activeElements && activeElements.length > 0) {
        const element = activeElements[0];
        const datasetIndex = element.datasetIndex !== undefined ? element.datasetIndex : element._datasetIndex;
        const index = element.index !== undefined ? element.index : element._index;

        if (datasetIndex !== undefined && index !== undefined) {
            const dataset = chart.data.datasets[datasetIndex];
            const dataPoint = dataset ? dataset.data[index] : null;

            if (dataPoint && dataPoint.lat != null && dataPoint.lon != null) {
                updateMapMarker(dataPoint.lat, dataPoint.lon);
                return;
            }
        }
    }
    hideMapMarker();
}

const CRUISE_VESSEL_NAMES = {
    "SDG": "Sarmiento de Gamboa",
    "ODB": "Odón de Buen",
    "HES": "Hespérides",
    "GDC": "García del Cid"
};

function safeFloat(val) {
    if (val === "" || val === undefined || val === null) return null;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
}

function parseSearchCSV(text, datatype) {
    const lines = text.trim().split("\n");
    log("parseSearchCSV: total lines:", lines.length);
    const records = [];
    
    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(",");
        if (parts.length < 5) continue;
        
        const dateStr = parts[1];
        const timeStr = parts[2];
        if (dateStr.length !== 8 || timeStr.length !== 6) continue;
        
        const year = dateStr.slice(0, 4);
        const month = dateStr.slice(4, 6);
        const day = dateStr.slice(6, 8);
        const hours = timeStr.slice(0, 2);
        const minutes = timeStr.slice(2, 4);
        const seconds = timeStr.slice(4, 6);
        const timeVal = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
        
        const lon = parseFloat(parts[3]);
        const lat = parseFloat(parts[4]);
        
        if (isNaN(lon) || isNaN(lat)) continue;

        const row = {
            "YYYY-MM-DDThh:mm:ss.sss": timeVal,
            "lat": lat,
            "lon": lon
        };
        
        if (datatype === "met") {
            row["Air temperature [Degrees Celsius]"] = safeFloat(parts[7]);
            row["Wind speed [Metres per second]"] = safeFloat(parts[5]);
            row["Air pressure [Hectopascals]"] = safeFloat(parts[10]);
        } else {
            row["Temperature [Degrees Celsius]"] = safeFloat(parts[6]);
            row["Salinity [Dimensionless]"] = safeFloat(parts[5]);
        }
        records.push(row);
    }
    log("parseSearchCSV parsed records:", records.length);
    return records;
}

async function loadAndRenderChart(datatypeInput) {
    let datatype = String(datatypeInput).toLowerCase().trim();
    if (datatype.includes("met")) {
        datatype = "met";
    } else {
        datatype = "ts";
    }

    log("loadAndRenderChart procedint amb el datatype netejat:", datatype);
    if (!currentCruise) return;

    const titleEl = document.getElementById("cruise-data-title");
    const urlEl = document.getElementById("cruise-data-url");
    const canvas = document.getElementById("cruise-data-chart");

    if (!canvas) {
        logError("Canvas #cruise-data-chart no trobat al DOM");
        return;
    }

    destroyChart();
    setPanelState({ loading: true, error: "" });

    try {
        let records = [];
        if (currentCruise.isSearch) {
            const { vessel, startDate, endDate, displayName } = currentCruise;
            if (titleEl) {
                titleEl.textContent = `${displayName} — ${DATA_TYPES[datatype]?.chartTitle || datatype}`;
            }

            let apiType = datatype === "met" ? "MET" : "TSS";
            const searchDownloadUrl = `https://datahub.utm.csic.es/ws/getSerie/${vessel}/${apiType}/?start=${startDate}&end=${endDate}&download`;
            if (urlEl) {
                urlEl.innerHTML = `<a href="${searchDownloadUrl}" target="_blank" rel="noopener noreferrer" style="color: #3182ce; text-decoration: underline; font-weight: 500;">Download data</a>`;
            }

            const apiUrl = `https://datahub.utm.csic.es/ws/getSerie/${vessel}/${apiType}/?start=${startDate}&end=${endDate}`;
            log("loadAndRenderChart search Fetch URL:", apiUrl);
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`Data not found (${response.status})`);
            const text = await response.text();
            
            records = parseSearchCSV(text, datatype);
            if (!records.length) throw new Error("The search contains no data");
        } else {
            const { cruiseId, displayName, vessel, date } = currentCruise;
            if (titleEl) {
                titleEl.textContent = `${displayName || cruiseId} — ${DATA_TYPES[datatype]?.chartTitle || datatype}`;
            }

            const openDirUrl = `${DATA_BASE}/${vessel}/${date}/open/`;
            if (urlEl) {
                urlEl.innerHTML = `<a href="${openDirUrl}" target="_blank" rel="noopener noreferrer" style="color: #3182ce; text-decoration: underline; font-weight: 500;">Download data</a>`;
            }

            const { url } = await discoverCsvUrl({ ...currentCruise, datatype });
            const response = await fetch(url);
            if (!response.ok) throw new Error(`File not found (${response.status})`);
            const text = await response.text();

            records = parseCSV(text);
            if (!records.length) throw new Error("The file contains no data");
        }

        const ChartClass = window.Chart || Chart;
        if (!ChartClass) throw new Error("Chart.js is not loaded (Chart is undefined)");
        const chartConfig = datatype === "met" ? buildMetChart(records) : buildTsChart(records);

        await waitForPanelLayout();
        canvas.style.display = "block";

        const totalPoints = chartConfig.data.datasets.reduce((sum, ds) => sum + ds.data.length, 0);
        if (totalPoints === 0) throw new Error("No valid data to display.");

        canvas.style.height = `${Math.max(350, Math.min(700, totalPoints * 0.8))}px`;

        activeChart = new ChartClass(canvas.getContext("2d"), {
            type: "line",
            data: chartConfig.data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: "nearest", axis: "x", intersect: false },
                onHover: handleChartHover,
                hover: {
                    onHover: handleChartHover
                },
                plugins: {
                    legend: { position: "top" },
                    decimation: { enabled: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) label += context.parsed.y;

                                const dataPoint = context.raw;
                                if (dataPoint && dataPoint.lat != null && dataPoint.lon != null) {
                                    label += ` [Lat: ${dataPoint.lat.toFixed(4)}°, Lon: ${dataPoint.lon.toFixed(4)}°]`;
                                }
                                return label;
                            }
                        }
                    }
                },
                ...chartConfig.options
            }
        });

        canvas.removeEventListener("mouseleave", hideMapMarker);
        canvas.addEventListener("mouseleave", hideMapMarker);

        activeChart.resize();
        setPanelState({ loading: false });
    } catch (err) {
        logError("Error loading data:", err);
        setPanelState({ loading: false, error: err.message || "Error loading data" });
    }
}

function resizeMap() {
    setTimeout(() => {
        const map = getRealMap();
        map?.resize?.();
        activeChart?.resize();
    }, 320);
}

export function closeCruiseDataPanel() {
    const panel = document.getElementById("cruise-data-panel");
    if (!panel) return;
    panel.classList.remove("open");
    document.body.classList.remove("cruise-panel-open");
    destroyChart();
    currentCruise = null;
    resizeMap();
}

export function openSearchDataPanel(vessel, startDate, endDate, datatype = "met") {
    if (typeof window.closeWcpProfilePanel === "function") {
        window.closeWcpProfilePanel();
    }

    const panel = document.getElementById("cruise-data-panel");
    const typeSelect = document.getElementById("cruise-data-type");
    if (!panel) return;

    const vesselFullName = CRUISE_VESSEL_NAMES[vessel] || vessel;
    const formattedStart = `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}`;
    const formattedEnd = `${endDate.slice(0, 4)}-${endDate.slice(4, 6)}-${endDate.slice(6, 8)}`;

    currentCruise = {
        isSearch: true,
        vessel: vessel,
        startDate: startDate,
        endDate: endDate,
        displayName: `${vesselFullName} (${formattedStart} - ${formattedEnd})`
    };
    panel.classList.add("open");
    document.body.classList.add("cruise-panel-open");
    if (typeSelect && typeSelect.value !== datatype) {
        typeSelect.value = datatype;
    }
    resizeMap();
    loadAndRenderChart(datatype);
}

export function openCruiseDataPanel(cruiseId, layerId, datatype = "met", displayName = "") {
    const cruise = resolveVessel(cruiseId, layerId);
    if (!cruise) return;

    if (typeof window.closeWcpProfilePanel === "function") {
        window.closeWcpProfilePanel();
    }

    const panel = document.getElementById("cruise-data-panel");
    const typeSelect = document.getElementById("cruise-data-type");
    if (!panel) return;

    currentCruise = {
        ...cruise,
        displayName: String(displayName || "").trim() || cruise.cruiseId
    };
    panel.classList.add("open");
    document.body.classList.add("cruise-panel-open");
    if (typeSelect && typeSelect.value !== datatype) {
        typeSelect.value = datatype;
    }
    resizeMap();
    loadAndRenderChart(datatype);
}

export function initCruiseDataPanel(map) {
    mapInstance = map;
    const panel = document.getElementById("cruise-data-panel");
    const closeBtn = document.getElementById("cruise-data-close");
    const typeSelect = document.getElementById("cruise-data-type");
    const syncCheckbox = document.getElementById("cruise-data-sync");

    if (!panel) return;

    // El panell sincronitza amb el mapa per defecte; el checkbox només canvia l'estat després.
    if (syncCheckbox) {
        syncCheckbox.checked = true;
        syncWithMap = true;
        syncCheckbox.addEventListener("change", (e) => {
            syncWithMap = e.target.checked;
            if (!syncWithMap) hideMapMarker();
        });
    }

    closeBtn?.addEventListener("click", () => {
        closeCruiseDataPanel();
    });
    typeSelect?.addEventListener("change", (e) => {
        if (currentCruise) loadAndRenderChart(e.target.value);
    });
}

if (typeof window !== "undefined") {
    window.openSearchDataPanel = openSearchDataPanel;
    window.closeCruiseDataPanel = closeCruiseDataPanel;
}

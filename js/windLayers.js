const WIND_API_URL = "https://api.open-meteo.com/v1/forecast";
const WIND_MODEL = "ecmwf_ifs025";
const WIND_MODEL_LABEL = "ECMWF IFS 0.25°";
const DEFAULT_DENSITY = { cols: 12, rows: 8 };
const DENSITIES = {
    low: { cols: 8, rows: 6 },
    mid: DEFAULT_DENSITY,
    high: { cols: 16, rows: 11 }
};
const MAX_GRID_LATITUDE = 85;

const WIND_COLOR_STOPS = [
    { kt: 0, rgb: [20, 40, 70] },
    { kt: 5, rgb: [30, 90, 120] },
    { kt: 10, rgb: [40, 150, 130] },
    { kt: 17, rgb: [120, 190, 80] },
    { kt: 25, rgb: [230, 205, 60] },
    { kt: 33, rgb: [235, 130, 45] },
    { kt: 42, rgb: [220, 60, 60] },
    { kt: 55, rgb: [180, 60, 190] }
];

const PROJECTION_TOLERANCE_PX = 2;

const VESSEL_LAYERS = new Set(["ODB", "SDG", "HES"]);
const VESSEL_CLICK_RADIUS_PX = 15;

function toUV(speedKt, directionDegrees) {
    const radians = directionDegrees * Math.PI / 180;
    const speedMs = speedKt * 0.514444;
    return {
        u: -speedMs * Math.sin(radians),
        v: -speedMs * Math.cos(radians)
    };
}

function colorForWind(speedKt, alpha) {
    let lower = WIND_COLOR_STOPS[0];
    let upper = WIND_COLOR_STOPS[WIND_COLOR_STOPS.length - 1];

    for (let index = 0; index < WIND_COLOR_STOPS.length - 1; index += 1) {
        const candidate = WIND_COLOR_STOPS[index];
        const next = WIND_COLOR_STOPS[index + 1];
        if (speedKt >= candidate.kt && speedKt <= next.kt) {
            lower = candidate;
            upper = next;
            break;
        }
    }

    const ratio = Math.min(Math.max((speedKt - lower.kt) / Math.max(upper.kt - lower.kt, 1e-6), 0), 1);
    const channels = lower.rgb.map((channel, index) => Math.round(channel + (upper.rgb[index] - channel) * ratio));
    return `rgba(${channels[0]},${channels[1]},${channels[2]},${alpha})`;
}

function normalizeLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function unwrapLongitude(longitude, reference) {
    let value = normalizeLongitude(longitude);
    while (value - reference > 180) value -= 360;
    while (value - reference < -180) value += 360;
    return value;
}

class WindField {
    constructor() {
        this.ready = false;
    }

    async load(bounds, cols, rows, signal, globeCenter) {
        const southwest = bounds.getSouthWest();
        const northeast = bounds.getNorthEast();
        const isGlobe = Number.isFinite(globeCenter);
        const referenceLongitude = isGlobe ? globeCenter : southwest.lng;
        const rawLongitudeSpan = northeast.lng - southwest.lng;
        const longitudeSpan = isGlobe ? 180 : Math.min(Math.abs(rawLongitudeSpan), 360);
        const minLongitude = isGlobe ? referenceLongitude - 90 : southwest.lng - longitudeSpan * 0.2;
        const maxLongitude = isGlobe ? referenceLongitude + 90 : southwest.lng + longitudeSpan * 1.2;
        const padLatitude = (northeast.lat - southwest.lat) * 0.2;
        const minLatitude = Math.max(-MAX_GRID_LATITUDE, southwest.lat - padLatitude);
        const maxLatitude = Math.min(MAX_GRID_LATITUDE, northeast.lat + padLatitude);
        const latitudes = [];
        const longitudes = [];

        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < cols; column += 1) {
                const longitudeRatio = column / (cols - 1);
                const latitudeRatio = row / (rows - 1);
                longitudes.push(minLongitude + (maxLongitude - minLongitude) * longitudeRatio);
                latitudes.push(minLatitude + (maxLatitude - minLatitude) * latitudeRatio);
            }
        }

        const u = new Array(latitudes.length).fill(0);
        const v = new Array(latitudes.length).fill(0);
        const models = [];
        const dataTimes = [];
        const chunkSize = 100;

        for (let start = 0; start < latitudes.length; start += chunkSize) {
            const end = Math.min(start + chunkSize, latitudes.length);
            const latitudeQuery = latitudes.slice(start, end).map(value => value.toFixed(3)).join(",");
            const longitudeQuery = longitudes.slice(start, end).map(value => normalizeLongitude(value).toFixed(3)).join(",");
            const url = `${WIND_API_URL}?latitude=${latitudeQuery}&longitude=${longitudeQuery}` +
                `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=UTC&models=${WIND_MODEL}`;
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);

            const payload = await response.json();
            const locations = Array.isArray(payload) ? payload : [payload];
            locations.forEach((location, offset) => {
                if (location.model) models.push(location.model);
                const current = location.current;
                if (!current) return;
                if (current.time) dataTimes.push(current.time);
                const vector = toUV(current.wind_speed_10m, current.wind_direction_10m);
                u[start + offset] = vector.u;
                v[start + offset] = vector.v;
            });
        }

        Object.assign(this, {
            cols,
            rows,
            minLongitude,
            maxLongitude,
            minLatitude,
            maxLatitude,
            u,
            v,
            model: models[0] || WIND_MODEL,
            dataTime: dataTimes[0] || null,
            ready: true
        });
    }

    vectorAt(longitude, latitude) {
        if (!this.ready) return null;
        const adjustedLongitude = unwrapLongitude(longitude, this.minLongitude);
        const x = ((adjustedLongitude - this.minLongitude) / (this.maxLongitude - this.minLongitude)) * (this.cols - 1);
        const y = ((latitude - this.minLatitude) / (this.maxLatitude - this.minLatitude)) * (this.rows - 1);
        if (x < 0 || x > this.cols - 1 || y < 0 || y > this.rows - 1) return null;

        const x0 = Math.floor(x);
        const x1 = Math.min(x0 + 1, this.cols - 1);
        const y0 = Math.floor(y);
        const y1 = Math.min(y0 + 1, this.rows - 1);
        const xRatio = x - x0;
        const yRatio = y - y0;
        const index = (column, row) => row * this.cols + column;
        const interpolate = (values, column, row) => values[index(column, row)];
        const blend = (a, b, ratio) => a + (b - a) * ratio;
        const u = blend(
            blend(interpolate(this.u, x0, y0), interpolate(this.u, x1, y0), xRatio),
            blend(interpolate(this.u, x0, y1), interpolate(this.u, x1, y1), xRatio),
            yRatio
        );
        const v = blend(
            blend(interpolate(this.v, x0, y0), interpolate(this.v, x1, y0), xRatio),
            blend(interpolate(this.v, x0, y1), interpolate(this.v, x1, y1), xRatio),
            yRatio
        );

        return { u, v, speedKt: Math.hypot(u, v) * 1.94384 };
    }
}

function createCanvas(id) {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
}

function createCanvasLayer(id, canvas) {
    return {
        id,
        type: "custom",
        renderingMode: "2d",
        onAdd(map, gl) {
            this.gl = gl;
            this.texture = gl.createTexture();
            this.program = gl.createProgram();
            const vertexShader = gl.createShader(gl.VERTEX_SHADER);
            const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(vertexShader, `attribute vec2 a_position;
                attribute vec2 a_texcoord;
                varying vec2 v_texcoord;
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    v_texcoord = a_texcoord;
                }`);
            gl.shaderSource(fragmentShader, `precision mediump float;
                uniform sampler2D u_texture;
                varying vec2 v_texcoord;
                void main() {
                    gl_FragColor = texture2D(u_texture, v_texcoord);
                }`);
            gl.compileShader(vertexShader);
            gl.compileShader(fragmentShader);
            gl.attachShader(this.program, vertexShader);
            gl.attachShader(this.program, fragmentShader);
            gl.linkProgram(this.program);
            this.position = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.position);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1, 0, 1,
                1, -1, 1, 1,
                -1, 1, 0, 0,
                1, 1, 1, 0
            ]), gl.STATIC_DRAW);
            this.map = map;
        },
        render(gl) {
            if (!canvas.width || !canvas.height) return;
            const previousDepthTest = gl.isEnabled(gl.DEPTH_TEST);
            const previousCullFace = gl.isEnabled(gl.CULL_FACE);
            const previousBlend = gl.isEnabled(gl.BLEND);
            const previousDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            gl.depthMask(false);
            gl.useProgram(this.program);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.position);
            const position = gl.getAttribLocation(this.program, "a_position");
            const texcoord = gl.getAttribLocation(this.program, "a_texcoord");
            gl.enableVertexAttribArray(position);
            gl.enableVertexAttribArray(texcoord);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
            gl.vertexAttribPointer(texcoord, 2, gl.FLOAT, false, 16, 8);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            gl.uniform1i(gl.getUniformLocation(this.program, "u_texture"), 0);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.disableVertexAttribArray(position);
            gl.disableVertexAttribArray(texcoord);
            gl.depthMask(previousDepthMask);
            if (previousDepthTest) gl.enable(gl.DEPTH_TEST);
            if (previousCullFace) gl.enable(gl.CULL_FACE);
            if (!previousBlend) gl.disable(gl.BLEND);
            this.map.triggerRepaint();
        }
    };
}

function createLegend() {
    const legend = document.getElementById("wind-layer-legend");
    if (!legend) return;
    legend.style.background = `linear-gradient(90deg, ${WIND_COLOR_STOPS.map(stop =>
        `rgb(${stop.rgb.join(",")}) ${Math.min(stop.kt / 45 * 100, 100)}%`).join(", ")})`;
}

function createWindPopupContent(title, values) {
    const content = document.createElement("div");
    const heading = document.createElement("div");
    heading.className = "poptitle";
    heading.textContent = title;
    content.appendChild(heading);
    Object.entries(values).forEach(([label, value]) => {
        const row = document.createElement("div");
        row.textContent = `${label}: ${value}`;
        content.appendChild(row);
    });
    return content;
}

function formatModelTime(value) {
    if (!value) return "Unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "UTC"
    })} UTC`;
}

export function initWindLayers(MAPA) {
    const toggle = document.getElementById("wind-layer-toggle");
    if (!toggle) return;

    const heatCanvas = createCanvas("wind-heat-canvas");
    const particleCanvas = createCanvas("wind-particle-canvas");
    const heatContext = heatCanvas.getContext("2d");
    const particleContext = particleCanvas.getContext("2d");
    const offscreenCanvas = document.createElement("canvas");
    const offscreenContext = offscreenCanvas.getContext("2d");
    const windField = new WindField();
    let enabled = toggle.checked;
    let particles = [];
    let density = "mid";
    let animationFrame;
    let refreshTimer;
    let requestController;
    let moving = false;
    let lastFrame = performance.now();
    let activePopup;
    let weatherLayersAdded = false;
    let lastProjectionType = MAPA.getProjection().type;
    let refreshInFlight = false;
    let lastRefreshAt = 0;
    let retryAfter = 0;
    let retryTimer;

    function updateStatus() {
        const updateElement = document.getElementById("wind-last-update");
        const modelElement = document.getElementById("wind-model");
        if (updateElement) updateElement.textContent = formatModelTime(windField.dataTime);
        if (modelElement) modelElement.textContent = WIND_MODEL_LABEL;
    }

    function updateStatusMessage(message) {
        const updateElement = document.getElementById("wind-last-update");
        if (updateElement) updateElement.textContent = message;
    }

    function addWeatherLayersToMap() {
        if (weatherLayersAdded) return;
        const firstDataLayer = ["sdgtracks", "odbtracks", "gdctracks", "hestracks"].find(layerId => MAPA.getLayer(layerId));
        MAPA.addLayer(createCanvasLayer("wind-heat-map-layer", heatCanvas), firstDataLayer);
        MAPA.addLayer(createCanvasLayer("wind-particle-map-layer", particleCanvas), firstDataLayer);
        weatherLayersAdded = true;
    }

    function resize() {
        const rect = MAPA.getContainer().getBoundingClientRect();
        const devicePixelRatio = window.devicePixelRatio || 1;
        [heatCanvas, particleCanvas].forEach(canvas => {
            canvas.width = rect.width * devicePixelRatio;
            canvas.height = rect.height * devicePixelRatio;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        });
        heatContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        particleContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    function randomPoint() {
        const bounds = MAPA.getBounds();
        const southwest = bounds.getSouthWest();
        const northeast = bounds.getNorthEast();
        return {
            longitude: southwest.lng + Math.random() * (northeast.lng - southwest.lng),
            latitude: southwest.lat + Math.random() * (northeast.lat - southwest.lat)
        };
    }

    function spawnParticle() {
        const point = randomPoint();
        return { ...point, previous: null, age: Math.random() * 60, maxAge: 40 + Math.random() * 60 };
    }

    function resetParticles() {
        const count = Number(document.getElementById("wind-particle-count")?.value || 800);
        particles = Array.from({ length: count }, spawnParticle);
    }

    function isOccluded(lngLat) {
        const transform = MAPA.transform;
        if (!transform || typeof transform.isLocationOccluded !== "function") return false;
        try {
            return transform.isLocationOccluded(lngLat);
        } catch (error) {
            return false;
        }
    }

    // A screen pixel lies on the sphere only if unprojecting then reprojecting
    // returns to it. Off-globe space and the horizon fail this round trip.
    function isPixelOnGlobe(screenX, screenY, lngLat) {
        const projected = MAPA.project(lngLat);
        if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return false;
        return Math.hypot(projected.x - screenX, projected.y - screenY) <= PROJECTION_TOLERANCE_PX;
    }

    function drawHeatmap() {
        if (!windField.ready) return;
        const rect = MAPA.getContainer().getBoundingClientRect();
        const width = 140;
        const height = Math.max(1, Math.round(width * rect.height / rect.width));
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        const image = offscreenContext.createImageData(width, height);

        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const screenX = x / width * rect.width;
                const screenY = y / height * rect.height;
                const point = MAPA.unproject([screenX, screenY]);
                const pixel = (y * width + x) * 4;
                if (!isPixelOnGlobe(screenX, screenY, point)) continue;
                if (isOccluded(point)) continue;
                const vector = windField.vectorAt(point.lng, point.lat);
                if (!vector) continue;
                const color = colorForWind(vector.speedKt, 1).match(/[\d.]+/g).map(Number);
                image.data[pixel] = color[0];
                image.data[pixel + 1] = color[1];
                image.data[pixel + 2] = color[2];
                image.data[pixel + 3] = 153;
            }
        }
        offscreenContext.putImageData(image, 0, 0);
        heatContext.clearRect(0, 0, rect.width, rect.height);
        heatContext.drawImage(offscreenCanvas, 0, 0, width, height, 0, 0, rect.width, rect.height);
        MAPA.triggerRepaint();
    }

    function stepParticles(deltaMilliseconds) {
        const speedFactor = Number(document.getElementById("wind-particle-speed")?.value || 1);
        const delta = deltaMilliseconds / 1000 * speedFactor * 3000;
        particles.forEach(particle => {
            const vector = windField.vectorAt(particle.longitude, particle.latitude);
            if (!vector) {
                Object.assign(particle, spawnParticle());
                return;
            }
            const clampedLatitude = Math.min(Math.abs(particle.latitude), MAX_GRID_LATITUDE);
            const metersPerLongitude = 111320 * Math.cos(clampedLatitude * Math.PI / 180);
            particle.previous = { longitude: particle.longitude, latitude: particle.latitude };
            particle.longitude += vector.u * delta / metersPerLongitude;
            particle.latitude += vector.v * delta / 111320;
            particle.age += 1;
            particle.speedKt = vector.speedKt;
            if (particle.age > particle.maxAge) Object.assign(particle, spawnParticle());
        });
    }

    // Mercator world width in CSS pixels; used to size the antimeridian guard.
    function worldWidthPixels() {
        const west = MAPA.project([-180, 0]);
        const east = MAPA.project([180, 0]);
        const width = Math.abs(east.x - west.x);
        return Number.isFinite(width) ? width : 0;
    }

    function drawParticles() {
        const rect = MAPA.getContainer().getBoundingClientRect();
        particleContext.globalCompositeOperation = "destination-out";
        particleContext.fillStyle = "rgba(0,0,0,0.06)";
        particleContext.fillRect(0, 0, rect.width, rect.height);
        particleContext.globalCompositeOperation = "source-over";
        particleContext.lineWidth = 1.3;
        particleContext.lineCap = "round";

        // Half a world catches antimeridian wrap without rejecting fast particles when
        // zoomed in. The viewport term keeps the guard sane if the world width degenerates.
        const maxSegmentPixels = Math.max(
            worldWidthPixels() * 0.5,
            Math.min(rect.width, rect.height) * 0.25
        );

        particles.forEach(particle => {
            if (!particle.previous) return;
            const previousLngLat = { lng: particle.previous.longitude, lat: particle.previous.latitude };
            const currentLngLat = { lng: particle.longitude, lat: particle.latitude };
            if (isOccluded(previousLngLat) || isOccluded(currentLngLat)) return;
            const start = MAPA.project([previousLngLat.lng, previousLngLat.lat]);
            const end = MAPA.project([currentLngLat.lng, currentLngLat.lat]);
            if (!Number.isFinite(start.x) || !Number.isFinite(start.y) ||
                !Number.isFinite(end.x) || !Number.isFinite(end.y)) return;
            if (Math.hypot(end.x - start.x, end.y - start.y) > maxSegmentPixels) return;
            const alpha = Math.min(0.35 + (particle.speedKt || 0) / 60, 0.85);
            particleContext.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
            particleContext.beginPath();
            particleContext.moveTo(start.x, start.y);
            particleContext.lineTo(end.x, end.y);
            particleContext.stroke();
        });
        MAPA.triggerRepaint();
    }

    function animate(now) {
        const projectionType = MAPA.getProjection().type;
        if (projectionType !== lastProjectionType) {
            lastProjectionType = projectionType;
            particleContext.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
            if (enabled) {
                resetParticles();
                scheduleRefresh();
            }
        }
        if (enabled && !moving && windField.ready) {
            const delta = Math.min(now - lastFrame, 50);
            stepParticles(delta);
            drawParticles();
        }
        lastFrame = now;
        animationFrame = requestAnimationFrame(animate);
    }

    async function refresh(force = false) {
        if (!enabled) return;
        if (refreshInFlight) return;
        if (Date.now() < retryAfter) return;
        if (!force && Date.now() - lastRefreshAt < 15000) return;
        requestController?.abort();
        requestController = new AbortController();
        const selectedDensity = DENSITIES[density];
        refreshInFlight = true;
        try {
            const projection = MAPA.getProjection();
            const globeCenter = projection?.type === "globe" ? MAPA.getCenter().lng : null;
            await windField.load(MAPA.getBounds(), selectedDensity.cols, selectedDensity.rows, requestController.signal, globeCenter);
            resetParticles();
            drawHeatmap();
            updateStatus();
            lastRefreshAt = Date.now();
            retryAfter = 0;
        } catch (error) {
            if (error.name === "AbortError") return;
            if (error.message.includes("HTTP 429")) {
                retryAfter = Date.now() + 60000;
                updateStatusMessage("Rate limited; retrying in 1 min");
                clearTimeout(retryTimer);
                retryTimer = setTimeout(() => {
                    if (enabled) refresh();
                }, 60000);
                console.warn("Wind layer rate limited by Open-Meteo; retrying after the cooldown.");
            }
            else console.error("Wind layer refresh failed:", error);
        } finally {
            refreshInFlight = false;
        }
    }

    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    }

    async function showPointInfo(event) {
        if (!enabled) return;
        const interactiveLayers = new Set([
            "ODB", "SDG", "HES", "gdccruises", "hescruises", "sdgcruises", "odbcruises",
            "gdctracks", "hestracks", "sdgtracks", "odbtracks", "WCP", "DRE", "CTD", "COR"
        ]);
        const features = MAPA.queryRenderedFeatures(event.point);
        const blocked = features.some(feature => {
            const layerId = feature.layer?.id;
            if (!interactiveLayers.has(layerId)) return false;
            if (!VESSEL_LAYERS.has(layerId)) return true;
            // Vessel icons keep transparent padding, so MapLibre's symbol hit box is
            // wider than the drawn ship. Fall back to real pixel distance for those.
            const coordinates = feature.geometry?.coordinates;
            if (!Array.isArray(coordinates) || coordinates.length < 2) return true;
            const projected = MAPA.project(coordinates);
            return Math.hypot(projected.x - event.point.x, projected.y - event.point.y) <= VESSEL_CLICK_RADIUS_PX;
        });
        if (blocked) return;

        activePopup?.remove();
        activePopup = new maplibregl.Popup({ offset: 10, closeOnClick: false })
            .setLngLat(event.lngLat)
            .setDOMContent(createWindPopupContent("Wind at this point", { Status: "Loading..." }))
            .addTo(MAPA);

        const { lat, lng } = event.lngLat;
        const url = `${WIND_API_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
            "&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m" +
            `&wind_speed_unit=kn&timezone=auto&models=${WIND_MODEL}`;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
            const payload = await response.json();
            const current = payload.current;
            if (!current) throw new Error("Open-Meteo returned no current data");
            activePopup?.setDOMContent(createWindPopupContent("Wind at this point", {
                "Speed": `${current.wind_speed_10m ?? "--"} kt`,
                "Gusts": `${current.wind_gusts_10m ?? "--"} kt`,
                "Direction": `${current.wind_direction_10m ?? "--"}°`,
                "Temperature": `${current.temperature_2m ?? "--"}°C`,
                "Data time": formatModelTime(current.time),
                "Model": WIND_MODEL_LABEL
            }));
        } catch (error) {
            console.error("Wind point query failed:", error);
            activePopup?.setDOMContent(createWindPopupContent("Wind at this point", {
                Status: "Unable to load data"
            }));
        }
    }

    function setEnabled(value) {
        enabled = value;
        if (MAPA.getLayer("wind-heat-map-layer")) MAPA.setLayoutProperty("wind-heat-map-layer", "visibility", enabled ? "visible" : "none");
        if (MAPA.getLayer("wind-particle-map-layer")) MAPA.setLayoutProperty("wind-particle-map-layer", "visibility", enabled ? "visible" : "none");
        if (enabled) {
            resize();
            resetParticles();
            refresh();
        } else {
            requestController?.abort();
            heatContext.clearRect(0, 0, heatCanvas.width, heatCanvas.height);
            particleContext.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
        }
    }

    toggle.addEventListener("change", event => setEnabled(event.target.checked));
    MAPA.on("click", showPointInfo);
    document.querySelectorAll("input[name='wind-density']").forEach(input => {
        input.addEventListener("change", event => {
            density = event.target.value;
            if (enabled) refresh(true);
        });
    });
    document.getElementById("wind-particle-count")?.addEventListener("input", resetParticles);
    MAPA.on("movestart", () => {
        moving = true;
        particleContext.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    });
    MAPA.on("moveend", () => {
        moving = false;
        if (enabled) scheduleRefresh();
    });
    MAPA.on("resize", () => {
        resize();
        if (enabled) drawHeatmap();
    });
    MAPA.on("style.load", () => {
        addWeatherLayersToMap();
        if (enabled) scheduleRefresh();
    });

    createLegend();
    addWeatherLayersToMap();
    resize();
    setEnabled(enabled);
    animationFrame = requestAnimationFrame(animate);

    return () => {
        cancelAnimationFrame(animationFrame);
        clearTimeout(refreshTimer);
        requestController?.abort();
        heatCanvas.remove();
        particleCanvas.remove();
    };
}
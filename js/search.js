
const searchForm = document.querySelector('#search-panel form');
const previewBtn = document.getElementById('previewSearchData');

searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (previewBtn) previewBtn.disabled = true;
    $('#track-stats').hide();
    $('#track-stats-text').text('');

    const fechaInicio = document.getElementById('fecha_inicio').value;
    const fechaFin = document.getElementById('fecha_fin').value;
    const formattedFechaInicio = fechaInicio.replace(/-/g, ''); 
    const formattedFechaFin = fechaFin.replace(/-/g, '');
    const intervalInput = document.getElementById('interval');
    let interval = parseInt(intervalInput.value);
    
    if (isNaN(interval) || interval < 1) {
        alert("Please enter a valid interval (number of seconds greater than or equal to 1).");
        return; 
    }

    interval *= 1000; 
    const searchVessel = document.getElementById('sdg_hes_gdc').value; 
    const apiUrl = `https://datahub.utm.csic.es/ws/getSerie/${searchVessel}/NAV/?start=${formattedFechaInicio}&end=${formattedFechaFin}`;
    
    console.log("Fetch URL:", apiUrl); 
    
    
    $('#search-loader').fadeIn(200); 
    $('#searchTrack').prop('disabled', true);

   
    // --------------------------------------------------------
    ['ODB', 'SDG', 'HES'].forEach(vessel => {
        $(`#${vessel}-check`).prop('checked', false).trigger('change');
        $(`#${vessel}-track-check`).prop('checked', false).trigger('change');
    });
    // --------------------------------------------------------

    fetch(apiUrl)
        .then(response => response.text())
        .then(csvData => {
            let vesselIdentifier;
            switch (searchVessel) {
                case "SDG": vesselIdentifier = "$SDGNAV"; break;
                case "HES": vesselIdentifier = "$HESNAV"; break;
                case "GDC": vesselIdentifier = "$GDCNAV"; break;
                case "ODB": vesselIdentifier = "$ODBNAV"; break;
                default:
                    console.error("Unknown searchVessel value:", searchVessel);
                    alert("Invalid vessel selection.");
                    $('#search-loader').hide();
                    $('#searchTrack').prop('disabled', false);
                    return;
            }
            
            const lines = csvData.trim().split('\n');
            const waypoints = [];
            const timestamps = [];

            for (const line of lines) {
                const parts = line.split(',');
                if (parts[0] === vesselIdentifier) {
                    const dateStr = parts[1];
                    const timeStr = parts[2];
                    const lon = parseFloat(parts[3]);
                    const lat = parseFloat(parts[4]);

                    const year = parseInt(dateStr.slice(0, 4));
                    const month = parseInt(dateStr.slice(4, 6)) - 1;
                    const day = parseInt(dateStr.slice(6, 8));
                    const hours = parseInt(timeStr.slice(0, 2));
                    const minutes = parseInt(timeStr.slice(2, 4));
                    const seconds = parseInt(timeStr.slice(4, 6));

                    const timestamp = new Date(year, month, day, hours, minutes, seconds).getTime();

                    waypoints.push([lon, lat]);
                    timestamps.push(timestamp);
                }
            }

            if (waypoints.length === 0) {
                console.error("No waypoints found in the CSV data.");
                alert("No data found for the selected criteria.");
                
                $('#search-loader').hide();
                $('#searchTrack').prop('disabled', false);
                return;
            }

            const filteredWaypoints = [];
            const filteredTimestamps = [];
            let lastTimestamp = timestamps[0];
            filteredWaypoints.push(waypoints[0]);
            filteredTimestamps.push(timestamps[0]);

            for (let i = 1; i < waypoints.length; i++) {
                const currentTimestamp = timestamps[i];
                if (currentTimestamp - lastTimestamp >= interval) {
                    filteredWaypoints.push(waypoints[i]);
                    filteredTimestamps.push(timestamps[i]);
                    lastTimestamp = currentTimestamp;
                }
            }

            const filteredGeojson = {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: filteredWaypoints
                    },
                    properties: {
                        timestamps: filteredTimestamps
                    }
                }]
            };

            
            if (MAPA.getLayer('search-track-layer')) { MAPA.removeLayer('search-track-layer'); }
            if (MAPA.getSource('search-track-source')) { MAPA.removeSource('search-track-source'); }

            
            MAPA.addSource('search-track-source', {
                type: 'geojson',
                data: filteredGeojson
            });

            MAPA.addLayer({
                id: 'search-track-layer',
                type: 'line',
                source: 'search-track-source',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': 'red',
                    'line-width': 2
                }
            });

            const bounds = new maplibregl.LngLatBounds();
            filteredWaypoints.forEach(coord => bounds.extend(coord));
            MAPA.fitBounds(bounds, { padding: 50 });

            // Calculate total distance & duration using all waypoints
            let totalDistanceKm = 0;
            for (let i = 0; i < waypoints.length - 1; i++) {
                totalDistanceKm += getHaversineDistance(waypoints[i], waypoints[i + 1]);
            }
            const totalDistanceNM = totalDistanceKm / 1.852;
            const durationMs = timestamps[timestamps.length - 1] - timestamps[0];
            const durationDays = durationMs / (1000 * 60 * 60 * 24);

            const nmStr = isNaN(totalDistanceNM) ? "0.0" : totalDistanceNM.toFixed(1);
            const daysStr = isNaN(durationDays) ? "0.0" : durationDays.toFixed(1);
            
            $('#track-stats-text').text(`${nmStr} NM sailed in ${daysStr} days`);
            $('#track-stats').css('display', 'flex').hide().fadeIn(300);

            $('#search-loader').fadeOut(200);
            $('#searchTrack').prop('disabled', false);
            if (previewBtn) previewBtn.disabled = false;

        })
        .catch(error => {
            console.error("Error fetching or processing data:", error);
            alert("An error occurred. Please try again later.");
            
            $('#search-loader').hide();
            $('#searchTrack').prop('disabled', false);
            if (previewBtn) previewBtn.disabled = true;
        });
});

const descargarArchivos = async () => {
    const fechaInicio = document.getElementById('fecha_inicio').value;
    const fechaFin = document.getElementById('fecha_fin').value;
    
    if (!fechaInicio || !fechaFin) {
        alert("Select valid start and end dates.");
        return;
    }

    const fechaInicioOk = fechaInicio.replace(/-/g, '');
    const fechaFinOk = fechaFin.replace(/-/g, '');
    const searchVessel = document.getElementById('sdg_hes_gdc').value;

    const dataTypes = ["NAV", "TSS", "MET"];
    
    
    $('#search-loader .loader-text').text('Downloading...');
    $('#search-loader').fadeIn(200);

    try {
        for (const tipo of dataTypes) {
            const url = `https://datahub.utm.csic.es/ws/getSerie/${searchVessel}/${tipo}/?start=${fechaInicioOk}&end=${fechaFinOk}&download`;
            console.log("URL:", url);

            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn(`no downloading ${tipo}. Error: ${response.status}`);
                continue; 
            }

            const blob = await response.blob();
            
           
            if (blob.size < 50) {
                console.warn(`No data ${tipo} `);
                continue;
            }

            const anchor = document.createElement("a");
            anchor.href = window.URL.createObjectURL(blob);
            
          
            const nombreArchivo = `${searchVessel}_${tipo}_${fechaInicioOk}_${fechaFinOk}.csv`;
            anchor.download = nombreArchivo;
            
            document.body.appendChild(anchor); 
            anchor.click(); 
            
            document.body.removeChild(anchor); 
            window.URL.revokeObjectURL(anchor.href); 
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (error) {
        console.error("Error during download:", error);
        alert("Net error");
    } finally {
       
        $('#search-loader').fadeOut(200, function() {
            $(this).find('.loader-text').text('Processing...');
        });
    }
};

document.getElementById('download').addEventListener("click", descargarArchivos);

if (previewBtn) {
    previewBtn.addEventListener('click', (event) => {
        event.preventDefault();
        const fechaInicio = document.getElementById('fecha_inicio').value;
        const fechaFin = document.getElementById('fecha_fin').value;
        if (!fechaInicio || !fechaFin) {
            alert("Please search and display a track first.");
            return;
        }
        const formattedFechaInicio = fechaInicio.replace(/-/g, ''); 
        const formattedFechaFin = fechaFin.replace(/-/g, '');
        const searchVessel = document.getElementById('sdg_hes_gdc').value; 
        
        if (typeof window.openSearchDataPanel === 'function') {
            window.openSearchDataPanel(searchVessel, formattedFechaInicio, formattedFechaFin, "met");
        } else {
            console.warn("openSearchDataPanel is not defined.");
        }
    });
}

const clearButton = document.getElementById('clearTrack');

clearButton.addEventListener('click', (event) => {
    event.preventDefault(); 
    console.log('clearTrack...');
    
    let trackRemoved = false;

    if (MAPA.getLayer('search-track-layer')) {
        MAPA.removeLayer('search-track-layer');
        trackRemoved = true;
    }

    if (MAPA.getSource('search-track-source')) {
        MAPA.removeSource('search-track-source');
        trackRemoved = true;
    }

    if (trackRemoved) {
        console.log('cleartrack ok.');
    } else {
        console.log('No track.');
    }

    document.getElementById('fecha_inicio').value = '';
    document.getElementById('fecha_fin').value = '';
    document.getElementById('interval').value = '120'; 
    $('#track-stats').hide();
    $('#track-stats-text').text('');
    if (previewBtn) previewBtn.disabled = true;
    if (typeof window.closeCruiseDataPanel === 'function') {
        window.closeCruiseDataPanel();
    }
});

 // ==========================================
// BÚSQUEDA DE CAMPAÑAS (CRUISES)
// ==========================================

const cruiseWFSUrls = {
    "SDG": "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27SARMIENTO%20DE%20GAMBOA%27",
    "ODB": "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27OD%C3%93N%20DE%20BUEN%27",
    "HES": "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27HESP%C3%89RIDES%27",
    "GDC": "https://datahub.utm.csic.es/geoserver/utm/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=utm%3ACSR_simp&outputFormat=application%2Fjson&cql_filter=vessel=%27GARCIA%20DEL%20CID%27"
};

const vesselSelectCruise = document.getElementById('vessel-select-cruise');
const cruiseInput = document.getElementById('cruise-input'); // Nuevo input de texto
const cruiseList = document.getElementById('cruise-list');   // datalist
const searchCruiseBtn = document.getElementById('searchCruiseBtn');
const clearCruiseBtn = document.getElementById('clearCruiseBtn');
const cruiseSearchForm = document.getElementById('cruise-search-form');

let currentVesselCruisesData = [];
// Creamos un diccionario para traducir el "Texto escrito" al "ID interno de la campaña"
let currentCruisesMap = new Map(); 

// 1. Cargar las campañas cuando se selecciona un barco
vesselSelectCruise.addEventListener('change', async (e) => {
    const vessel = e.target.value;
    
    // UI Feedback
    cruiseInput.value = '';
    cruiseInput.placeholder = 'Loading...';
    cruiseInput.disabled = true;
    searchCruiseBtn.disabled = true;
    $('#search-loader').fadeIn(200);

    try {
        const response = await fetch(cruiseWFSUrls[vessel]);
        const geojson = await response.json();
        currentVesselCruisesData = geojson.features;

        const uniqueCruises = new Map();
        geojson.features.forEach(feature => {
            const props = feature.properties;
            const cruiseId = props.cruiseid || props.cuiseid || props.cruise_id; 
            const cruiseName = props.cruise || cruiseId;
            
            if (cruiseId && !uniqueCruises.has(cruiseId)) {
                uniqueCruises.set(cruiseId, cruiseName);
            }
        });

        // Limpiamos datos anteriores
        cruiseList.innerHTML = '';
        currentCruisesMap.clear();

        uniqueCruises.forEach((name, id) => {
            // Guardamos el texto visible y a qué ID corresponde
            currentCruisesMap.set(name, id);

            const option = document.createElement('option');
            option.value = name; 
            cruiseList.appendChild(option);
        });

        cruiseInput.placeholder = 'Type or select a cruise...';
        cruiseInput.disabled = false;
        $('#search-loader').fadeOut(200);

    } catch (error) {
        console.error("Error fetching cruises from WFS:", error);
        cruiseInput.placeholder = 'Error loading data';
        $('#search-loader').fadeOut(200);
    }
});

// 2. Habilitar el botón de búsqueda SOLO si el usuario ha escrito/seleccionado una campaña válida
cruiseInput.addEventListener('input', () => {
    searchCruiseBtn.disabled = !currentCruisesMap.has(cruiseInput.value);
});

// 3. Lógica principal de Highlight al enviar el formulario
cruiseSearchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const selectedName = cruiseInput.value;
    const targetId = currentCruisesMap.get(selectedName); // Obtenemos el ID interno
    const vesselId = vesselSelectCruise.value;
    
    if (!targetId) return;

    // --- FORZAR VISIBILIDAD DE LAS CAPAS ---
    const vesselLayerMap = {
        "SDG": ["sdgcruises", "sdgtracks"],
        "ODB": ["odbcruises", "odbtracks"],
        "HES": ["hescruises", "hestracks"],
        "GDC": ["gdccruises", "gdctracks"]
    };
    const pointLayers = ["WCP", "DRE", "CTD", "COR","MOC", "NET", "ROV", "OBS","MOC", "NET", "ROV", "OBS"];

    if (vesselId && vesselLayerMap[vesselId]) {
        vesselLayerMap[vesselId].forEach(layerId => {
            if (MAPA.getLayer(layerId)) {
                MAPA.setLayoutProperty(layerId, 'visibility', 'visible');
                const checkbox = document.getElementById(layerId);
                if (checkbox && !checkbox.checked) checkbox.checked = true;
            }
        });
    }

    pointLayers.forEach(layerId => {
        if (MAPA.getLayer(layerId)) {
            MAPA.setLayoutProperty(layerId, 'visibility', 'visible');
            const checkbox = document.getElementById(layerId);
            if (checkbox && !checkbox.checked) checkbox.checked = true;
        }
    });
    // ----------------------------------------------

    applyStandaloneHighlight(targetId);

    // Zoom a la campaña
    const bounds = new maplibregl.LngLatBounds();
    let hasBounds = false;
    
    currentVesselCruisesData.forEach(f => {
        const props = f.properties;
        const id = props.cruiseid || props.cuiseid || props.cruise_id;
        if (id === targetId && f.geometry) {
            if (f.geometry.type === "LineString") {
                f.geometry.coordinates.forEach(coord => bounds.extend(coord));
                hasBounds = true;
            } else if (f.geometry.type === "MultiLineString") {
                f.geometry.coordinates.forEach(line => line.forEach(coord => bounds.extend(coord)));
                hasBounds = true;
            }
        }
    });

    if (hasBounds) {
        MAPA.fitBounds(bounds, { padding: 50, duration: 1500 });
    }
});

// 4. Limpiar el Highlight
clearCruiseBtn.addEventListener('click', (e) => {
    e.preventDefault();

    cruiseInput.value = "";
    searchCruiseBtn.disabled = true;
    showTrackBtn.disabled = true;

    applyStandaloneHighlight("__NONE__");
});

// 5. Función que replica la lógica de `applyHighlight` de layers.js
function applyStandaloneHighlight(targetId) {
    const lineLayers = ["gdccruises", "hescruises", "sdgcruises", "odbcruises", "gdctracks", "hestracks", "sdgtracks", "odbtracks","SEI"];
    const pointLayers = ["WCP", "DRE", "CTD", "COR","MOC", "NET", "ROV", "OBS","MOC", "NET", "ROV", "OBS"];

    const filterExpression = [
        "any",
        ["==", ["get", "cruiseid"], targetId],
        ["==", ["get", "cruise_id"], targetId]
    ];

    lineLayers.forEach(layerId => {
        if (MAPA.getLayer(layerId)) {
            const isCruise = layerId.includes("cruises");
            MAPA.setPaintProperty(layerId, "line-width", ["case", filterExpression, isCruise ? 4 : 2, isCruise ? 2 : 1.5]);
            MAPA.setPaintProperty(layerId, "line-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
        }
    });

    pointLayers.forEach(layerId => {
        if (MAPA.getLayer(layerId)) {
            MAPA.setPaintProperty(layerId, "circle-radius", ["case", filterExpression, 7, 5]);
            MAPA.setPaintProperty(layerId, "circle-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
            MAPA.setPaintProperty(layerId, "circle-stroke-opacity", ["case", ["==", targetId, "__NONE__"], 1.0, filterExpression, 1.0, 0.15]);
        }
    });
}

const showTrackBtn = document.getElementById("showTrackBtn");
cruiseInput.addEventListener('input', () => {
    const valid = currentCruisesMap.has(cruiseInput.value);

    searchCruiseBtn.disabled = !valid;
    showTrackBtn.disabled = !valid;
});

function showStandaloneTrack(targetId) {

    const lineLayers = [
        "gdccruises", "hescruises", "sdgcruises", "odbcruises",
        "gdctracks", "hestracks", "sdgtracks", "odbtracks","SEI"
    ];

    const pointLayers = ["WCP", "DRE", "CTD", "COR","MOC", "NET", "ROV", "OBS","MOC", "NET", "ROV", "OBS"];

    const filterExpression = [
        "any",
        ["==", ["get", "cruiseid"], targetId],
        ["==", ["get", "cruise_id"], targetId]
    ];

    lineLayers.forEach(layerId => {

        if (!MAPA.getLayer(layerId)) return;

        const isTrack = layerId.includes("tracks");

        MAPA.setPaintProperty(layerId, "line-opacity",
            ["case",
                filterExpression, 1,
                0
            ]
        );

        MAPA.setPaintProperty(layerId, "line-width",
            ["case",
                filterExpression,
                isTrack ? 3 : 4,
                isTrack ? 3 : 2
            ]
        );
    });

    pointLayers.forEach(layerId => {

        if (!MAPA.getLayer(layerId)) return;

        MAPA.setPaintProperty(layerId, "circle-opacity",
            ["case",
                filterExpression, 1,
                0
            ]
        );

        MAPA.setPaintProperty(layerId, "circle-stroke-opacity",
            ["case",
                filterExpression, 1,
                0
            ]
        );
    });
}
showTrackBtn.addEventListener("click", () => {

    const selectedName = cruiseInput.value;
    const targetId = currentCruisesMap.get(selectedName);

    if (!targetId) return;

    showStandaloneTrack(targetId);
    zoomToCruise(targetId);
});
function zoomToCruise(targetId) {

    const bounds = new maplibregl.LngLatBounds();
    let hasBounds = false;

    currentVesselCruisesData.forEach(feature => {

        const props = feature.properties;
        const id = props.cruiseid || props.cuiseid || props.cruise_id;

        if (id !== targetId || !feature.geometry) return;

        switch (feature.geometry.type) {

            case "LineString":
                feature.geometry.coordinates.forEach(coord => bounds.extend(coord));
                hasBounds = true;
                break;

            case "MultiLineString":
                feature.geometry.coordinates.forEach(line => {
                    line.forEach(coord => bounds.extend(coord));
                });
                hasBounds = true;
                break;

            case "Point":
                bounds.extend(feature.geometry.coordinates);
                hasBounds = true;
                break;

            case "MultiPoint":
                feature.geometry.coordinates.forEach(coord => bounds.extend(coord));
                hasBounds = true;
                break;
        }
    });

    if (hasBounds) {
        MAPA.fitBounds(bounds, {
            padding: 50,
            duration: 1500
        });
    }
}

/**
 * Calculates the geodetic distance between two coordinates in kilometers using the Haversine formula.
 * @param {Array<number>} coord1 [longitude, latitude]
 * @param {Array<number>} coord2 [longitude, latitude]
 * @returns {number} Distance in kilometers
 */
function getHaversineDistance(coord1, coord2) {
    if (!coord1 || !coord2 || isNaN(coord1[0]) || isNaN(coord1[1]) || isNaN(coord2[0]) || isNaN(coord2[1])) {
        return 0;
    }
    const R = 6371; // Earth's radius in kilometers
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;
    const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const deltaLon = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
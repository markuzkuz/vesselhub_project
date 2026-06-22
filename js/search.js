
const searchForm = document.querySelector('#search-panel form');

searchForm.addEventListener('submit', (event) => {
    event.preventDefault();

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

            $('#search-loader').fadeOut(200);
            $('#searchTrack').prop('disabled', false);

        })
        .catch(error => {
            console.error("Error fetching or processing data:", error);
            alert("An error occurred. Please try again later.");
            
            $('#search-loader').hide();
            $('#searchTrack').prop('disabled', false);
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
});
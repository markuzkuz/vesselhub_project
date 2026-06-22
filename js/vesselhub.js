function openTab(evt, tabName) {
    // Declarar variables
    let i, tabcontent, tablinks;

    // Obtener todos los elementos con class="tab-content" y ocultarlos
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Obtener todos los elementos con class="tab-link" y quitar la clase "active"
    tablinks = document.getElementsByClassName("tab-link");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    // Mostrar la pestaña actual y añadir "active" al botón que la abrió
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}
$('#tool-btn').on('click', () => { $('#layers-panel').hide(); $('#search-panel').hide(); $('#add-panel').hide(); $('#captura-panel').hide(); $('#malla-panel').hide(); $('#tool-panel').toggle(); });
$('#layers-btn').on('click', () => { $('#tool-panel').hide(); $('#search-panel').hide(); $('#add-panel').hide(); $('#captura-panel').hide(); $('#malla-panel').hide(); $('#layers-panel').toggle(); });
$('#search-btn').on('click', () => { $('#tool-panel').hide(); $('#layers-panel').hide(); $('#add-panel').hide(); $('#captura-panel').hide(); $('#malla-panel').hide(); $('#search-panel').toggle(); });
$('#add-btn').on('click', () => { $('#tool-panel').hide(); $('#layers-panel').hide(); $('#search-panel').hide(); $('#captura-panel').hide(); $('#malla-panel').hide(); $('#add-panel').toggle(); });
$('#captura-btn').on('click', () => {
    // Agrupamos todos los paneles a ocultar en un solo selector
    $('#tool-panel, #layers-panel, #search-panel, #add-panel, #malla-panel').hide();

    // Alternamos el panel de captura
    $('#captura-panel').toggle();

    // Llamamos a la función de descarga pasando tu instancia de MapLibre (ej. MAPA)
    // Nota: Asegúrate de que la variable 'MAPA' sea accesible en este punto.
    if (typeof MAPA !== 'undefined') {
        descargarMapa(MAPA);
    } else {
        console.error("La instancia del mapa 'MAPA' no está definida.");
    }
});
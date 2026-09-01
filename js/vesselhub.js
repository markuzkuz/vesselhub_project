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
const PANEL_IDS = ['#tool-panel', '#layers-panel', '#search-panel', '#add-panel', '#captura-panel', '#malla-panel', '#wind-panel'];

function togglePanel(panelId) {
    PANEL_IDS.filter(id => id !== panelId).forEach(id => $(id).hide());
    $(panelId).toggle();
}

$('#tool-btn').on('click', () => togglePanel('#tool-panel'));
$('#layers-btn').on('click', () => togglePanel('#layers-panel'));
$('#search-btn').on('click', () => togglePanel('#search-panel'));
$('#add-btn').on('click', () => togglePanel('#add-panel'));
$('#wind-btn').on('click', () => togglePanel('#wind-panel'));
$('#captura-btn').on('click', () => {
    togglePanel('#captura-panel');

    // Llamamos a la función de descarga pasando tu instancia de MapLibre (ej. MAPA)
    // Nota: Asegúrate de que la variable 'MAPA' sea accesible en este punto.
    if (typeof MAPA !== 'undefined') {
        descargarMapa(MAPA);
    } else {
        console.error("La instancia del mapa 'MAPA' no está definida.");
    }
});
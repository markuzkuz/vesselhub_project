function openTab(evt, tabName) {

    const panelPadre = evt.currentTarget.closest('div[id$="-panel"]');
    
    if (!panelPadre) return; 

    let i, tabcontent, tablinks;

    
    tabcontent = panelPadre.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

   
    tablinks = panelPadre.getElementsByClassName("tab-link");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}
const PANEL_IDS = ['#tool-panel', '#layers-panel', '#search-panel', '#add-panel', '#captura-panel', '#malla-panel', '#measure-panel', '#wind-panel'];

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


document.querySelectorAll(".collapsible").forEach(title => {

    title.addEventListener("click", () => {

        title.classList.toggle("open");

        const content = title.nextElementSibling;
        content.classList.toggle("collapsed");

        const arrow = title.querySelector(".arrow");

        if (content.classList.contains("collapsed")) {
            arrow.src = "img/caret-right-solid-full.svg";
        } else {
            arrow.src = "img/caret-down-solid-full.svg";
        }

    });

});
function crearGrupoToggle(imagenId, arrayDeCheckboxesIds) {
        const imgToggle = document.getElementById(imagenId);
        if (!imgToggle) return;

        let grupoVisible = true;

        imgToggle.addEventListener('click', () => {
            grupoVisible = !grupoVisible;
            if (grupoVisible) {
                imgToggle.src = 'img/eye-solid-full.svg';
                imgToggle.style.opacity = '1';
            } else {

                imgToggle.src = 'img/eye-slash-solid-full.svg';
                imgToggle.style.opacity = '0.5';
            }

            arrayDeCheckboxesIds.forEach(id => {
                const checkbox = document.getElementById(id);
                if (checkbox && checkbox.checked !== grupoVisible) {
                    checkbox.checked = grupoVisible;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
        });
    }

crearGrupoToggle('toggle-stations', ['WCP', 'DRE', 'CTD', 'COR','NET', 'MOC', 'OBS', 'ROV','SEI']);
crearGrupoToggle('toggle-cruises', ['sdgcruises', 'odbcruises', 'gdccruises', 'hescruises']);
crearGrupoToggle('toggle-tracks', ['sdgtracks', 'odbtracks', 'gdctracks', 'hestracks']);

document.addEventListener('DOMContentLoaded', () => {


    const btnSearchTrack = document.getElementById('searchTrack');
    const btnAdd = document.getElementById('btnAdd');


    function apagarTodasLasCapas() {
        const todosLosCheckboxes = document.querySelectorAll('#layers-panel input[type="checkbox"]');

        todosLosCheckboxes.forEach(checkbox => {
            if (checkbox.checked) {
                checkbox.checked = false;
                checkbox.dispatchEvent(new Event('change'));
            }
        });
    }


    if (btnSearchTrack) {
        btnSearchTrack.addEventListener('click', apagarTodasLasCapas);
    }


    if (btnAdd) {
        btnAdd.addEventListener('click', apagarTodasLasCapas);
    }
});

# CLAUDE.md — VesselHub

Reglas específicas de **VesselHub**. Se apilan **encima** de las reglas globales
de `~/.claude/CLAUDE.md` (que siguen siendo NON-NEGOTIABLE). En caso de conflicto,
manda lo global.

---

## Contexto del proyecto

App web **frontend** de cartografía marítima (GIS) de la UTM-CSIC:

- **Stack**: HTML + CSS + **JavaScript vanilla** + jQuery (legacy).
- **Motor de mapa activo**: **MapLibre GL JS** (vendorizado en `js/maplibre-gl.js`).
  Soporta sky/atmósfera moderno (`setSky`) y proyección `globe`/`mercator`.
- **Backend mínimo**: `proxy.php` (proxy same-origin para evitar CORS en WMS/WFS;
  whitelist: `localhost`, `127.0.0.1`, `datahub.utm.csic.es`, `*.csic.es`, `*.covam.es`).
- **Sin framework, sin bundler, sin build step**: los `.js` se cargan directos en
  `index.html`. `js/fleet.js` es el único `type="module"` (punto de entrada).
- **Leaflet está fuera**: quedan plugins Leaflet (`L.*`) huérfanos en `js/` que no se
  cargan en ninguna parte (ver "Archivos muertos").

---

## Mapa del repositorio (datos reales · 2026-06-22)

### Orden de carga en `index.html`
`grid.js` → `download.js` → `vesselhub.js` → `search.js` → `add.js` → `fleet.js` (módulo ES).
CDN runtime: `chart.js`, `luxon@3`, `chartjs-adapter-luxon` (jsdelivr).

### Módulos JS activos (1 responsabilidad cada uno)
| Archivo | Tipo | Responsabilidad |
|---|---|---|
| `js/fleet.js` | módulo ES | **Entrada.** Crea `MAPA` (MapLibre), `getStyle()` (OSM/Esri), iconos de barcos, polling NAV/MET/TSS, tracks 24/72/144 h, y el canvas `#starfield` (cielo/estrellas día-noche). Importa `LoadLayers` e `initCruiseDataPanel`. |
| `js/layers.js` | módulo ES | `LoadLayers(MAPA)`: capas WFS (cruises `CSR_simp`, anual `CSR_annual`, estaciones WCP/DRE/CTD/COR), WMS EEZ y cartas náuticas, switch de basemap, wiring de checkboxes. |
| `js/cruiseCharts.js` | módulo ES | Panel de datos de crucero: descubre CSV en `data.utm.csic.es`, parsea y pinta series TS/MET con Chart.js + marcador sincronizado en el mapa. |
| `js/search.js` | global | `#search-panel`: track histórico por barco+fechas (CSV `getSerie`), lo pinta como línea GeoJSON, descarga y limpieza. |
| `js/add.js` | global | `#add-panel`: añadir capa externa (WMS/WFS/ArcGIS/GeoJSON local), `GetCapabilities` con fallback a `proxy.php`, lista `#layerControl` (visibilidad, símbolo, orden, borrar). |
| `js/grid.js` | global | Rejilla de coordenadas (líneas lat/lng + labels DMS) como fuente GeoJSON; `#grid-btn` la activa; `applyGridBasemapStyle` adapta color al basemap. |
| `js/download.js` | global | `descargarMapa(mapaInstance)`: exporta el canvas MapLibre a PNG. |
| `js/vesselhub.js` | global | Wiring de toggles de paneles laterales + `openTab` + captura. |

### Librerías
- Vendorizadas: `js/maplibre-gl.js`, `js/jquery.min.js`; `css/maplibre-gl.css`,
  `css/all.min.css` (Font Awesome), `css/style.css`, `css/vesselhub.css`.
- CDN: `chart.js` (sin pin), `luxon@3`, `chartjs-adapter-luxon`.

### Servicios externos (todo bajo CSIC salvo basemaps/CDN)
- **Tiempo real barco** (ODB/SDG/HES): `datahub.utm.csic.es/ws/getPoint/{v}/JSON/`,
  y `datahub.utm.csic.es/udp/{v}{POS|MET|TSS}`.
- **Tracks recientes**: `datahub.utm.csic.es/ws/getLine/{v}/JSON/indexTime.php?last={h}`.
- **Track histórico**: `datahub.utm.csic.es/ws/getSerie/{v}/NAV/?start=&end=`.
- **WFS cruises/estaciones**: `datahub.utm.csic.es/geoserver/utm/ows`.
- **Datos científicos**: `data.utm.csic.es/set/{v}/{date}/`.
- **Basemaps**: OSM (`a.tile.openstreetmap.org`), Esri World Imagery (`server.arcgisonline.com`).
- **WMS overlay**: EEZ (`geo.vliz.be`), cartas náuticas IDEIHM (`ideihm.covam.es`).
- **Glyphs MapLibre**: `demotiles.maplibre.org/font/...`.

### Globals expuestos en `window.` (no añadir más sin necesidad)
`MAPA`, `actualizarDatosNAV/MET/TSS`, `zoomToVessel`, `mapCenteredInitially`,
`closeTutorial`, `applyGridBasemapStyle`, `toggleEditor`, `updateSymbol`,
`toggleLyr`, `removeLyr`, `moveLyr`.

### DOM ids clave
`#map`, `#map-container`, `#starfield` (canvas, z-index 0, detrás del `#map`),
`#globe-theme-toggle` (día/noche), `#projection` (mercator/globe), `#layers-panel`,
`#tool-panel`, `#search-panel`, `#add-panel`, `#malla-panel`, `#cruise-data-panel`,
`#realtimedata`, `#vessel-selector`, `#layerControl`, `#btn-osm`/`#btn-esri`.

### Archivos muertos / huérfanos (NO usar como base, NO replicar)
No referenciados en `index.html` — candidatos a borrar (confirmar antes; el repo
**aún no tiene commits**, así que borrar = irreversible):
`js/add copy.js`, `js/layers copy.js`, `js/layers_old160626.js`, `js/vesselhub_ori.js`,
`js/styledLayerControl.js` (plugin Leaflet), `js/L.Control.MousePosition.js` (plugin Leaflet).

### Capa cielo/noche del globo (estado actual)
- El halo del globo lo pinta MapLibre nativo (`applySky` con `SKY_DAY`/`SKY_NIGHT`,
  solo visible en globe / pitch>0).
- El `#starfield` (canvas, detrás del mapa) dibuja: **noche** = estrellas atenuadas con
  twinkle animado; **día** = gradiente de cielo + nubes (sin sol, se quitó por distraer).
- El bucle (`renderFrame`/`loop`) se **pausa** cuando el canvas está oculto (mercator).
- **Pendiente próxima sesión**: optimizar el render del starfield/cielo para aligerar
  la carga de MapLibre (ver `.claude/NEXT_SESSION.md`).

---

## USAR SIEMPRE LAS SKILLS (NON-NEGOTIABLE)

Antes de ejecutar **cualquier** cosa que pida el usuario, evalúa qué skills aplican
y **úsalas**, encadenando las necesarias para cada caso. No es opcional.

- **Proceso primero, implementación después**: si hay trabajo creativo/nueva
  funcionalidad → `brainstorming` antes de tocar código. Si hay bug/fallo →
  `systematic-debugging` antes de proponer arreglo.
- **Implementar feature o bugfix** → `test-driven-development` antes del código.
- **Antes de afirmar "hecho/arreglado/pasa"** → `verification-before-completion`
  (evidencia ejecutada, nunca aserciones sin pruebas).
- **Al terminar feature relevante o antes de integrar** → `requesting-code-review`.
- **Verificar que un cambio funciona en la app real** → `run` / `verify`.
- **Tareas independientes en paralelo (2+)** → `dispatching-parallel-agents`.
- **Exploración extensa del código** → delega en subagentes (`Explore`).
- Comandos de sesión del workflow: `/start`, `/commit`, `/handoff`.

Si dudas si una skill aplica (≥1% de probabilidad), invócala para comprobarlo.

### Ejecución con subagentes (preferencias del usuario)
- **Contexto completo a los agentes** (spec + plan + constraints): que NO improvisen.
- **Spec review + code review tras CADA task principal** (no solo al final).
- **Las tareas, SIEMPRE como to-dos** (`TaskCreate`/`TaskUpdate`), actualizadas al avanzar.

---

## EXTENSIÓN DE PRINCIPIOS (SOLID · DRY · KISS · +)

Las reglas globales ya cubren DRY, KISS, no features no pedidas y no romper
funcionalidad. Aquí se extienden con principios profesionales para **este** stack.

### SOLID (adaptado a JS modular sin clases)
1. **Single Responsibility**: cada archivo/función hace una sola cosa (ver tabla de
   módulos). No mezclar UI, datos y mapa en la misma función.
2. **Open/Closed**: añade capas/fuentes nuevas extendiendo config/datos, no editando
   la lógica central del mapa.
3. **Dependency Inversion (pragmático)**: la lógica de negocio no debe depender de
   detalles de jQuery/DOM directamente; pasa datos, no nodos, entre funciones.

### YAGNI
No abstraigas hasta tener ≥2 usos reales. Nada de configuración "por si acaso".
Borra/ignora el código muerto (`*_old*.js`, `* copy.js`, `*_ori.js`, plugins Leaflet):
no los uses como base ni los repliques.

### Separation of concerns
- **Datos ↔ render ↔ UI** separados. El fetch de WMS/WFS devuelve datos; otra función
  los pinta; otra actualiza controles.
- Nada de lógica de negocio dentro de callbacks del DOM; extrae a función.

### Estado y globals
- Evita contaminar `window` (ya hay varios globals legacy; no añadas más sin necesidad).
- Una sola fuente de verdad para el estado del mapa/capas activas.

### Datos externos (WMS/WFS/proxy) — defensivo
- **Todo `fetch` puede fallar**: maneja errores HTTP, timeouts y respuestas vacías.
  Nunca asumas que `GetCapabilities`/WFS devuelve lo esperado.
- Valida y normaliza antes de usar; degrada con elegancia (mensaje, no romper el mapa).
- Pasa las URLs externas por `proxy.php`; respeta su whitelist de hosts.

### Seguridad
- **XSS**: no inyectes datos externos con `innerHTML`/`.html()` sin escapar. Usa
  `textContent` o sanitiza.
- **proxy.php (SSRF)**: mantén y respeta la validación de esquema/host.

### Rendimiento (mapa)
- `debounce`/`throttle` en eventos de alta frecuencia (`mousemove`, `zoom`, `pan`,
  input de búsqueda).
- No recrees capas/fuentes en cada render; reutiliza y actualiza.
- Limpia listeners y capas al destruir/cambiar de vista (evita leaks).
- El starfield no necesita 60fps; el bucle se pausa cuando está oculto.

### Consistencia
- Sigue el estilo del archivo que tocas (naming, idioma de comentarios, formato).
- Comentarios solo para lógica no obvia (regla global #1).

### Verificación
- Antes de dar algo por hecho, cárgalo en la app real y compruébalo
  (mapa renderiza, capa carga, sin errores en consola). Evidencia > afirmación.

---

## Recordatorio
- **NO git commit** (regla global #8): el usuario commitea a mano (GitHub Desktop).
  Claude prepara el **título** del commit y avisa cuando toca.
- **COMPLETED = inmutable** (regla global #6).

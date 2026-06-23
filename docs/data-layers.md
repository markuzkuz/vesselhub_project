# Carga de capas de datos — VesselHub

> Resumen de **cómo y de dónde** se cargan todas las capas/datos del mapa.
> Generado del análisis del repo (`js/fleet.js`, `js/layers.js`, `js/cruiseCharts.js`,
> `js/search.js`, `js/grid.js`). Última revisión: 2026-06-23.

## TL;DR

- **No hay acceso directo a ninguna DB.** Todo pasa por servicios web del CSIC.
- Tres familias de servicio en `datahub.utm.csic.es`:
  - **WS REST propio** (`/ws/getPoint`, `/ws/getLine`, `/ws/getSerie`) → tiempo real, tracks, series → **JSON o CSV**.
  - **WFS GeoServer** (`/geoserver/utm/ows`) → cruceros, tracks anuales y estaciones → **GeoJSON**.
  - **UDP** (`/udp/...`) → telemetría viva NAV/MET/TSS en **CSV** (última fila).
- **WMS** solo para overlays externos (EEZ `geo.vliz.be`, cartas náuticas `ideihm.covam.es`) → **PNG raster**.
- **`proxy.php` NO se usa** en estas cargas: todas llaman directo al host. El proxy es solo para capas externas que el usuario añade en `#add-panel` y para `GetCapabilities`.
- **Generado en local** (sin servicio): rejilla de coordenadas (`grid.js`) e iconos de barco (canvas, `fleet.js`).

---

## 🟢 Capas que se cargan POR DEFECTO

Se disparan en `MAPA.on("load")` → `LoadLayers(MAPA)` + polling de tiempo real (`fleet.js:340-350`).

### Tiempo real — posición de barcos (WS REST)

| Dato | Servicio | Endpoint | Formato | Polling | Proxy |
|---|---|---|---|---|---|
| Posición barcos (ODB, SDG, HES) | WS REST `getPoint` | `datahub.utm.csic.es/ws/getPoint/{V}/JSON/` | JSON/GeoJSON | 10 s | No |
| Tracks recientes 24h (def.) / 72h / 144h | WS REST `getLine` | `datahub.utm.csic.es/ws/getLine/{V}/JSON/indexTime.php?last={h}` | JSON/GeoJSON | 60 s | No |
| Iconos de barco | Local (Canvas 2D → `addImage`) | — | PNG dataURL | — | No |

> NAV/MET/TSS (`/udp/{V}{POS\|MET\|TSS}`, CSV, cada 2 s) **NO** se cargan al inicio: solo arrancan con un barco seleccionado en `#vessel-selector`. Son **bajo demanda**.

### Cruceros y tracks anuales (WFS / GeoServer)

Endpoint `datahub.utm.csic.es/geoserver/utm/ows` · `request=GetFeature` · `outputFormat=application/json` (**GeoJSON**), filtrados por `cql_filter=vessel='...'`. Checkbox marcado por defecto en `index.html`.

| Capa | typeName WFS | Barcos |
|---|---|---|
| Cruceros (líneas históricas) | `utm:CSR_simp` | SDG, ODB, HES, GDC |
| Tracks anuales (trayectoria completa) | `utm:CSR_annual` | SDG, ODB, HES, GDC |

### Estaciones / puntos (WFS / GeoServer)

Mismo endpoint, `GetFeature` → **GeoJSON de puntos**, visibles por defecto.

| Capa | typeName WFS | Qué es |
|---|---|---|
| WCP | `utm:WCP` | Water Column Profile |
| DRE | `utm:DRE` | Dredge (draga) |
| CTD | `utm:CTD` | CTD |
| COR | `utm:COR` | Sediment Corer |

### Basemap (raster XYZ)

| Capa | URL | Default |
|---|---|---|
| Esri World Imagery | `server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}` | ✅ visible |
| OpenStreetMap | `a.tile.openstreetmap.org/{z}/{x}/{y}.png` | cargado pero oculto (toggle `#btn-osm`) |

---

## 🟡 Capas BAJO DEMANDA

| Capa | Servicio | Endpoint | Formato | Disparador |
|---|---|---|---|---|
| NAV/MET/TSS (telemetría viva) | WS/UDP REST | `datahub.utm.csic.es/udp/{V}{POS\|MET\|TSS}` | CSV (última fila), 2 s | Selección de barco |
| WMS EEZ (zonas económicas) | WMS raster | `geo.vliz.be/geoserver/MarineRegions/wms` `LAYERS=eez` | PNG tiles | Checkbox |
| WMS Cartas náuticas | WMS raster | `ideihm.covam.es/wms/cartaENCp4` `LAYERS=ENC_ES4` | PNG tiles | Checkbox |
| Rejilla de coordenadas | Generada en local | — cálculo client-side sobre bounds | GeoJSON | Botón `#grid-btn` |
| Track histórico por barco+fechas | WS REST `getSerie` | `datahub.utm.csic.es/ws/getSerie/{V}/NAV/?start=&end=` | CSV → GeoJSON LineString | Form `#search-panel` |
| Datos científicos de crucero (gráficas TS/MET) | CSV vía dir listing | `data.utm.csic.es/set/{vessel}/{date}/open/{tipo}/csv/` | CSV | Click "View data" en popup |
| Descarga de datos | WS REST `getSerie` | `…/getSerie/{V}/{NAV\|MET\|TSS}/?...&download` | CSV | Botón Download |

---

## Estaciones (CTD, CORER…) — referencias en el código

Las 4 capas de estaciones son puntos GeoJSON servidos por el **WFS de GeoServer**.
MapLibre consume la URL WFS directamente como fuente `type: "geojson"` (es MapLibre
quien hace el fetch y recibe el GeoJSON; no hay parseo manual).

### Definición de los endpoints WFS — `js/layers.js:6-9`

```js
const wcp = "https://datahub.utm.csic.es/geoserver/utm/ows?...&typeName=utm%3AWCP&outputFormat=application%2Fjson"; // layers.js:6
const dre = "https://datahub.utm.csic.es/geoserver/utm/ows?...&typeName=utm%3ADRE&outputFormat=application%2Fjson"; // layers.js:7
const ctd = "https://datahub.utm.csic.es/geoserver/utm/ows?...&typeName=utm%3ACTD&outputFormat=application%2Fjson"; // layers.js:8
const cor = "https://datahub.utm.csic.es/geoserver/utm/ows?...&typeName=utm%3ACOR&outputFormat=application%2Fjson"; // layers.js:9
```

### Alta de fuente + capa (`addSource` + `addLayer`)

| Estación | `addSource` (consume el GeoJSON WFS) | `addLayer` (círculos) |
|---|---|---|
| WCP | `js/layers.js:134` | `js/layers.js:135-...` |
| DRE | `js/layers.js:162` | `js/layers.js:163-...` |
| **CTD** | **`js/layers.js:190`** → `addSource("CTD", { type: "geojson", data: ctd })` | **`js/layers.js:191-215`** (`type: "circle"`, color `#BC8AE8`) |
| **COR** (corer) | **`js/layers.js:218`** → `addSource("COR", { type: "geojson", data: cor })` | **`js/layers.js:219-243`** (`type: "circle"`, color `#AF2D1B`) |

Ejemplo concreto de CORER (`js/layers.js:217-218`):

```js
if (!MAPA.getSource("COR")) {
    MAPA.addSource("COR", { type: "geojson", data: cor }); // cor = URL WFS utm:COR
    MAPA.addLayer({ id: "COR", type: "circle", source: "COR", paint: { ... } });
}
```

> Las expresiones `circle-opacity` / `circle-radius` resaltan los puntos cuyo
> `cruiseid`/`cruise_id` coincide con el crucero seleccionado (`targetId`);
> el resto se atenúa a `0.15`.

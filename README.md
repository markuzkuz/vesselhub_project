# VesselHub

VesselHub is a browser-based maritime mapping application for UTM-CSIC. It
displays research vessels, historical cruises, scientific stations, external
WMS/WFS data, coordinate grids, and optional Open-Meteo wind conditions.

## Stack

- HTML and CSS
- Vanilla JavaScript with legacy jQuery integration
- MapLibre GL JS
- GeoServer WFS and WMS services
- Open-Meteo forecast data for the optional wind layer

There is no bundler or build step. JavaScript files are loaded directly from
`index.html`; `js/fleet.js` is the ES module entrypoint.

## Run locally

Serve the repository over HTTP so ES modules and remote requests work:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/index.html>.

## Main files

- `index.html`: application markup and layer controls.
- `js/fleet.js`: MapLibre map, vessels, tracks, polling, and globe presentation.
- `js/layers.js`: WFS/WMS registration and wind-module initialization.
- `js/windLayers.js`: Open-Meteo wind grid, heatmap, particles, globe clipping,
  point information, caching, and rate-limit handling.
- `js/add.js`: user-added external layers.
- `proxy.php`: same-origin proxy for approved external hosts.
- `docs/wind-layers.md`: detailed wind integration and production migration
  notes, including exact changed line ranges.

## Wind layer

Enable `Wind intensity and particles` from the Layers panel. The layer uses the
explicit ECMWF IFS 0.25° model, displays the model data timestamp, and allows
point queries for current wind speed, gusts, direction, temperature, and model.
In globe mode, rendering is clipped to the visible globe and longitudes are
normalized. A local cache and request cooldown reduce repeated API requests.

## Data services

The map consumes vessel data from `datahub.utm.csic.es`, scientific CSV data
from `data.utm.csic.es`, basemaps from OpenStreetMap and Esri, and optional WMS
layers documented in `docs/data-layers.md`.

## Production notes

Review external-service availability, CORS/CSP policy, attribution, API usage
limits, and the whitelist in `proxy.php` before deployment. Local `CLAUDE.md`
files are ignored by `.gitignore`.
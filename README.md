# VesselHub

VesselHub is a browser-based maritime mapping application for UTM-CSIC. It
displays research vessels, historical cruises, scientific stations, external
WMS/WFS data, coordinate grids, a measure tool, and optional wind conditions.

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

## Tests

Pure wind-layer helpers have unit tests using Node's built-in runner (no
dependencies):

```sh
node --test js/windLayers.test.mjs
```

Requires Node 20+. On Node 18 the import fails because `js/windLayers.js` is
treated as CommonJS; run it from a copy next to a `{"type":"module"}`
`package.json` instead.

## Main files

- `index.html`: application markup and layer controls.
- `js/fleet.js`: MapLibre map, vessels, tracks, polling, and globe presentation.
- `js/layers.js`: WFS/WMS registration and wind-module initialization.
- `js/windLayers.js`: Open-Meteo wind grid, heatmap, particles, globe clipping,
  point information, caching, rate-limit handling, and API usage logging.
- `js/measure.js`, `js/campaignDeepLinks.js`, `js/wcpProfileCharts.js`: measure
  tool, cruise deep links, and WCP profile charts.
- `js/add.js`: user-added external layers.
- `proxy.php`: same-origin proxy for approved external hosts.
- `docs/wind-layers.md`: detailed wind integration notes.

## Wind layer

Enable `Wind intensity and particles` from the wind panel. The layer uses the
explicit ECMWF IFS 0.25° model, displays the model data timestamp, and allows
point queries for current wind speed, gusts, direction, temperature, and model.
In globe mode, rendering is clipped to the visible globe and longitudes are
normalized.

- **Grid density** (Low 8×6, Medium 12×8 — default, High 16×11) sets how many
  world-grid points are requested. Changing it reloads the grid immediately.
- The grid is cached in `localStorage` for 90 minutes, so panning and zooming do
  not trigger requests.
- Every Open-Meteo request is logged to the browser console, with a per-browser
  UTC-day tally:

  ```
  [Open-Meteo] grid 12x8 chunk 1/1: 96 location(s) | today (UTC, this browser): 1 requests, 96 locations / 10000 free calls
  ```

  Open-Meteo's free tier is 10,000 calls/day per IP. Its docs do not say whether
  a multi-coordinate request counts as one call or one per location, so both
  numbers are shown.

### Known limitation and planned replacement

The world grid is very coarse (24°–51° between nodes), so particles and the
heatmap interpolate over thousands of kilometres and change direction when the
density changes. Grid nodes themselves are exact; the point popup is always
exact. The planned fix is a server-generated grid (see below).

### Planned: server-generated wind grid (not implemented yet)

Decisions taken on 2026-09-15:

- **Source**: ECMWF Open Data IFS 0.25° (`data.ecmwf.int`, CC-BY-4.0), only
  `10u`/`10v` fetched via HTTP Range using the `.index` byte offsets
  (~870 KB per step).
- **Resolution**: native 0.25° (1440×721).
- **Time**: hourly cron interpolates linearly between the two 3-hourly forecast
  steps around the current hour and publishes a single "current" grid.
- **Density selector**: removed (one server grid).
- **Fallback**: if the server file is missing, stale, or fails to load, the
  client falls back to the current Open-Meteo grid.
- **Popup**: stays on Open-Meteo per-point queries.

Server constraints found on `ciclope`: Ubuntu 20.04 (glibc 2.31), Python 3.8,
numpy, user cron, no passwordless sudo. The GRIB2 data uses CCSDS packing
(template 5.42), so decoding needs `eccodes`; the `eccodes==2.41.0` cp38
`manylinux_2_28` wheel should install without sudo after upgrading pip (20.0 is
too old for that wheel tag).

## Deployment

Server `data@ciclope.cmima.csic.es`, web root `/var/www/html/`:

| Directory | Role | URL |
|---|---|---|
| `vesselhub/` | production | https://data.utm.csic.es/vesselhub/ |
| `vesselhub_BETA/` | beta | http://ciclope.cmima.csic.es/vesselhub_BETA/ |

Flow: local `vesselhub` → local `vesselhub_BETA` mirror → server BETA →
production. Back up files into `.backups/*.tar.gz` on the server before
overwriting, then:

```sh
rsync -avzR --checksum <local-beta>/./index.html <local-beta>/./js/windLayers.js \
  data@ciclope.cmima.csic.es:/var/www/html/vesselhub_BETA/
```

A `chgrp ... js failed` warning (exit 23) is harmless: the directory is owned by
root. Verify with `md5sum` on the server. Apache sends no `Cache-Control`
header, so browsers may keep old JS after a deploy; hard-refresh
(Ctrl+Shift+R, or DevTools → Disable cache) when checking.

## Data services

The map consumes vessel data from `datahub.utm.csic.es`, scientific CSV data
from `data.utm.csic.es`, basemaps from OpenStreetMap and Esri, and optional WMS
layers documented in `docs/data-layers.md`.

## Production notes

Review external-service availability, CORS/CSP policy, attribution, API usage
limits, and the whitelist in `proxy.php` before deployment. Local `CLAUDE.md`
files are ignored by `.gitignore`.

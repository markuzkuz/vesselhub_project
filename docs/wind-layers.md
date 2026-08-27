# VesselHub wind layers

This document describes the Open-Meteo wind integration so it can be moved to
the production app without depending on the standalone prototype.

## Files

- `js/windLayers.js` owns the weather state, Open-Meteo requests, interpolation,
  heatmap rendering, particle animation, refresh scheduling, and cleanup.
- `js/layers.js` initializes the module from `LoadLayers(MAPA)`.
- `index.html` contains the layer controls.
- `css/style.css` positions the two pointer-events-free canvas overlays.

## Data source

The module requests current 10 m wind values from:

```text
https://api.open-meteo.com/v1/forecast
```

Each viewport is sampled as a small latitude/longitude grid. Requests are split
into chunks of 100 coordinates. Wind speed is requested in knots, while the
particle simulation converts the vector to metres per second internally.

The API is called only when the layer is enabled, after a debounced map move,
when the map style changes, and when the selected density changes. The module
requests the explicit `ecmwf_ifs025` model so the UI can show the actual model
name. A ten-minute
periodic refresh is not currently added; this can be added in production if
the weather layer must remain current while the user leaves the map still.

## Rendering model

Open-Meteo does not provide map tiles for this use case. The integration renders
two screen-space canvases through MapLibre custom layers:

1. `wind-heat-canvas` renders a low-resolution intensity image and scales it to
   the viewport.
2. `wind-particle-canvas` renders animated white trails using `MAPA.project()`.

The custom layers are inserted before the first vessel-track layer. This keeps
basemaps below the weather output and vessels, tracks, stations, coordinates,
and other MapLibre layers above it. When the wind layer is enabled, clicking an
empty map area queries Open-Meteo and opens a popup with speed, gusts, direction,
temperature, and model. Clicks on existing interactive features are left to
their existing vessel, cruise, track, or station popups.

In globe projection, the renderer calculates the projected great-circle horizon
around the current map center. The heatmap and particle canvas are clipped to
that horizon, and particles are seeded by sampling visible screen coordinates
before unprojecting them. This prevents weather data from being drawn outside
the globe or from using coordinates on the hidden hemisphere.

The wind overlay is independent of the MapLibre style JSON. It therefore does
not need a source or style layer and remains above the basemap and below the
existing UI panels.

## Controls

The controls are in the `WEATHER LAYERS` section of `#layers-panel`:

- `#wind-layer-toggle` enables or disables both canvases and network requests.
- `wind-density` selects an 8x6, 12x8, or 16x11 sample grid.
- `#wind-particle-count` controls the number of animated particles.
- `#wind-particle-speed` controls visual particle speed.
- `#wind-last-update` displays the `current.time` timestamp returned by
   Open-Meteo, not the browser page refresh or request completion time.
- `#wind-model` displays the selected model (`ECMWF IFS 0.25°`).

The layer is disabled by default to avoid unexpected API traffic and preserve
the existing VesselHub map appearance.

## Production migration

1. Copy `js/windLayers.js` into the production app.
2. Ensure the production entrypoint loads JavaScript as ES modules, or bundle
   this module with the existing frontend build.
3. Import `initWindLayers` from the production layer initializer.
4. Call `initWindLayers(existingMapInstance)` after the map has loaded and
   after `#map-container` exists in the DOM.
5. Copy the weather controls from `index.html`, or provide equivalent elements
   with the same IDs and `wind-density` radio name.
6. Copy the `.weather-layer-options` and `.wind-data-status` styles.
7. Confirm that the production Content Security Policy allows `fetch` requests
   to `https://api.open-meteo.com`.
8. If direct browser requests are not allowed by deployment policy, proxy the
   endpoint server-side and replace `WIND_API_URL` in `js/windLayers.js`.

## Operational considerations

- The module aborts an in-flight request before starting a newer viewport
  request, preventing stale data from replacing current data.
- Globe requests normalize longitudes to the Open-Meteo `[-180, 180]` range and
   unwrap them around the globe center during interpolation.
- Refreshes are serialized and rate-limited to one request cycle per 15 seconds
   unless the user explicitly enables the layer or changes density. HTTP 429
   responses are logged as a rate-limit warning instead of repeated retries.
- Refreshes happen after `moveend`, not during drag or zoom, to reduce API
  requests and canvas work.
- The particle animation pauses while the map is moving.
- The current sampling uses the map bounds directly. Globe views and views that
   cross the antimeridian should be tested in production because the globe mask
   and wrapped longitudes need special handling there.
- Open-Meteo availability, attribution requirements, usage limits, and terms
  should be reviewed before production deployment.

## Deliberate scope limits

This integration includes wind intensity and particles only. It does not add
wave data, forecast time controls, a continuous wave layer, or a new global
application state object.

## Exact change map

Line numbers below refer to the current working tree after this integration.
They are intentionally explicit so the changes can be copied into the
production repository.

| File | Exact changed lines | Change |
|---|---:|---|
| `js/windLayers.js` | 1-607 | New module containing the Open-Meteo API client, explicit ECMWF model selection, normalized globe longitude sampling, serialized refreshes, wind grid, MapLibre custom layers, globe horizon clipping, visible-globe particle seeding, interpolation, heatmap canvas, particle canvas, point-info popup, model-data-time status, controls, refresh lifecycle, and cleanup. |
| `js/layers.js` | 2 | Imports `initWindLayers` from the new module. |
| `js/layers.js` | 61 | Calls `initWindLayers(MAPA)` from `LoadLayers`. |
| `index.html` | 254-275 | Adds the weather layer toggle, density radios, particle count and speed sliders, plus last-update/model status inside `#layers-panel`. |
| `css/style.css` | 946-961 | Adds weather-control spacing and last-update/model status styling. |
| `docs/wind-layers.md` | 109-130 | This exact change map and its line references. |

The working tree also contains unrelated pre-existing edits in `index.html` and
`js/fleet.js`. They are not part of the wind integration and are excluded from
the line map above.
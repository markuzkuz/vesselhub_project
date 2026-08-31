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
- Refreshes happen after `moveend`, not during drag or zoom, to reduce API
  requests and canvas work.
- The particle animation pauses while the map is moving.
- The current sampling uses the map bounds directly. Globe views and views that
  cross the antimeridian should be tested in production because projected
  screen coordinates and wrapped longitudes need special handling there.
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
| `js/windLayers.js` | 1-556 | New module containing the Open-Meteo API client, explicit ECMWF model selection, wind grid, MapLibre custom layers, projection-aware globe clipping, interpolation, heatmap canvas, particle canvas, world-wrap filtering, point-info popup, model-data-time status, controls, refresh lifecycle, and cleanup. |
| `js/layers.js` | 2 | Imports `initWindLayers` from the new module. |
| `js/layers.js` | 61 | Calls `initWindLayers(MAPA)` from `LoadLayers`. |
| `index.html` | 254-275 | Adds the weather layer toggle, density radios, particle count and speed sliders, plus last-update/model status inside `#layers-panel`. |
| `css/style.css` | 946-961 | Adds weather-control spacing and last-update/model status styling. |
| `docs/wind-layers.md` | 103-149 | This exact change map and its line references. |

The working tree also contains unrelated pre-existing edits in `index.html` and
`js/fleet.js`. They are not part of the wind integration and are excluded from
the line map above.

## Current known-good baseline

Before the globe and vector-artifact work, the integration was verified with:

- Wind rendering through MapLibre custom layers below vessel, track, station,
   coordinate-grid, and other data layers.
- Open-Meteo point-click popups on empty map areas.
- Existing vessel, cruise, track, and station popups preserved.
- Explicit `ecmwf_ifs025` model selection shown as `ECMWF IFS 0.25°`.
- Model data time shown from Open-Meteo `current.time`, rather than page load
   time or request completion time.
- No visible canvas seam in Mercator after correcting the interleaved WebGL
   vertex buffer.

The next changes target two remaining issues without changing that baseline:

1. Reject particle segments that cross a wrapped world edge, which otherwise
    appear as long lines across the screen.
2. Add projection-aware clipping to the MapLibre weather custom layers so the
    weather texture is visible only inside the globe footprint in globe mode,
    while remaining full-map in Mercator mode.

Projection changes now trigger a new wind-grid request and particle reset. The
weather canvas is clipped to the visible globe disk, and particles are also
discarded when either endpoint is outside that disk or crosses a world-wrap
boundary. Globe grid requests normalize longitudes across the antimeridian
before sending them to Open-Meteo, and interpolation maps wrapped longitudes
back into the sampled range before reading the wind field.

The disk-based clipping described in this paragraph is **superseded** by the
design spec below, which identifies it as geometrically wrong under zoom, pan,
and pitch. The paragraph is retained because it documents the state of the code
as it stands today, before that work lands.

---

# Design spec: streak fix, globe reprojection, sidebar relocation

Status: **approved, not yet implemented.** Date: 2026-08-31.

This section is the agreed design for the next round of work. Each stage below
updates the reference sections above and the exact change map as it lands, so
this file stays the single source of truth for the production migration.

## Problem statement

Three defects block production migration.

1. **Particle streaks ("explosions").** Long white lines shoot across the
   viewport in both projections. Confirmed root cause below.
2. **Globe clipping is geometrically wrong.** The globe footprint is
   hardcoded as a disk centred in the container, so clipping breaks under
   zoom, pan, and pitch, and never rejects back-of-globe points.
3. **Controls live in the wrong place.** The weather controls sit inside
   `#layers-panel`; they belong behind a dedicated right-sidebar button.

## Root cause: particle streaks

In `js/windLayers.js`, `stepParticles()` respawns a particle whose position
falls outside the sampled grid:

```js
const vector = windField.vectorAt(particle.longitude, particle.latitude);
if (!vector) {
    Object.assign(particle, spawnParticle());   // does NOT clear particle.previous
    return;
}
```

`spawnParticle()` returns only `{longitude, latitude, age, maxAge}`. The
respawned particle therefore keeps the `previous` position it held before
teleporting, and the next `drawParticles()` call strokes a line from the old
location to the new random location — a streak across the map.

The age-out branch in the same function passes an explicit `{ previous: null }`
override, which is precisely why only the out-of-grid branch leaks. Particles
reach the padded grid edge continuously, so the defect fires every frame and is
independent of projection. This matches the observed behaviour in both
Mercator and globe.

The existing `Math.abs(end.x - start.x) > width * 0.5` guard in
`drawParticles()` is a partial mitigation: it suppresses only streaks longer
than half the viewport, so shorter ones still render.

## Secondary defects

**Pole blow-up.** `stepParticles()` converts metres to degrees of longitude
with `Math.max(metersPerLongitude, 1)`. As `cos(latitude)` approaches zero the
clamp bottoms out at one metre per degree, so a 10 m/s wind produces a jump of
hundreds of degrees in a single frame.

**Per-particle layout thrash.** `drawParticles()` calls
`getBoundingClientRect()`, `getContainer().clientWidth/clientHeight`, and
`getProjection()` inside the particle loop, forcing layout work once per
particle per frame.

## Chosen approach: round-trip projection validity (option A)

Rejected alternatives:

- *Per-frame globe disk.* Deriving the disk centre and radius from the camera
  each frame still fails under pitch, and a point on the far hemisphere can
  project inside the disk, so back-of-globe points would still render.
- *Full WebGL advection.* Sampling the wind field as a GPU texture and
  advecting particles in a shader is the fastest architecture, but it is a
  rewrite of a working module and is not justified by the current defects.

The chosen design introduces a single projection-agnostic predicate:

```js
function isPointVisible(lngLat) { /* occlusion + round-trip check */ }
```

A point is visible when both hold:

1. `MAPA.transform.isLocationOccluded(lngLat)` is false. MapLibre 5.7.1 is
   vendored in `js/maplibre-gl.js` and exposes this method; the call is
   feature-guarded so a Mercator transform without it degrades to "visible".
2. Re-projecting the unprojected point returns to the original screen pixel
   within tolerance. Pixels that are not on the sphere fail this test.

One predicate replaces both the fragment-shader disk and the ad-hoc particle
disk test, and it handles globe edges, back-of-globe occlusion, the horizon in
pitched Mercator, and off-globe space uniformly.

Because clipping now lives in the alpha channel of the two canvases rather than
in screen geometry, the `u_globe` uniform and its `discard` branch are deleted
from the fragment shader.

## Antimeridian wrap guard

`particle.longitude` accumulates without normalisation, so a particle crossing
the antimeridian keeps a small geographic delta while `MAPA.project()` places it
a full world-width away on screen. The guard must therefore be in screen space,
scaled to the world rather than to the viewport:

```js
const worldWidthPx = Math.abs(MAPA.project([180, 0]).x - MAPA.project([-180, 0]).x);
// reject segments longer than half a world
```

At low zoom this approximates the current half-viewport behaviour, which is
correct for wrap. At high zoom the world is far wider than the viewport, so the
guard stops rejecting legitimately fast particles — the failure mode of the
current fixed `width * 0.5` heuristic. The value is computed once per frame,
not per particle.

## Stage 1 — Mercator streak fix

Scope: `js/windLayers.js` only. No projection work.

- `spawnParticle()` returns `previous: null`, making every respawn path correct
  from one definition. The redundant `{ previous: null }` override on the
  age-out branch is removed.
- The longitude conversion clamps `|latitude|` to 85° before taking the cosine,
  giving a physical floor of about 9707 m per degree that matches the ±85°
  clamp already applied to the sampled grid.
- The half-viewport guard is replaced by the half-world guard above.
- Per-frame constants are hoisted out of the particle loop.

Exit criterion: no streaks in Mercator across zoom levels and at the
antimeridian, with the particle-speed slider at maximum.

## Stage 2 — Globe reprojection

Scope: `js/windLayers.js` only.

- Add `isPointVisible()` as described above.
- Apply it per texel in `drawHeatmap()`, writing alpha 0 for invalid texels.
- Apply it to both endpoints in `drawParticles()`, replacing the hardcoded
  globe-disk test.
- Delete `u_globe`, `u_resolution`, and the `discard` branch from the fragment
  shader, along with the uniform uploads that feed them.

Exit criterion: in globe mode the wind field is confined to the visible
hemisphere at any zoom, pan, and pitch, with no wind drawn off the globe and
none bleeding through from the far side. Mercator behaviour is unchanged from
stage 1.

## Stage 3 — Sidebar relocation

The controls move out of `#layers-panel` into a dedicated button and panel,
following the existing `#grid-btn` / `#add-panel` pattern exactly. The controls
are **moved, not duplicated** — confirmed with the user, per global rule 5.

- `img/wind-solid-full.svg`: new icon asset, the wind swoosh supplied by the
  user, matching the Font Awesome solid style of the sibling sidebar icons.
- `index.html`: delete the `WEATHER LAYERS` block from `#layers-panel`
  (including the stray `i` typo preceding its `<h3>`); add `#wind-btn` after
  `#grid-btn`; add a `#wind-panel` holding the toggle, density radios, particle
  sliders, and status rows unchanged.
- `css/style.css`: `#wind-btn { top: 350px; }`, add `#wind-panel` to the shared
  panel selector list and give it `top: 350px`.
- `js/vesselhub.js`: add `#wind-panel` to the four existing mutual-hide
  handlers and to the initial hide, and add the `#wind-btn` handler.

`initWindLayers()` needs no change: it already binds by element id and
early-returns when `#wind-layer-toggle` is absent, so relocating the markup is
transparent to the module.

Exit criterion: the button toggles the panel, the panel is mutually exclusive
with the other sidebar panels, every control still drives the layer, and no
weather control remains in `#layers-panel`.

## Verification

The project has no test framework, no bundler, and no build step, so
test-driven development in the usual sense does not apply. Verification is
therefore executed in the real application, per the repository's
evidence-over-assertion rule:

1. Serve the project and load `index.html`.
2. For each stage, exercise the exit criterion above.
3. Confirm a clean browser console — in particular no Open-Meteo failures, no
   WebGL warnings, and no MapLibre layer errors.
4. Confirm the pre-existing baseline still holds: vessel, cruise, track, and
   station popups; wind popups on empty map areas; layer ordering below vessel
   and track layers.

Each stage is verified before the next begins.

## Out of scope

Unchanged from the deliberate scope limits above: no wave data, no forecast
time controls, no new global application state. The thermometer and wave icons
supplied alongside the wind icon are noted as possible future layers and are
not part of this work.
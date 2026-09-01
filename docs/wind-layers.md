# VesselHub wind layers

This document describes the Open-Meteo wind integration so it can be moved to
the production app without depending on the standalone prototype.

## Files

- `js/windLayers.js` owns the weather state, Open-Meteo requests, interpolation,
  heatmap rendering, particle animation, globe/Mercator clipping, refresh
  scheduling, and cleanup.
- `js/layers.js` initializes the module from `LoadLayers(MAPA)`.
- `index.html` contains `#wind-btn` and the `#wind-panel` controls.
- `css/style.css` positions `#wind-btn`/`#wind-panel` and the two
  pointer-events-free canvas overlays.
- `js/vesselhub.js` wires `#wind-btn` to open `#wind-panel` via the shared
  `togglePanel()` helper.
- `img/wind-solid-full.svg` is the `#wind-btn` icon.
- `js/fleet.js` draws the vessel icons whose geometry `showPointInfo`'s
  vessel-click distance check depends on (see Production migration below).

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

### Globe and Mercator clipping

Both canvases clip themselves in their own alpha channel; the fragment shader
no longer clips anything. Two functions defined inside `initWindLayers`
(`js/windLayers.js`) decide, per texel or per particle endpoint, whether a
point is visible:

- `isOccluded(lngLat)` calls `MAPA.transform.isLocationOccluded(lngLat)` when
  that method exists on the transform, wrapped in `try`/`catch`, and defaults
  to `false` ("visible") otherwise. MapLibre 5.7.1, vendored in
  `js/maplibre-gl.js`, does expose the method, so this branch is live rather
  than a fallback: `isOccluded` delegates to a real surface-visibility check
  in globe mode and returns `false` unconditionally in Mercator.
- `isPixelOnGlobe(screenX, screenY, lngLat)` re-projects `lngLat` and checks
  the result lands within `PROJECTION_TOLERANCE_PX` (2px) of the original
  screen pixel. A pixel that is off the sphere or past the horizon fails this
  round trip.

`drawHeatmap()` leaves a texel's alpha at 0 if either check fails for it.
`drawParticles()` drops a segment if `isOccluded` is true for either endpoint.
It does **not** run the round-trip check: particles are projected *from*
longitude/latitude in the first place, so re-projecting them would trivially
match and add roughly 1600 redundant `project()` calls per frame at the
default particle count for no benefit. This is a deliberate, better-factored
implementation of the single `isPointVisible()` predicate named in the design
spec below — same behaviour, split so each half only does the check that
applies to what it is validating.

This replaces the old fragment-shader clipping, which hardcoded the globe as
a screen-space disk (`min(width,height)/2`, centred in the container) via
`u_globe`/`u_resolution` uniforms and a `discard` branch. That approach broke
under zoom, pan, and pitch, and never rejected far-hemisphere points that
happened to project inside the disk. The uniforms, the uniform uploads that
fed them, and the `discard` branch are all deleted.

## Controls

The controls live in `#wind-panel`, opened by the `#wind-btn` sidebar button
(icon `img/wind-solid-full.svg`), following the same button/panel pattern as
the other sidebar tools (e.g. `#add-btn` / `#add-panel`, wired via
`togglePanel('#add-panel')` in `js/vesselhub.js`). They are no longer part of
`#layers-panel`.

- `#wind-layer-toggle` enables or disables both canvases and network requests.
- `wind-density` selects an 8x6, 12x8, or 16x11 sample grid.
- `#wind-particle-count` controls the number of animated particles.
- `#wind-particle-speed` controls visual particle speed.
- `#wind-last-update` displays the `current.time` timestamp returned by
   Open-Meteo, not the browser page refresh or request completion time.
- `#wind-model` displays the selected model (`ECMWF IFS 0.25°`).
- `#wind-layer-legend` renders the 0-45+ kt colour scale via `createLegend()`
  in `js/windLayers.js`. That function existed before this round but was dead
  code: it always targeted `#wind-layer-legend`, an id that did not exist
  anywhere in the markup, so it silently rendered nothing. No JS changed to
  fix this — adding the `<div id="wind-layer-legend">` plus the
  `.wind-legend`/`.wind-legend-scale` CSS was enough to make the existing
  function work, so the colour scale is visible in-app for the first time.
- `.wind-attribution` shows an Open-Meteo credit line and link. This is
  required, not cosmetic: Open-Meteo's free tier is licensed CC BY 4.0, which
  mandates visible attribution. This satisfies the attribution point raised
  under Operational considerations below.

The layer is disabled by default to avoid unexpected API traffic and preserve
the existing VesselHub map appearance.

## Production migration

1. Copy `js/windLayers.js` into the production app.
2. Ensure the production entrypoint loads JavaScript as ES modules, or bundle
   this module with the existing frontend build.
3. Import `initWindLayers` from the production layer initializer.
4. Call `initWindLayers(existingMapInstance)` after the map has loaded and
   after `#map-container` exists in the DOM.
5. Copy the `#wind-btn` sidebar button (`index.html`, currently line 133) and
   the `#wind-panel` markup (currently lines 429-463, including the
   `#wind-layer-legend` div and the `.wind-attribution` block), or provide
   equivalent elements with the same IDs and `wind-density` radio name. Copy
   `img/wind-solid-full.svg`. Wire the button the same way `js/vesselhub.js`
   does: a click handler that hides sibling panels and toggles `#wind-panel`
   (see its `togglePanel()` helper and `PANEL_IDS` list).
6. Copy the `#wind-btn { top: 350px; }` and `#wind-panel { top: 350px; }`
   offsets plus the `.weather-layer-options`, `.wind-data-status`,
   `.wind-legend`, `.wind-legend-scale`, and `.wind-attribution` styles from
   `css/style.css`.
7. Confirm that the production Content Security Policy allows `fetch` requests
   to `https://api.open-meteo.com`.
8. If direct browser requests are not allowed by deployment policy, proxy the
   endpoint server-side and replace `WIND_API_URL` in `js/windLayers.js`.
9. `js/fleet.js`'s `createBoatImage` must travel with the wind module, or be
   matched exactly. `showPointInfo`'s vessel click check
   (`VESSEL_CLICK_RADIUS_PX = 15` in `js/windLayers.js`) assumes the vessel
   icon canvas is the cropped 64x64 size with the drawing origin at `(23,42)`
   described in the exact change map below. A production app that keeps an
   older, larger icon canvas (e.g. the original 150x150 with more transparent
   padding) but adopts this wind module as-is would need
   `VESSEL_CLICK_RADIUS_PX` re-tuned, or vessel clicks would again swallow
   nearby wind-popup clicks.

## Operational considerations

- The module aborts an in-flight request before starting a newer viewport
  request, preventing stale data from replacing current data.
- Refreshes happen after `moveend`, not during drag or zoom, to reduce API
  requests and canvas work.
- The particle animation pauses while the map is moving.
- The current sampling uses the map bounds directly. Globe views and
  antimeridian-crossing views have been verified directly rather than left as
  a caveat: `isOccluded` plus `isPixelOnGlobe` confine the wind field to the
  visible hemisphere under zoom, pan, and pitch (see Globe and Mercator
  clipping above), and the half-world particle-segment guard rejects
  antimeridian-wrap streaks without rejecting legitimately fast particles
  when zoomed in.
- Open-Meteo attribution is satisfied in-app: the `.wind-attribution` line in
  `#wind-panel` (see Controls) meets the CC BY 4.0 credit requirement of the
  free tier. Usage limits and terms should still be reviewed if production
  traffic volume grows well beyond prototype usage.

## Deliberate scope limits

This integration includes wind intensity and particles only. It does not add
wave data, forecast time controls, a continuous wave layer, or a new global
application state object.

### Known limitations (not yet addressed)

Identified during this round of work but out of scope for it; listed here so
they are not silently lost before production migration.

- **Incomplete teardown.** `initWindLayers` returns a cleanup function that
  cancels the animation frame, clears the refresh timer, aborts an in-flight
  request, and removes the two canvas elements — but nothing in the codebase
  calls that returned function today (`js/layers.js` calls
  `initWindLayers(MAPA)` and discards the result). The five `MAPA.on(...)`
  listeners (`click`, `movestart`, `moveend`, `resize`, `style.load`) and the
  two custom map layers (`wind-heat-map-layer`, `wind-particle-map-layer`)
  are never removed, so the module cannot currently be torn down cleanly.
- **No periodic data refresh.** The module refreshes on map move, style
  change, and density change, but not on a timer. A user who leaves the map
  open and stationary sees increasingly stale wind data with no indication
  that it has gone stale.
- **No user-visible fetch-error state.** A failed Open-Meteo request is
  console-only; the map silently keeps showing the last-good wind field
  rather than surfacing an error or a "data unavailable" state to the user.
- **Fixed heatmap offscreen width.** `drawHeatmap()` renders to a 140px-wide
  offscreen canvas regardless of the actual viewport size or device pixel
  ratio, then scales it up. This is deliberately coarse for performance, but
  it means visual resolution does not adapt to large or high-DPI viewports.
- **Uniform particle spawning.** Particles are spawned uniformly over
  latitude/longitude, which over-concentrates them near the poles in
  Mercator, where a degree of longitude covers much less ground than at the
  equator.
- **Globe particle spawn is not mask-restricted.** `main`'s pre-branch baseline
  restricted particle spawn to a CPU-computed polygon approximating the visible
  globe disk. That mask used the same screen-space-circle approach Task 2 replaced
  for clipping (verified geometrically incorrect under zoom/pan/pitch), so it was
  deliberately not restored alongside the rate-limiting/WebGL-state/longitude-clamp
  fixes in this round. Particles still spawn uniformly over the full lat/lng bounds
  in globe mode and are discarded post-spawn by `isOccluded`, so roughly half the
  particle budget is wasted on the occluded hemisphere at any moment.

## Exact change map

Line numbers below refer to the current working tree after this integration.
They are intentionally explicit so the changes can be copied into the
production repository.

| File | Exact changed lines | Change |
|---|---:|---|
| `js/windLayers.js` | 1-646 (whole file) | Open-Meteo API client, explicit ECMWF model selection, wind grid, MapLibre custom layers, interpolation, heatmap canvas, particle canvas, point-info popup, model-data-time status, controls, refresh lifecycle, and cleanup. |
| `js/windLayers.js` | 10, 396-397 | `MAX_GRID_LATITUDE = 85` and its use clamping the metres-per-degree-longitude term near the poles (Task 1, commit 0855a12). |
| `js/windLayers.js` | 329, 387-405 | `spawnParticle()` always returns `previous: null`; `stepParticles()` no longer leaks a stale `previous` on out-of-grid respawn (Task 1). |
| `js/windLayers.js` | 407-413, 424-429 | `worldWidthPixels()` and the half-world antimeridian segment guard in `drawParticles()`, replacing the old half-viewport (`width * 0.5`) guard (Task 1). |
| `js/windLayers.js` | 23, 337-353 | `PROJECTION_TOLERANCE_PX`, `isOccluded(lngLat)`, and `isPixelOnGlobe(screenX, screenY, lngLat)` — the occlusion + round-trip clipping that replaced the screen-space disk (Task 2, commit ec77520). |
| `js/windLayers.js` | 355-385, 415-449 | `drawHeatmap()` and `drawParticles()` call `isOccluded`/`isPixelOnGlobe` per texel or endpoint instead of the old disk test; the `u_globe`/`u_resolution` uniforms and the shader `discard` branch are deleted entirely (Task 2). |
| `js/windLayers.js` | 234-239, 583 | `createLegend()` (pre-existing, previously dead) now has a live target (`#wind-layer-legend`) and runs from `initWindLayers` (Task 3, commit e6a3a95). |
| `js/windLayers.js` | 25-26, 500-506 | `VESSEL_LAYERS`, `VESSEL_CLICK_RADIUS_PX`, and the true-pixel-distance fallback in `showPointInfo()` so only close vessel clicks block the wind popup (Task 4, commit 80d33db). |
| `js/layers.js` | 2 | Imports `initWindLayers` from the module. |
| `js/layers.js` | 61 | Calls `initWindLayers(MAPA)` from `LoadLayers`. |
| `js/fleet.js` | 133-156 | `createBoatImage()`: canvas cropped from 150x150 to 64x64 (lines 135-136), drawing origin shifted from `(66,85)` to `(23,42)` (`ORIGIN_X`/`ORIGIN_Y` at lines 138-139), same shape and rotation-safety, smaller symbol hit box (Task 4). |
| `js/vesselhub.js` | 21, 23-26 | `PANEL_IDS` (now including `#wind-panel`) and the `togglePanel(panelId)` helper that replaced five near-duplicated hide-all-others handlers (Task 3). |
| `js/vesselhub.js` | 32 | `$('#wind-btn').on('click', () => togglePanel('#wind-panel'))` (Task 3). |
| `index.html` | 133 | Adds the `#wind-btn` sidebar button, icon `img/wind-solid-full.svg` (Task 3). |
| `index.html` | 429-463 | Adds `#wind-panel` (toggle, density radios, particle sliders, status rows, `#wind-layer-legend`, `.wind-attribution`), moved out of `#layers-panel`. The old `WEATHER LAYERS` block and its stray leading `i` typo are deleted from `#layers-panel` (Task 3). |
| `img/wind-solid-full.svg` | new file | Wind-swoosh icon for `#wind-btn`, matching the Font Awesome solid style of sibling sidebar icons (Task 3). |
| `css/style.css` | 25, 40 | `#wind-btn { top: 350px; }` and `#wind-panel { top: 350px; }` (Task 3). |
| `css/style.css` | 948-975 | `.weather-layer-options`, `.wind-data-status`, `.wind-legend`, `#wind-layer-legend`, `.wind-legend-scale`, `.wind-attribution` (Task 3). |
| `docs/wind-layers.md` | this file | Recorded the above once Tasks 1-4 landed and were reviewed (Task 5). |
| `js/windLayers.js` | 60-65 | `unwrapLongitude(longitude, reference)` — normalizes then unwraps a longitude to the ±180° window nearest a reference, restoring `main`'s antimeridian-safe longitude math (Task 6). |
| `js/windLayers.js` | 72-83 | `WindField.load` gains a fifth parameter `globeCenter`; restores `main`'s longitude-span clamp and adds a globe-aware ±90° sampling window centred on `globeCenter` when the projection is `globe`, fixing an unclamped span that could exceed 500° across a pole (Task 6). |
| `js/windLayers.js` | 141-142 | `vectorAt` uses `unwrapLongitude` in place of the old manual ±360° wrap loop, consistent with the restored `load` clamp (Task 6). |
| `js/windLayers.js` | 310-313, 322-325 | `refreshInFlight`, `lastRefreshAt`, `retryAfter`, `retryTimer` state and `updateStatusMessage(message)`, restoring the Open-Meteo 429 rate-limit plumbing (Task 6). |
| `js/windLayers.js` | 501-534 | `refresh(force = false)` restores the in-flight guard, the 15s throttle (bypassed by `force`), and the 429 backoff (60s cooldown, visible `#wind-last-update` message, auto-retry) (Task 6). |
| `js/windLayers.js` | 613 | Density-change handler calls `refresh(true)` so an explicit user action is never swallowed by the new throttle (Task 6). |
| `js/windLayers.js` | 216-252 | `render(gl)` saves and restores `DEPTH_TEST`/`CULL_FACE`/`BLEND`/depth mask around the custom layer's draw call, preventing state leakage into whatever MapLibre draws next (Task 6). |

Line numbers above were re-derived with `wc -l` and `grep -n` against the
working tree at the end of Task 4 (commit 80d33db), not carried over from
earlier drafts of this document.

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

**Historical note:** the two paragraphs below describe the state of the code
*before* the 2026-08-31 round (Tasks 1-4, commits 0855a12 through 80d33db) and
are retained only as a record of the starting point. They do **not** describe
the current code — see "Globe and Mercator clipping" and "Root cause: particle
streaks" above for what replaced them.

At that earlier point, the two remaining issues without changing the baseline
above were:

1. Reject particle segments that cross a wrapped world edge, which otherwise
    appear as long lines across the screen.
2. Add projection-aware clipping to the MapLibre weather custom layers so the
    weather texture is visible only inside the globe footprint in globe mode,
    while remaining full-map in Mercator mode.

Projection changes triggered a new wind-grid request and particle reset. The
weather canvas was clipped to the visible globe disk, and particles were also
discarded when either endpoint was outside that disk or crossed a world-wrap
boundary — this disk-based clipping is the geometrically-wrong approach the
design spec below identified and Task 2 replaced. Globe grid requests still
normalize longitudes across the antimeridian before sending them to
Open-Meteo, and interpolation still maps wrapped longitudes back into the
sampled range before reading the wind field — that part of the design was
unaffected by the clipping rewrite and remains accurate today.

Both issues above are now resolved: Task 1 (commit 0855a12) fixed the
particle-segment streaks, and Task 2 (commit ec77520) replaced the disk-based
clipping with the occlusion + round-trip design described earlier in this
file.

---

# Design spec: streak fix, globe reprojection, sidebar relocation

Status: **implemented.** Approved and completed 2026-08-31, across four
commits on branch `windy_layer`: `0855a12` (Task 1, streak fix), `ec77520`
(Task 2, globe reprojection), `e6a3a95` (Task 3, sidebar relocation, plus two
user-approved scope additions), and `80d33db` (Task 4, a user-reported vessel
click-target bug found during Task 3 verification, not part of the original
spec). All four were reviewed clean.

Task 2 Step 1's open branch is resolved: `MAPA.transform.isLocationOccluded`
**is** available on the vendored MapLibre 5.7.1 transform, so `isOccluded()`
delegates to the real surface-visibility check in globe mode; the "degrades
to visible" fallback only applies to a hypothetical transform without the
method (e.g. an older MapLibre build), which this app does not ship.

This section records the design as agreed before implementation. The
reference sections above (Rendering model, Controls, Production migration,
Operational considerations, Exact change map) describe the resulting code as
built; where the two disagree, treat this section as history and the sections
above as current. The one deliberate, disclosed deviation is called out
inline below and in "Globe and Mercator clipping" above.

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

**As implemented (deliberate deviation):** the single `isPointVisible()` named
above was split into `isOccluded(lngLat)` and `isPixelOnGlobe(screenX,
screenY, lngLat)`. The round-trip re-projection test is meaningless for
particles — they are projected *from* longitude/latitude, so re-projecting
would trivially match — so a combined predicate would have cost roughly 1600
redundant `project()` calls per frame at the default particle count for no
benefit. `drawHeatmap()` runs both checks per texel; `drawParticles()` runs
only `isOccluded` per endpoint. Same design, better factored; confirmed by two
independent code reviews. See "Globe and Mercator clipping" above.

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

**Done.** Landed in commit `0855a12`, reviewed clean. See "Root cause:
particle streaks" resolution and the Exact change map above for exact lines.

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

**Done.** Landed in commit `ec77520`, reviewed clean, with the `isOccluded`
/`isPixelOnGlobe` split noted above instead of a single `isPointVisible()`.

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

**As implemented (deliberate deviation, plus two user-approved additions):**
rather than adding a sixth copy-pasted hide-all-others handler, the five
existing near-duplicated handlers were refactored into one `togglePanel(panelId)`
helper plus a `PANEL_IDS` array (now including `#wind-panel`); behaviourally
identical, verified by an independent per-button trace against every original
hardcoded hide-list. Two additions beyond this spec, approved by the user
mid-execution: `#wind-layer-legend` (activates the previously-dead
`createLegend()`) and the `.wind-attribution` Open-Meteo credit line. See
Controls above for both.

Exit criterion: the button toggles the panel, the panel is mutually exclusive
with the other sidebar panels, every control still drives the layer, and no
weather control remains in `#layers-panel`.

**Done.** Landed in commit `e6a3a95`, reviewed clean.

## Task 4 (addendum, not part of the original spec) — vessel click-target fix

While verifying Stage 3, the user reported that clicking near a vessel to
open the wind popup instead reopened the vessel's own popup. Root cause:
`js/fleet.js`'s `createBoatImage()` drew an ~18x50px boat shape onto a
150x150px transparent canvas, and MapLibre hit-tests a symbol against its
full image bounds rather than its opaque pixels — with `icon-size: 0.8` that
gave every vessel roughly a 120x120px click target, easily covering nearby
map clicks meant for the wind layer.

Fixed two ways, landed in commit `80d33db`, reviewed clean:

1. Cropped the icon canvas to 64x64 and shifted the drawing origin from
   `(66,85)` to `(23,42)` (`ORIGIN_X`/`ORIGIN_Y`, `js/fleet.js` lines
   138-139). Verified by independent review to preserve the shape's position
   and rotation-safety at every heading — the shape's point furthest from the
   rotation pivot is about 26px, safely inside the 32px inscribed-circle
   radius of a 64px canvas — while cutting the click target to about 51px.
2. Added a true-pixel-distance fallback in `showPointInfo()`
   (`js/windLayers.js`): `VESSEL_LAYERS = new Set(["ODB","SDG","HES"])` and
   `VESSEL_CLICK_RADIUS_PX = 15`, so only a click within 15px of a vessel's
   actual projected position now blocks the wind popup. All other
   interactive layers (tracks, cruises, stations) keep their original
   unconditional block, unchanged.

This is recorded here rather than folded into the Problem statement above
because it was not part of the agreed design — it is a user-reported bug
found during Stage 3 verification and approved as a fourth task mid-execution.

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

**Done.** All four tasks (Stages 1-3 plus the Task 4 addendum) were verified
against these criteria and reviewed clean before this document was updated.

## Out of scope

Unchanged from the deliberate scope limits above: no wave data, no forecast
time controls, no new global application state. The thermometer and wave icons
supplied alongside the wind icon are noted as possible future layers and are
not part of this work.

Items identified but not addressed during this round are tracked as "Known
limitations" under Deliberate scope limits above, not here — that section
covers gaps found while doing the work, as distinct from features that were
never in scope.
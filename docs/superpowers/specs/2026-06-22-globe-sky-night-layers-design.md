# Globe Sky / Night Layers — Design

**Date:** 2026-06-22
**Scope:** Visual enhancements to the globe's sky/night background in `js/fleet.js`.
**Status:** Approved

## Goal

Improve the globe's atmosphere layers with three focused enhancements:

1. Pause the animation loop when the starfield canvas is hidden.
2. Add a subtle twinkle to the night-mode stars.
3. Add a native atmospheric halo around the globe (day and night palettes).

Out of scope: persisting the day/night mode, tinting the globe tiles, any CSS/HTML changes.

## Architecture

Single file affected: `js/fleet.js`. Logic lives inside `initStarfield()` plus one
module-level helper (`applySky`) and two palette constants.

### Components & interfaces

- **`initStarfield()` → `{ start, stop }`**
  Encapsulates the canvas, stars, clouds, and the render loop. Returns a controller
  so external code can start/stop the loop. Stored in module var `starfieldCtrl`.
- **`applySky(mode)`**
  Sole owner of the globe halo. Calls `MAPA.setSky(SKY_DAY | SKY_NIGHT)`.
- **`SKY_DAY` / `SKY_NIGHT`**
  Module-level constants with `sky-color`, `horizon-color`, `fog-color`,
  `sky-horizon-blend`, `horizon-fog-blend`, `fog-ground-blend`, and an
  `atmosphere-blend` interpolated by zoom (halo fades on zoom-in).

## Feature detail

### 1. Pause RAF when hidden

- Split current `draw()` into `renderFrame()` (draws one frame, no self-reschedule)
  and `loop()` (calls `renderFrame` then `requestAnimationFrame(loop)`).
- Track `rafId`. `start()` begins the loop only if not already running; `stop()`
  cancels and clears `rafId`.
- `#projection` change handler: `globe → starfieldCtrl.start()`,
  `mercator → starfieldCtrl.stop()`.
- Initial state: hidden and stopped (default projection is mercator).

### 2. Twinkle stars

- Each star carries `tw` (speed) and `ph` (phase) — added at generation time.
- Night render: `alpha = s.a * (0.65 + 0.35 * Math.sin(t * s.tw + s.ph))`.
  Soft pulse; stars never fully disappear.
- Hoist `t = performance.now() / 1000` to the top of the frame render (also reused
  by day mode, which already computes it).

### 3. Native atmospheric halo

- MapLibre's modern sky spec is supported by the bundled build (verified:
  `sky-color`, `horizon-color`, `fog-color`, `*-blend`, `atmosphere-blend`).
- `applySky('night')` on map load; the `#globe-theme-toggle` click handler calls
  `applySky(mode)` after flipping the canvas mode.
- In mercator (pitch 0) the sky does not render, so 2D is unaffected.

## Data flow

```
#globe-theme-toggle click
  → mode flips (night/day)
  → canvas dataset + render switches palette
  → applySky(mode) updates MapLibre halo

#projection change
  → globe:    canvas+button visible, starfieldCtrl.start()
  → mercator: canvas+button hidden,  starfieldCtrl.stop()
```

## Error handling

- `applySky` guards on `MAPA.setSky` existing before calling.
- `start`/`stop` are idempotent (guard on `rafId`).

## Testing

No automated test runner (static app). Verification is visual in the browser:

1. Switch projection to **globe** → starfield + theme button appear, loop runs.
2. Toggle **day/night** → sky gradient + native halo switch palettes.
3. Night mode → stars twinkle.
4. Switch back to **mercator** → canvas/button hidden, loop stops (no RAF churn).

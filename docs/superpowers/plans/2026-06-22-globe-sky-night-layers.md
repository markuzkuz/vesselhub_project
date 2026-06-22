# Globe Sky / Night Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RAF pausing, star twinkle, and a native MapLibre atmospheric halo to the globe's sky/night layers.

**Architecture:** All changes live in `js/fleet.js`. `initStarfield()` is refactored to expose a `{ start, stop }` controller so the render loop only runs while the globe canvas is visible. Night stars gain a sine-based twinkle. A module-level `applySky(mode)` helper drives MapLibre's native sky/atmosphere for the halo, switched by the day/night toggle.

**Tech Stack:** Vanilla JS, Canvas 2D, MapLibre GL JS (bundled, modern sky spec), jQuery (existing handlers).

## Global Constraints

- Single file touched: `js/fleet.js`. No CSS/HTML changes.
- No automated test runner — verification is visual in the browser.
- Commits are performed by the user (GitHub Desktop). Each commit point lists a suggested title; do not run `git commit`.
- Code style: no unnecessary comments, DRY, KISS (project `CLAUDE.md`).
- Out of scope: persisting day/night mode, tinting globe tiles.

---

### Task 1: RAF lifecycle controller

**Files:**
- Modify: `js/fleet.js` — `initStarfield()` (`draw()` + INIT block) and the `#projection` change handler.

**Interfaces:**
- Produces: `initStarfield()` returns `{ start, stop }`. Module var `starfieldCtrl` holds it.
- Consumes: `MAPA.on('load')` assigns `starfieldCtrl = initStarfield()`; `#projection` handler calls `starfieldCtrl.start()` / `.stop()`.

- [ ] **Step 1: Rename `draw()` to `renderFrame()` and remove its self-reschedule**

In `initStarfield()`, change the function signature and delete the trailing `requestAnimationFrame(draw)`:

```js
    function renderFrame() {

        ctx.clearRect(0, 0, canvas.width, canvas.height);
```

Delete this line near the end of the function (just before its closing brace):

```js
        requestAnimationFrame(draw);
```

- [ ] **Step 2: Add the loop controller inside `initStarfield()`**

Add directly after `renderFrame()` is defined (before the TOGGLE BUTTON block):

```js
    let rafId = null;

    function loop() {
        renderFrame();
        rafId = requestAnimationFrame(loop);
    }

    function start() {
        if (rafId === null) loop();
    }

    function stop() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }
```

- [ ] **Step 3: Replace the INIT auto-start with a returned controller**

Change the end of `initStarfield()` from:

```js
    resize();
    window.addEventListener('resize', resize);

    canvas.dataset.mode = mode;

    draw();
}
```

to:

```js
    resize();
    window.addEventListener('resize', resize);

    canvas.dataset.mode = mode;

    return { start, stop };
}
```

- [ ] **Step 4: Declare `starfieldCtrl` and capture the controller on load**

Add a module-level declaration near the other module vars (e.g. just after `window.MAPA = MAPA;`):

```js
let starfieldCtrl = null;
```

In `MAPA.on("load", ...)`, change:

```js
    initStarfield();
```

to:

```js
    starfieldCtrl = initStarfield();
```

(The two existing lines that hide `#starfield` and `#globe-theme-toggle` stay as-is; the loop now starts stopped.)

- [ ] **Step 5: Start/stop the loop from the projection handler**

In the `$('#projection').on('change', ...)` handler, update the branches:

```js
    if (isGlobe) {

        starfield.style.display = 'block';
        btn.style.display = 'block';
        starfieldCtrl?.start();

    } else {

        starfield.style.display = 'none';
        btn.style.display = 'none';
        starfieldCtrl?.stop();
    }
```

- [ ] **Step 6: Verify in the browser**

Open `index.html`, open DevTools Performance/console. Expected:
- On load (mercator): no animation frames running for the starfield (canvas hidden, loop stopped).
- Switch projection to **globe**: starfield appears and animates.
- Switch back to **mercator**: starfield hidden and the loop stops (no continuous rAF).

- [ ] **Step 7: Commit point (user)**

Notify the user — suggested title:
`feat(globe): pause starfield render loop when hidden`

---

### Task 2: Star twinkle

**Files:**
- Modify: `js/fleet.js` — star generation (already done) and `renderFrame()` night branch.

**Interfaces:**
- Consumes: each star object has `a` (base alpha), `tw` (speed), `ph` (phase) — added in `resize()`.
- Produces: animated per-star alpha in night mode.

- [ ] **Step 1: Confirm star fields exist**

In `resize()`, each pushed star must include `tw` and `ph` (already added):

```js
            stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 1.3,
                a: 0.2 + Math.random() * 0.8,
                tw: 0.5 + Math.random() * 2,
                ph: Math.random() * Math.PI * 2
            });
```

- [ ] **Step 2: Hoist `t` to the top of `renderFrame()`**

At the start of `renderFrame()`, right after `ctx.clearRect(...)`, add:

```js
        const t = performance.now() / 1000;
```

Then in the DAY branch, delete the now-duplicate local declaration:

```js
            const t = performance.now() / 1000;
```

- [ ] **Step 3: Apply twinkle in the night branch**

Replace the night loop:

```js
        if (mode === "night") {

            for (const s of stars) {
                ctx.fillStyle = `rgba(255,255,255,${s.a})`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }

        }
```

with:

```js
        if (mode === "night") {

            for (const s of stars) {
                const a = s.a * (0.65 + 0.35 * Math.sin(t * s.tw + s.ph));
                ctx.fillStyle = `rgba(255,255,255,${a})`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }

        }
```

- [ ] **Step 4: Verify in the browser**

Globe + night mode: stars pulse softly and asynchronously; none blink fully off. Day mode unchanged.

- [ ] **Step 5: Commit point (user)**

Notify the user — suggested title:
`feat(globe): add subtle twinkle to night stars`

---

### Task 3: Native atmospheric halo

**Files:**
- Modify: `js/fleet.js` — add `SKY_DAY`/`SKY_NIGHT` constants + `applySky()` (module scope), call on load, and from the toggle handler.

**Interfaces:**
- Produces: `applySky(mode)` where `mode` is `"day"` | `"night"`; calls `MAPA.setSky(...)`.
- Consumes: `MAPA.on('load')` calls `applySky('night')`; the `#globe-theme-toggle` click handler calls `applySky(mode)` after flipping `mode`.

- [ ] **Step 1: Add palettes and helper at module scope**

Add near the top-level config (e.g. after the `TRACK_COLORS` block):

```js
const SKY_NIGHT = {
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 4, 0.6, 7, 0],
    'sky-color': '#0b1d3a',
    'horizon-color': '#2a6fd0',
    'fog-color': '#bcd8ff',
    'sky-horizon-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'fog-ground-blend': 0.0
};

const SKY_DAY = {
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.7, 7, 0],
    'sky-color': '#5aa6f0',
    'horizon-color': '#cfeaff',
    'fog-color': '#ffffff',
    'sky-horizon-blend': 0.7,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.0
};

function applySky(mode) {
    if (typeof MAPA.setSky !== 'function') return;
    MAPA.setSky(mode === 'day' ? SKY_DAY : SKY_NIGHT);
}
```

- [ ] **Step 2: Apply the night sky on map load**

In `MAPA.on("load", ...)`, after `LoadLayers(MAPA);`, add:

```js
    applySky('night');
```

- [ ] **Step 3: Switch the halo from the theme toggle**

In `initStarfield()`'s toggle handler, change:

```js
    btn.addEventListener('click', () => {

        mode = (mode === "night") ? "day" : "night";

        canvas.dataset.mode = mode;
    });
```

to:

```js
    btn.addEventListener('click', () => {

        mode = (mode === "night") ? "day" : "night";

        canvas.dataset.mode = mode;
        applySky(mode);
    });
```

- [ ] **Step 4: Verify in the browser**

- Globe + night: a thin blue atmospheric rim hugs the globe; it fades as you zoom in.
- Toggle to day: rim becomes a brighter blue/white halo.
- Switch to mercator (2D, pitch 0): no sky rendered, map looks normal.

- [ ] **Step 5: Commit point (user)**

Notify the user — suggested title:
`feat(globe): add native MapLibre atmospheric halo (day/night)`

---

### Task 4: Spec alignment + code review

**Files:**
- Review only: `js/fleet.js`, against `docs/superpowers/specs/2026-06-22-globe-sky-night-layers-design.md`.

- [ ] **Step 1: Spec coverage pass**

Re-read the spec. Confirm each of the three features is implemented and matches the described interfaces (`{ start, stop }`, `applySky(mode)`, twinkle formula).

- [ ] **Step 2: Request code review**

REQUIRED SUB-SKILL: Use superpowers:requesting-code-review on the working changes in `js/fleet.js`. Address any findings (or justify dismissals via superpowers:receiving-code-review).

- [ ] **Step 3: Final browser verification**

Run the full matrix once: mercator (loop stopped) → globe night (twinkle + halo) → globe day (halo) → back to mercator. No console errors.

- [ ] **Step 4: Commit point (user)**

Notify the user — suggested title (only if review produced fixes):
`refactor(globe): address code review for sky/night layers`

---

## Self-Review

- **Spec coverage:** RAF pause → Task 1; twinkle → Task 2; halo → Task 3; spec/code review → Task 4. All spec sections covered.
- **Placeholder scan:** No TBD/TODO; every code step shows exact code.
- **Type consistency:** Controller `{ start, stop }` defined in Task 1 and consumed in Tasks 1.5/projection handler. `applySky(mode)` defined in Task 3 and consumed on load + toggle. `t`, `s.tw`, `s.ph` consistent between Task 2 generation and render.

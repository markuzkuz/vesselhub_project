# Globe Sky/Night Layers — Iteration v2 Plan

> Execution: subagent-driven, full context per agent, spec+code review after each task, tracked as to-dos.

**Goal:** Make night stars look like Google Earth (magnitude distribution, subtle color tint, soft bloom on the brightest, no twinkle) and remove the distracting bright sun from day mode (keep sky gradient + globe halo + clouds).

**File:** `js/fleet.js` only. No CSS/HTML.

## Global Constraints

- Only `js/fleet.js` changes.
- No new/unnecessary comments; DRY; KISS.
- Keep the MapLibre native halo (`applySky`/`setSky`) untouched — the user likes it.
- Twinkle is being removed: `tw`/`ph` star fields go away; no `Math.sin` twinkle in the night render.
- No test runner — verify by reading code + browser.

---

### Task A: Realistic (Google-Earth-style) stars

**Files:** Modify `js/fleet.js` — star generation in `resize()` and the night branch of `renderFrame()`.

- [ ] **Step 1: Replace star generation in `resize()`**

Replace:

```js
        stars = [];

        for (let i = 0; i < 2200; i++) {
            stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: 0.3 + mag * 1.4,
                a: 0.25 + mag * 0.75,
                rgb: STAR_TINTS[(Math.random() * STAR_TINTS.length) | 0],
                glow: mag > 0.85
            });
        }
```

NOTE: the current code is the OLD block:

```js
        stars = [];

        for (let i = 0; i < 2000; i++) {
            stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 1.3,
                a: 0.2 + Math.random() * 0.8,
                tw: 0.5 + Math.random() * 2,
                ph: Math.random() * Math.PI * 2
            });
        }
```

Replace that OLD block with:

```js
        stars = [];

        const STAR_TINTS = [
            "255,255,255",
            "255,255,255",
            "202,216,255",
            "224,233,255",
            "255,244,224",
            "255,231,210"
        ];

        for (let i = 0; i < 2200; i++) {
            const mag = Math.pow(Math.random(), 3);
            stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: 0.3 + mag * 1.4,
                a: 0.25 + mag * 0.75,
                rgb: STAR_TINTS[(Math.random() * STAR_TINTS.length) | 0],
                glow: mag > 0.85
            });
        }
```

- [ ] **Step 2: Replace the night render branch**

Replace:

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

with:

```js
        if (mode === "night") {

            for (const s of stars) {
                if (s.glow) {
                    const bloom = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
                    bloom.addColorStop(0, `rgba(${s.rgb},${s.a * 0.5})`);
                    bloom.addColorStop(1, `rgba(${s.rgb},0)`);
                    ctx.fillStyle = bloom;
                    ctx.beginPath();
                    ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.fillStyle = `rgba(${s.rgb},${s.a})`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }

        }
```

- [ ] **Step 3: Verify** `grep -n "tw:\|ph:\|Math.sin(t \* s.tw" js/fleet.js` returns nothing; `grep -n "STAR_TINTS\|s.glow\|s.rgb" js/fleet.js` shows the new code. Confirm `t` is still used by the day clouds (so it is not dead).

- [ ] **Step 4: Commit point (user)** — suggested title: `feat(globe): Google-Earth-style stars (magnitude, color, bloom)`

---

### Task B: Remove the bright sun from day mode

**Files:** Modify `js/fleet.js` — the day (`else`) branch of `renderFrame()`.

Keep: the sky linear gradient and the drifting clouds loop. Remove: `sunX`/`sunY`, the additive atmospheric-scattering radial, the sun-glow radial, and the `ctx.save()`/`ctx.restore()` that wrapped them.

- [ ] **Step 1: Replace the day branch body**

The day branch currently starts with `const W = canvas.width;` and contains, in order: sky gradient, `ctx.save()` + scattering, sun glow, `ctx.restore()`, clouds. Replace everything from `const sunX = W * 0.72;` through `ctx.restore();` (inclusive) so the branch becomes exactly:

```js
        else {

            const W = canvas.width;
            const H = canvas.height;

            const sky = ctx.createLinearGradient(0, 0, 0, H);
            sky.addColorStop(0.00, "#1f6fd6");
            sky.addColorStop(0.35, "#3f8fe4");
            sky.addColorStop(0.65, "#7cbdf2");
            sky.addColorStop(0.85, "#bce0f8");
            sky.addColorStop(1.00, "#e8f4ff");
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);

            const span = W + 400;
            for (const c of clouds) {
                let cx = (c.x + t * c.speed) % span;
                if (cx < -200) cx += span;
                cx -= 200;
                drawCloud(cx, c.y, c.scale, c.opacity);
            }
        }
```

- [ ] **Step 2: Verify** `grep -n "sunX\|sunY\|scatter\|globalCompositeOperation\|sun glow" js/fleet.js` returns nothing in the day branch; sky gradient + clouds remain; `ctx.save`/`ctx.restore` no longer appear in the day branch.

- [ ] **Step 3: Commit point (user)** — suggested title: `feat(globe): remove distracting sun glow from day mode`

---

## Self-Review

- Stars realism → Task A; sun removal → Task B. Both decisions from the user's brainstorm are covered.
- Twinkle fully removed (no `tw`/`ph`/`Math.sin`). `t` remains used by day clouds, so not dead.
- `applySky` / `setSky` halo untouched.

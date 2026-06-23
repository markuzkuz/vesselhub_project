# Starfield Render Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir el render del `#starfield` en `js/fleet.js` con la estrategia "bake once, blit per frame" para reducir el coste por frame ~10-20× sin pérdida de calidad visual.

**Architecture:** Separar lo estático (estrellas de fondo, gradiente de cielo, formas de nube → horneadas a canvas offscreen, regeneradas solo en resize) de lo animado (≈100 estrellas "twinkler" en noche; desplazamiento de sprites de nube en día). El bucle rAF se capa a 30 FPS y se mantiene el ciclo de vida `start()`/`stop()` actual ligado a la proyección.

**Tech Stack:** Vanilla JS (módulo ES), Canvas 2D, requestAnimationFrame. Sin bundler, sin test runner.

## Global Constraints

- **Solo se modifica `js/fleet.js`** (función `initStarfield()`, ~544-708). Ningún otro archivo.
- **Sin test runner** → verificación = instrumentación de draw-calls en consola + paridad visual en navegador (`index.html` → globe → toggle día/noche).
- **NO git commit por el agente** (regla global #8): cada checkpoint prepara mensaje; el usuario commitea con GitHub Desktop.
- **Contrato intacto:** `initStarfield()` debe seguir devolviendo `{ start, stop }` (consumido en `MAPA.on("load")` y en el handler de `#projection`).
- **COMPLETED = inmutable:** no cambiar la mecánica del switch día/noche (`#globe-theme-toggle`) ni el halo nativo (`applySky`). Solo cambia el render interno del canvas.
- **dpr = 1** se mantiene (backing store = `innerWidth/Height`); no añadir escalado retina.
- **Estilo:** comentarios en inglés como el bloque actual; conservar naming existente (`stars`, `clouds`, `puff`, `drawCloud`, `mode`, `rafId`, `start`, `stop`).
- **Constantes nuevas:** `STARFIELD_FPS = 30`, `TWINKLER_COUNT = 100`.

---

### Task 1: Instrumentación de medición + baseline

Añade un contador temporal de draw-calls/frame para fijar la línea base y poder verificar la reducción en tareas siguientes. Esta instrumentación se elimina en la Task 6.

**Files:**
- Modify: `js/fleet.js` (dentro de `initStarfield()`, alrededor de `renderFrame` ~622-668)

**Interfaces:**
- Produces: objeto global temporal `window.__sfStats = { arcs, drawImages, gradients, frames }` y un log por segundo en consola.

- [ ] **Step 1: Guard de degradación**

Al inicio de `initStarfield()`, sustituye `const canvas = document.getElementById('starfield');` / `const ctx = canvas.getContext('2d');` (~546-547) por:

```js
const canvas = document.getElementById('starfield');
const ctx = canvas && canvas.getContext('2d');
if (!ctx) return { start() {}, stop() {} };
```

(Degrada a controlador inerte sin romper `fleet.js` si el canvas no existe; respeta el contrato `{ start, stop }`.)

- [ ] **Step 2: Añadir el contador y el wrapper de medición**

Justo después de `const ctx = canvas.getContext('2d');` (~547), añade:

```js
// TEMP measurement (remove in cleanup task) — counts per-frame draw work
const __sfStats = { arcs: 0, drawImages: 0, gradients: 0, frames: 0 };
window.__sfStats = __sfStats;
{
    const _arc = ctx.arc.bind(ctx);
    const _di = ctx.drawImage.bind(ctx);
    const _lg = ctx.createLinearGradient.bind(ctx);
    const _rg = ctx.createRadialGradient.bind(ctx);
    ctx.arc = (...a) => { __sfStats.arcs++; return _arc(...a); };
    ctx.drawImage = (...a) => { __sfStats.drawImages++; return _di(...a); };
    ctx.createLinearGradient = (...a) => { __sfStats.gradients++; return _lg(...a); };
    ctx.createRadialGradient = (...a) => { __sfStats.gradients++; return _rg(...a); };
}
let __sfLast = performance.now();
```

- [ ] **Step 3: Contar frames y loguear por segundo**

Al final de `renderFrame()` (antes de su `}` de cierre, ~667), añade:

```js
__sfStats.frames++;
const __now = performance.now();
if (__now - __sfLast >= 1000) {
    console.log(`[starfield] fps=${__sfStats.frames} arcs/frame=${(__sfStats.arcs / __sfStats.frames).toFixed(0)} drawImages/frame=${(__sfStats.drawImages / __sfStats.frames).toFixed(1)} gradients/frame=${(__sfStats.gradients / __sfStats.frames).toFixed(1)}`);
    __sfStats.arcs = __sfStats.drawImages = __sfStats.gradients = __sfStats.frames = 0;
    __sfLast = __now;
}
```

- [ ] **Step 4: Medir baseline en navegador**

Abre `index.html`, cambia a proyección **globe** (`#projection`). En consola lee 2-3 líneas en **modo noche** y 2-3 en **modo día** (toggle `#globe-theme-toggle`).
Expected (baseline actual): noche `arcs/frame≈2000`, día `gradients/frame≈30-60`, `fps≈60` (o más en pantallas 120/144Hz).
Anota estos números (son el "antes" para los criterios de éxito).

**Captura visual OBLIGATORIA del baseline** (no opcional): screenshot del fondo en modo noche y en modo día ANTES de tocar nada. Es la única evidencia con la que probar la paridad visual al final (CLAUDE.md: evidencia > afirmación). Sin esta captura, la paridad solo se podría afirmar, no demostrar.

- [ ] **Step 5: Checkpoint (usuario commitea)**

Mensaje sugerido: `chore(starfield): add temporary draw-call instrumentation for baseline`

---

### Task 2: Cap de FPS a 30 + coordenadas enteras

Reduce el trabajo dividiendo los FPS efectivos y elimina anti-aliasing por subpíxel. Cambio aislado, sin bake todavía.

**Files:**
- Modify: `js/fleet.js` (`loop`/`start`/`stop` ~670-686; `renderFrame` ~622-668)

**Interfaces:**
- Consumes: `STARFIELD_FPS` (constante).
- Produces: `loop(now)` con gate de FPS; `renderFrame(now)` recibe el timestamp.

- [ ] **Step 1: Definir la constante**

Al inicio de `initStarfield()` (tras las declaraciones `let mode/stars/clouds`, ~553) añade:

```js
const STARFIELD_FPS = 30;
const frameInterval = 1000 / STARFIELD_FPS;
```

- [ ] **Step 2: `renderFrame` recibe `now`**

Cambia la firma `function renderFrame() {` por `function renderFrame(now) {` y sustituye la línea `const t = performance.now() / 1000;` (~626) por:

```js
const t = now / 1000;
```

- [ ] **Step 3: Gate de FPS en `loop`**

Sustituye el bloque `loop`/`start`/`stop` (~670-686) por:

```js
let rafId = null;
let last = 0;

function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (now - last < frameInterval) return;
    last = now - ((now - last) % frameInterval);
    renderFrame(now);
}

function start() {
    if (rafId === null) {
        last = 0;
        rafId = requestAnimationFrame(loop);
    }
}

function stop() {
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}
```

- [ ] **Step 4: Coordenadas enteras en las estrellas (noche)**

En el loop de estrellas dentro de `renderFrame` (~636-638), redondea x/y:

```js
ctx.arc(Math.floor(s.x), Math.floor(s.y), s.r, 0, Math.PI * 2);
```

- [ ] **Step 5: Verificar en navegador**

Abre `index.html` → globe. En consola: `fps` debe leer **≈30** (no 60/120/144). Visual: el cielo noche/día se ve igual. Sin errores.

- [ ] **Step 6: Checkpoint (usuario commitea)**

Mensaje sugerido: `perf(starfield): cap render loop to 30fps and floor star coordinates`

---

### Task 3: Hornear estrellas estáticas + animar solo twinklers (noche)

Separa ~100 estrellas brillantes (twinklers) que se animan por frame; las ~1900 restantes se hornean una vez a un buffer offscreen.

**Files:**
- Modify: `js/fleet.js` (estado ~552-553; `resize` ~558-591; `renderFrame` noche ~631-639)

**Interfaces:**
- Consumes: `TWINKLER_COUNT`.
- Produces: variables `nightBase` (HTMLCanvasElement), `staticStars`, `twinklers` (arrays); funciones `createBuffer(w,h)`, `generateStars(w,h)`, `bakeNightBase(w,h)`.

- [ ] **Step 1: Constante y estado**

Junto a `STARFIELD_FPS` añade `const TWINKLER_COUNT = 100;`.
Sustituye `let stars = [];` (~552) por:

```js
let stars = [];
let staticStars = [];
let twinklers = [];
let nightBase = null;
```

- [ ] **Step 2: Helper de buffer offscreen**

Antes de `function resize()` (~557) añade:

```js
function createBuffer(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
}
```

- [ ] **Step 3: Extraer generación de estrellas y selección de twinklers**

Añade tras `createBuffer`:

```js
function generateStars(w, h) {
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
    // twinklers = estrellas más prominentes (tamaño × brillo) → reproduce el twinkle
    // dominante actual (hoy se modula por `a`). Confirmar paridad visual en Step 7.
    twinklers = [...stars].sort((a, b) => (b.r * b.a) - (a.r * a.a)).slice(0, TWINKLER_COUNT);
    const twSet = new Set(twinklers);
    staticStars = stars.filter(s => !twSet.has(s));
}
```

- [ ] **Step 4: Hornear el buffer de estrellas estáticas**

Añade tras `generateStars`:

```js
function bakeNightBase(w, h) {
    const buf = createBuffer(w, h);
    const c = buf.getContext('2d');
    for (const s of staticStars) {
        c.fillStyle = `rgba(255,255,255,${s.a})`;
        c.beginPath();
        c.arc(Math.floor(s.x), Math.floor(s.y), s.r, 0, Math.PI * 2);
        c.fill();
    }
    return buf;
}
```

- [ ] **Step 5: Conectar generación + bake en `resize`**

Dentro de `resize()`, sustituye el bloque actual de generación de estrellas (`stars = []; for (let i = 0; i < 2000; i++) {...}`, ~566-577) por:

```js
generateStars(w, h);
nightBase = bakeNightBase(w, h);
```

(El bloque de `clouds` se mantiene por ahora; se refactoriza en Task 4.)

- [ ] **Step 6: `renderFrame` noche = blit + twinklers**

Sustituye el bloque `if (mode === "night") {...}` (~631-641) por:

```js
if (mode === "night") {

    ctx.drawImage(nightBase, 0, 0);

    for (const s of twinklers) {
        const a = s.a * (0.65 + 0.35 * Math.sin(t * s.tw + s.ph));
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath();
        ctx.arc(Math.floor(s.x), Math.floor(s.y), s.r, 0, Math.PI * 2);
        ctx.fill();
    }

}
```

- [ ] **Step 7: Verificar en navegador**

Abre `index.html` → globe → modo noche. Consola: `arcs/frame` debe leer **≈100** (los twinklers; `drawImages/frame≈1`), frente a ~2000 baseline. Visual: campo de estrellas idéntico, con twinkle visible en las brillantes. Sin errores.

- [ ] **Step 8: Checkpoint (usuario commitea)**

Mensaje sugerido: `perf(starfield): bake static stars to offscreen buffer, animate only twinklers`

---

### Task 4: Hornear cielo + sprites de nube (día)

Elimina la recreación del gradiente y los ~30-60 radial-gradients por frame: cielo horneado a buffer, cada nube pre-renderizada a un sprite que se blitea desplazado.

**Files:**
- Modify: `js/fleet.js` (estado ~553; `puff`/`drawCloud` ~596-617; `resize` clouds ~579-590; `renderFrame` día ~646-667)

**Interfaces:**
- Consumes: `createBuffer` (Task 3).
- Produces: variables `skyBase` (canvas), `cloudSprites` (array de `{ buf, halfW, halfH }`); funciones `bakeSky(w,h)`, `generateClouds(w,h)`, `bakeCloud(cloud)`; `puff`/`drawCloud` ahora reciben un contexto como primer argumento.

- [ ] **Step 1: Estado nuevo**

Junto a `let nightBase = null;` añade:

```js
let clouds = [];
let cloudSprites = [];
let skyBase = null;
```

**Importante:** `let clouds = [];` YA existe en `fleet.js:553`. Una redeclaración `let` en el mismo scope es un **SyntaxError que rompe todo el módulo** (y `fleet.js` es el entry point). Mueve `clouds` a este bloque de estado y asegúrate de que aparece **exactamente una vez** (borra la declaración antigua de la línea 553).

- [ ] **Step 2: `puff` y `drawCloud` reciben el contexto destino**

Sustituye `puff` (~596-605) y `drawCloud` (~607-617) por:

```js
function puff(c, cx, cy, r, op, rgb) {
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb},${op})`);
    g.addColorStop(0.55, `rgba(${rgb},${op * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
}

function drawCloud(c, cx, cy, scale, opacity) {
    const b = 55 * scale;
    puff(c, cx, cy + b * 0.25, b * 1.7, opacity * 0.35, "200,214,228");
    puff(c, cx - b * 1.0, cy, b * 0.95, opacity, "255,255,255");
    puff(c, cx + b * 1.0, cy, b * 1.00, opacity, "255,255,255");
    puff(c, cx, cy - b * 0.55, b * 1.15, opacity, "255,255,255");
    puff(c, cx - b * 0.45, cy - b * 0.15, b * 0.90, opacity, "255,255,255");
    puff(c, cx + b * 0.55, cy - b * 0.10, b * 0.95, opacity, "255,255,255");
}
```

- [ ] **Step 3: Hornear el cielo**

Tras `bakeNightBase` añade:

```js
function bakeSky(w, h) {
    const buf = createBuffer(w, h);
    const c = buf.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0.00, "#1f6fd6");
    sky.addColorStop(0.35, "#3f8fe4");
    sky.addColorStop(0.65, "#7cbdf2");
    sky.addColorStop(0.85, "#bce0f8");
    sky.addColorStop(1.00, "#e8f4ff");
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    return buf;
}
```

- [ ] **Step 4: Extraer generación de nubes**

Añade:

```js
function generateClouds(w, h) {
    clouds = [];
    const cloudCount = Math.max(5, Math.round(w / 320));
    for (let i = 0; i < cloudCount; i++) {
        clouds.push({
            x: Math.random() * w,
            y: h * (0.08 + Math.random() * 0.45),
            scale: 0.5 + Math.random() * 1.3,
            speed: 4 + Math.random() * 12,
            opacity: 0.18 + Math.random() * 0.30
        });
    }
}
```

- [ ] **Step 5: Hornear cada nube a un sprite**

Añade:

```js
function bakeCloud(cloud) {
    const b = 55 * cloud.scale;
    // worst-case puff reach: underbelly r=1.7b centered at +0.25b → 1.95b down / 1.7b sideways.
    // margins below add headroom so the radial gradient soft edge never clips.
    const halfW = b * 2.4;
    const halfH = b * 2.2;
    const buf = createBuffer(Math.ceil(halfW * 2), Math.ceil(halfH * 2));
    const c = buf.getContext('2d');
    drawCloud(c, halfW, halfH, cloud.scale, cloud.opacity);
    return { buf, halfW, halfH };
}
```

- [ ] **Step 6: Conectar en `resize`**

Sustituye el bloque actual de generación de nubes en `resize()` (`clouds = []; const cloudCount = ...; for (...) {...}`, ~579-590) por:

```js
generateClouds(w, h);
skyBase = bakeSky(w, h);
cloudSprites = clouds.map(bakeCloud);
```

- [ ] **Step 7: `renderFrame` día = blit cielo + blit sprites**

Sustituye el bloque `else {...}` de día (~646-667) por:

```js
else {

    ctx.drawImage(skyBase, 0, 0);

    const span = canvas.width + 400;
    for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        const sprite = cloudSprites[i];
        let cx = (c.x + t * c.speed) % span;
        if (cx < -200) cx += span;
        cx -= 200;
        ctx.drawImage(sprite.buf, Math.floor(cx - sprite.halfW), Math.floor(c.y - sprite.halfH));
    }
}
```

- [ ] **Step 8: Verificar en navegador**

Abre `index.html` → globe → modo día. Consola: `gradients/frame` debe leer **0** y `drawImages/frame` ≈ número de nubes + 1 (cielo), p.ej. **< 15**, frente a ~30-60 baseline. Visual: cielo y nubes a la deriva idénticos. Sin errores.

- [ ] **Step 9: Checkpoint (usuario commitea)**

Mensaje sugerido: `perf(starfield): bake sky gradient and pre-render cloud sprites`

---

### Task 5: Resize debounced + re-bake + repintado inmediato al cambiar modo

Evita regenerar/hornear en cada evento de resize y garantiza que el buffer estático se muestre aunque el bucle esté parado (mercator) al cambiar de modo o redimensionar.

**Files:**
- Modify: `js/fleet.js` (`resize`/init ~702-703; toggle button ~691-697)

**Interfaces:**
- Consumes: `resize`, `renderFrame`, `start`/`stop` existentes.
- Produces: `onResize` (handler debounced), `repaint()`.

- [ ] **Step 1: Helper de repintado puntual**

Tras la definición de `loop`/`start`/`stop`, añade:

```js
function repaint() {
    renderFrame(performance.now());
}
```

- [ ] **Step 2: Repintar al final de `resize`**

Al final de `resize()` (tras el bake de nubes), añade `repaint();` para que, si el bucle está parado (mercator), el nuevo tamaño se vea de inmediato cuando vuelva a verse el canvas.

- [ ] **Step 3: Resize con debounce**

Sustituye `window.addEventListener('resize', resize);` (~703) por:

```js
let resizeTimer = null;
function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
}
window.addEventListener('resize', onResize);
```

- [ ] **Step 4: Repintado inmediato al togglear día/noche**

En el handler del botón (~691-697), tras `applySky(mode);` añade:

```js
repaint();
```

(Así el cambio de modo se ve al instante aunque el loop esté parado en mercator.)

- [ ] **Step 5: Verificar en navegador**

1. Globe → redimensiona la ventana rápido varias veces: no debe haber jank ni regeneración por evento (el log de fps no se dispara durante el arrastre; el re-bake ocurre ~150ms tras parar).
2. Cambia a **mercator**: el log de fps debe parar (bucle detenido, `rafId === null`).
3. En mercator, togglea día/noche y vuelve a globe: el modo correcto se muestra sin frame en blanco.
Sin errores en consola.

- [ ] **Step 6: Checkpoint (usuario commitea)**

Mensaje sugerido: `perf(starfield): debounce resize, re-bake buffers, repaint on mode/resize`

---

### Task 6: Quitar instrumentación + verificación final

Elimina el código temporal de medición tras capturar los números finales y confirma criterios de éxito.

**Files:**
- Modify: `js/fleet.js` (quitar lo añadido en Task 1)

**Interfaces:**
- Consumes: nada.
- Produces: `initStarfield()` final, sin `__sfStats`.

- [ ] **Step 1: Capturar números finales (antes de borrar)**

Abre `index.html` → globe. Anota de consola los valores finales noche y día (para el registro de éxito):
Expected: noche `arcs/frame ≈ 100` (< 150), día `gradients/frame = 0` y `drawImages/frame < 15`, `fps ≈ 30` en ambos.

- [ ] **Step 2: Eliminar la instrumentación**

Borra el bloque `__sfStats`/wrappers añadido en Task 1 Step 2 (tras `getContext`) y el bloque de conteo/log añadido en Task 1 Step 3 (final de `renderFrame`). `renderFrame` queda solo con su lógica de render.

- [ ] **Step 3: Verificación final completa**

Abre `index.html`:
1. Globe + noche: estrellas con twinkle, sin errores, sin jank.
2. Globe + día: cielo + nubes a la deriva, sin errores.
3. Mercator: bucle parado.
4. Resize: sin jank, re-bake correcto.
5. Consola limpia (sin `[starfield]` logs, sin `__sfStats`).
Captura antes/después si es posible para confirmar paridad visual.

- [ ] **Step 4: Checkpoint final (usuario commitea)**

Mensaje sugerido: `perf(starfield): remove measurement instrumentation`

---

## Notas de cierre

- Tras la última task: actualizar `.claude/NEXT_SESSION.md` y proponer al usuario el commit (regla #8).
- Mejora futura fuera de este plan (Enfoque 2): mover el render a OffscreenCanvas + Web Worker si se quiere descargar aún más el hilo principal.

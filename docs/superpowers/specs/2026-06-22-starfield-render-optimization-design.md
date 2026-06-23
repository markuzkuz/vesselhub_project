# Starfield/Canvas Render Optimization — Design

**Fecha:** 2026-06-22
**Bloque:** A (starfield/canvas) — único alcance de este spec
**Archivo afectado:** `js/fleet.js` (función `initStarfield()`, líneas ~544-708)
**Premisa del usuario:** conservar el mejor efecto visual posible (estrellas con twinkle + cielo + nubes), pero reimplementarlo con la mejor relación calidad/coste para no sobrecargar la app.

---

## Problema (evidencia de auditoría)

El render del `#starfield` mantiene el render-loop caliente de forma innecesaria. MapLibre es event-driven (cae a `idle` ~0% CPU cuando nada cambia); el coste continuo de la app viene del starfield, no del mapa.

- **Noche:** `renderFrame()` redibuja **2000 `arc()`** con twinkle cada frame a ~60fps (`fleet.js:633-639`).
- **Día:** recrea el **gradiente lineal de cielo cada frame** (`fleet.js:651-658`) y dibuja cada nube como **6 `puff()`**, cada uno con un `createRadialGradient` + `arc` (`fleet.js:596-617`) → ~30-60 gradientes/frame.
- **Sin cap de FPS:** `loop()` re-encola rAF incondicionalmente (`fleet.js:672-675`); en pantallas 120/144Hz se pinta 2-4× de más.
- **Resize sin debounce:** `resize()` regenera 2000 estrellas + nubes en cada evento (`fleet.js:558-591,703`).

Confirmado del código real: el canvas ya usa `dpr=1` (backing store = `innerWidth/Height`), por lo que **no** se añade escalado de devicePixelRatio (ya es óptimo para un fondo).

## Objetivo

Reducir el coste por frame ~10-20× **sin pérdida de calidad visual perceptible**, manteniendo el efecto día/noche actual y el ciclo de vida del bucle (pausa en mercator).

## Fuera de alcance

Bloques B-F (polling, listeners de mapa, grid, carga inicial, CSV). No se toca `applySky`/halo nativo de MapLibre, ni el switch `#globe-theme-toggle`/`#projection` salvo su lógica interna de repintado/re-bake. No se introduce OffscreenCanvas/Worker (queda como posible mejora futura, Enfoque 2).

---

## Arquitectura: "bake once, blit per frame"

Separar lo **estático** (horneado una vez a canvas offscreen, regenerado solo en resize) de lo **animado** (único recálculo por frame).

```
initStarfield()
├── buffers offscreen (regenerados en resize debounced, NUNCA por frame)
│   ├── nightBase     → 2000 estrellas + glow horneado (canvas detached)
│   ├── skyBase       → gradiente de cielo del día, horneado a fill
│   └── cloudSprites[] → cada nube pre-renderizada a su propio sprite a su escala
├── estado animado
│   └── twinklers[]   → subconjunto (~100) de estrellas brillantes que parpadean
└── renderFrame(dt)
    ├── noche: drawImage(nightBase) + ~100 arc() con alpha modulado (solo twinklers)
    └── día:   drawImage(skyBase)   + drawImage(cloudSprite) por nube a su x desplazada
```

### Componentes

1. **`bakeNightBase(w, h)`** → devuelve un canvas offscreen (`document.createElement('canvas')`) con las estrellas **estáticas** (≈1900 = 2000 menos los twinklers) dibujadas una vez, con su glow horneado (radial gradient pequeño por estrella, o `arc` con alpha). Se invoca en resize.
2. **`twinklers`** → al hornear, se separan ~100 estrellas (las de mayor `r`/`a`) que NO se dibujan en `nightBase`; se guardan en un array y se redibujan por frame con `a` modulado por `sin`. El resto queda fijo en el buffer.
3. **`bakeSky(w, h)`** → hornea el gradiente lineal de cielo a un canvas offscreen (o cachea el objeto gradiente). Reusado por frame.
4. **`bakeClouds(clouds)`** → cada nube (sus 6 puffs) se pre-renderiza una vez a un sprite offscreen dimensionado a su `scale`. Por frame solo se hace `drawImage(sprite, driftX, y)`.
5. **`renderFrame(dt)`** → `clearRect` + blit del base correspondiente + animar solo lo móvil (twinklers o nubes). Coordenadas con `Math.floor`.

### Control del bucle

- **FPS cap:** constante `STARFIELD_FPS = 30`. `loop(now)` acumula delta; ejecuta `renderFrame` solo si `now - last >= 1000/STARFIELD_FPS`, ajustando `last` para no acumular drift. Sigue usando rAF (no `setInterval`).
- **Coordenadas enteras:** `Math.floor` en blits/posiciones animadas para evitar anti-aliasing por subpíxel.
- **Ciclo de vida:** se mantiene `start()`/`stop()` actual ligado a `#projection` (globe→start, mercator→stop, `rafId=null` cuando parado). rAF ya se pausa en pestaña de fondo → no se añade Page Visibility API (YAGNI).
- **Resize con debounce (~150ms):** al disparar, regenera geometría y **re-hornea** los tres buffers (night/sky/clouds). No se rehornea por frame.
- **Cambio de modo (día/noche):** al togglear, repinta inmediatamente con el buffer correspondiente (no espera al siguiente tick si el loop está parado en mercator → repintado puntual).

---

## Datos / flujo

- `resize()` (debounced) → regenera arrays `stars`/`clouds` → `bakeNightBase`, `bakeSky`, `bakeClouds` → guarda buffers y `twinklers`.
- `loop(now)` → gate de FPS → `renderFrame(dt)`.
- `renderFrame` lee `mode` y blitea el buffer + anima el subconjunto. No crea gradientes ni recorre 2000 estrellas.

## Manejo de errores / degradación

- Si `getContext('2d')` o el canvas no existen, `initStarfield()` degrada a no-op (return controlador inerte) sin romper el resto de `fleet.js`.
- Buffers offscreen son canvas detached estándar (no OffscreenCanvas API) → máxima compatibilidad, sin feature-detection.

## Verificación (app estática · sin test runner → evidencia visual + medición)

1. **Paridad visual:** captura antes/después en noche (twinkle) y día (cielo + nubes a la deriva); deben verse igual o mejor.
2. **Medición de coste/frame** (instrumentación temporal o DevTools Performance):
   - Noche: draw-calls/frame **< 150** (desde ~2000).
   - Día: **< 15** `drawImage`/frame (desde ~30-60 gradientes).
   - FPS efectivo capado a **~30** (no 60/120/144).
3. **Ciclo de vida:** en mercator el bucle está parado (`rafId === null`); en globe corre.
4. **Sin errores** en consola del navegador; resize no congela ni regenera por frame.

## Criterios de éxito

- Coste por frame reducido ≥10× (noche y día) verificado por medición.
- Sin regresión visual perceptible del efecto día/noche.
- Bucle pausado en mercator; FPS capado en globe.
- Cero errores nuevos en consola.

---

## Notas de implementación (para el plan)

- Stack: vanilla JS, módulo ES (`fleet.js` es `type="module"`). Sin bundler. Seguir estilo del archivo (comentarios en inglés como el bloque actual, naming existente).
- Reutilizar las funciones `puff`/`drawCloud` existentes redirigiéndolas a pintar sobre el contexto del sprite offscreen en vez del contexto principal.
- Mantener los nombres de globals y el contrato `return { start, stop }` intacto (consumido en `MAPA.on("load")` y en el handler de `#projection`).
- COMPLETED = inmutable: el comportamiento día/noche y el halo nativo (`applySky`) no cambian de mecánica.

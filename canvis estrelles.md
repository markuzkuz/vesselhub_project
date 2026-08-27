# Fitxers i línies requerits per a renderitzar el NIGHT SKYMAP

## 1. index.html — DOM Structure
- **Línies 95-97**: Canvas element per al starfield
  ```html
  <canvas id="starfield"></canvas>
  ```
- **Línies 138-145**: Projection select (3 options: Mercator, Globe Night Sky, Globe White)
  ```html
  <select id="projection">
    <option value="mercator">Mercator</option>
    <option value="globe-night">Globe (Night Sky)</option>
    <option value="globe-day">Globe (White)</option>
  </select>
  ```

## 2. css/style.css — Styling & Positioning
- **Línies 917-950**: Full-screen canvas styling
  - `#map-container` (línies 917-922): fixed position, z-index base
  - `#starfield` (línies 924-938): z-index 0 (behind map), pointer-events none, display none by default
  - `#map` (línies 940-943): z-index 1 (above starfield)

## 3. js/fleet.js — Core Skymap Logic

### 3.1 Configuration & Initialization
- **Línies 31-39**: `SKY_NIGHT` object definition
  - Sky colors, atmosphere blend, horizon blend, fog blend
  
- **Línies 40-46**: `SKY_DAY` object definition
  - Sky colors for day mode
  
- **Línies 50-53**: `applySky(mode)` function
  - Sets MapLibre sky based on mode ('day' | 'night')
  - Calls `MAPA.setSky()` with appropriate config

- **Línia 87**: Global `starfieldCtrl` declaration
  - Stores reference to starfield controller

### 3.2 MAPA Initialization (on load)
- **Línia 340**: `MAPA.on("load", () => { ... })`
  - **Línia 344**: `applySky('night')` — applies night sky to MapLibre on load
  - **Línia 351**: `starfieldCtrl = initStarfield()` — initializes canvas starfield
  - **Línia 353**: `document.getElementById('starfield').style.display = 'none'` — starfield hidden by default (until globe selected)

### 3.3 Projection Listener (Globe Night ↔ Globe Day ↔ Mercator)
- **Línies 368-397**: `$('#projection').on('change', ...)`
  - **Línia 370**: Extracts projection value from select (`mercator`, `globe-night`, `globe-day`)
  - **Línia 373**: Extracts base projection type using `.split('-')[0]`
    - `'globe-night'` → `'globe'`
    - `'globe-day'` → `'globe'`
    - `'mercator'` → `'mercator'`
  - **Línia 375**: Determines if globe mode (`projType === 'globe'`)
  - **Línia 376**: Checks if night mode specifically (`projectionValue === 'globe-night'`)
  - **Línia 380**: Sets MapLibre projection using base type
  - **Línies 385-397**:
    - If globe: shows starfield, starts animation, applies sky & mode based on selection
    - If mercator: hides starfield, stops animation

### 3.4 initStarfield() Function (línies 536-789)
**Complete starfield rendering engine with automatic mode control**

#### Star Generation (lines 569-579)
- `generateStars(w, h)`: Creates 2000 star objects with:
  - Position (x, y)
  - Radius (r) — visual size
  - Alpha (a) — opacity
  - Twinkle frequency (tw) + phase (ph)
  - Separates into static stars and twinklers (brightest 100)

#### Night Base Rendering (lines 581-592)
- `bakeNightBase(w, h)`: Pre-bakes static stars to a canvas buffer
  - Draws circles at each star position with opacity
  - Returns buffer canvas (reused every frame for performance)

#### Sky Day Rendering (lines 619-625)
- `bakeSky(w, h)`: Creates white background for day mode
  - Pure white fill: `#ffffff`
  - No blue gradient, no clouds (earth glare visible from MapLibre globe)

#### Cloud Generation & Rendering (lines 627-648)
- `generateClouds(w, h)`: Creates cloud objects (deprecated - not used in day mode)
- `bakeCloud(cloud)`: Pre-renders cloud sprite (deprecated - not used in day mode)
- `drawCloud()`: Draws cloud puffs (deprecated - not used in day mode)
- **Note**: Clouds were removed from day mode render; day mode now shows white background only

#### Render Frame (lines 712-739)
- **NIGHT MODE** (lines 721-729):
  - Draws pre-baked nightBase canvas
  - Loops twinkler stars with animated alpha: `a × (0.65 + 0.35 × sin(t × tw + ph))`
- **DAY MODE** (lines 735-739):
  - Draws pre-baked skyBase canvas (white background only)
  - No clouds rendered (MapLibre globe handles earth glare effect)

#### Loop & Control (lines 748-768)
- `loop(now)`: requestAnimationFrame loop (30 FPS cap)
- `start()`: Starts animation
- `stop()`: Halts animation
- `repaint()`: Single render call (used for immediate mode changes)

#### Initialization (lines 771-789)
- `resize()`: Sets canvas size, generates stars, bakes nightBase, generates clouds, bakes skyBase
- Window resize listener: Re-bakes on window resize (debounced 150ms)
- **Línies 787-789**: Return object with `{ start, stop, setMode }` — `setMode` allows projection listener to set mode automatically

---

## Summary: Night Skymap Dependency Chain

1. **index.html**: 
   - Canvas element for starfield rendering
   - Projection select with 3 options (Mercator, Globe Night, Globe White)

2. **css/style.css**: 
   - Canvas positioning (z-index 0 behind map, full-screen)

3. **js/fleet.js**:
   - `SKY_NIGHT` & `SKY_DAY` configs → `applySky()` → MapLibre sky layer
   - `initStarfield()` → returns { start, stop, setMode } API
   - Projection listener:
     - Detects selection → extracts mode (`globe-night` or `globe-day`)
     - Shows/hides starfield based on globe vs mercator
     - Calls `starfieldCtrl.setMode(mode)` to auto-set sky (NO manual toggle button)
   - Mode is determined by projection selection, not user toggle

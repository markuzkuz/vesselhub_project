import { test } from "node:test";
import assert from "node:assert/strict";
import { globeRadiusPx, heatmapGridWidthForGlobe, edgeBlurPx, recordApiUsage, isPitchKeyboardShortcut } from "./windLayers.js";

test("globeRadiusPx converts worldSize to the standard Mercator-equivalent radius", () => {
    assert.equal(globeRadiusPx(2 * Math.PI), 1);
    assert.equal(globeRadiusPx(512), 512 / (2 * Math.PI));
});

test("heatmapGridWidthForGlobe matches the historical fixed width (140) when the globe fills the viewport", () => {
    const rectWidth = 1400;
    const globeRadius = rectWidth / 2; // globe diameter == viewport width
    assert.equal(heatmapGridWidthForGlobe(globeRadius, rectWidth), 140);
});

test("heatmapGridWidthForGlobe increases resolution as the globe shrinks (zoomed out)", () => {
    const rectWidth = 1400;
    const wideOpenGrid = heatmapGridWidthForGlobe(rectWidth / 2, rectWidth); // globe fills viewport
    const zoomedOutGrid = heatmapGridWidthForGlobe(rectWidth / 8, rectWidth); // globe is 1/4 the diameter
    assert.ok(zoomedOutGrid > wideOpenGrid,
        `expected zoomed-out grid (${zoomedOutGrid}) to exceed full-viewport grid (${wideOpenGrid})`);
});

test("heatmapGridWidthForGlobe clamps to a sane range so tiny globes don't blow up cost", () => {
    const rectWidth = 1400;
    const tinyGlobeRadius = 5; // globe is a speck at low zoom
    const grid = heatmapGridWidthForGlobe(tinyGlobeRadius, rectWidth);
    assert.ok(grid <= 220, `expected clamp at 220, got ${grid}`);
});

test("heatmapGridWidthForGlobe never returns less than the minimum clamp, even for a huge globe", () => {
    const rectWidth = 1400;
    const hugeGlobeRadius = 10000; // globe far exceeds the viewport (deep zoom-in)
    const grid = heatmapGridWidthForGlobe(hugeGlobeRadius, rectWidth);
    assert.ok(grid >= 80, `expected clamp floor at 80, got ${grid}`);
});

test("heatmapGridWidthForGlobe falls back sanely when globeRadius is zero or negative", () => {
    assert.equal(heatmapGridWidthForGlobe(0, 1400), 220);
    assert.equal(heatmapGridWidthForGlobe(-10, 1400), 220);
});

test("edgeBlurPx scales with texel size, matching the historical 4px default at the historical texel size", () => {
    const historicalTexelSize = 1400 / 140; // 10px, the old fixed-grid texel size
    assert.equal(edgeBlurPx(historicalTexelSize), 4);
});

test("edgeBlurPx shrinks for smaller texels (finer grid) and clamps at a sane floor", () => {
    assert.ok(edgeBlurPx(1) >= 1.5, "blur should not go below the floor clamp");
    assert.ok(edgeBlurPx(1) < 4, "blur should be smaller than the historical default for a fine texel");
});

test("edgeBlurPx clamps at a sane ceiling for very large texels", () => {
    assert.ok(edgeBlurPx(1000) <= 6);
});

test("recordApiUsage starts a fresh UTC-day tally from nothing", () => {
    const usage = recordApiUsage(null, Date.UTC(2026, 8, 15, 10), 48);
    assert.deepEqual(usage, { day: "2026-09-15", requests: 1, locations: 48 });
});

test("recordApiUsage accumulates requests and locations within the same UTC day", () => {
    const first = recordApiUsage(null, Date.UTC(2026, 8, 15, 0, 5), 100);
    const second = recordApiUsage(first, Date.UTC(2026, 8, 15, 23, 55), 76);
    assert.deepEqual(second, { day: "2026-09-15", requests: 2, locations: 176 });
});

test("recordApiUsage resets the tally when the UTC day changes", () => {
    const yesterday = { day: "2026-09-14", requests: 900, locations: 9000 };
    assert.deepEqual(recordApiUsage(yesterday, Date.UTC(2026, 8, 15, 0, 1), 1),
        { day: "2026-09-15", requests: 1, locations: 1 });
});

test("isPitchKeyboardShortcut matches Shift+ArrowUp", () => {
    assert.equal(isPitchKeyboardShortcut({ shiftKey: true, key: "ArrowUp" }), true);
});

test("isPitchKeyboardShortcut matches Shift+ArrowDown", () => {
    assert.equal(isPitchKeyboardShortcut({ shiftKey: true, key: "ArrowDown" }), true);
});

test("isPitchKeyboardShortcut ignores ArrowUp without Shift", () => {
    assert.equal(isPitchKeyboardShortcut({ shiftKey: false, key: "ArrowUp" }), false);
});

test("isPitchKeyboardShortcut ignores Shift+ArrowLeft (bearing, not pitch)", () => {
    assert.equal(isPitchKeyboardShortcut({ shiftKey: true, key: "ArrowLeft" }), false);
});

test("isPitchKeyboardShortcut ignores unrelated keys", () => {
    assert.equal(isPitchKeyboardShortcut({ shiftKey: true, key: "a" }), false);
});

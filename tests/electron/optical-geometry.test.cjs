'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getOpticalCrop, chooseGlassInk } = require('../../renderer/optical-geometry.ts');

const fixture = overrides => ({
  display: { x: 0, y: 0, width: 1920, height: 1080 },
  windowBounds: { x: 100, y: 200, width: 600, height: 400 },
  crop: { x: 20, y: 30, width: 400, height: 72 },
  frame: { width: 1920, height: 1080 },
  output: { width: 400, height: 72 },
  ...overrides,
});
const close = (actual, expected) => {
  for (const key of Object.keys(expected)) {
    if (typeof expected[key] === 'object') close(actual[key], expected[key]);
    else assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${key}: ${actual[key]} !== ${expected[key]}`);
  }
};

test('maps one-DIP-per-pixel source into the full local output', () => {
  close(getOpticalCrop(fixture()), {
    source: { x: 120, y: 230, width: 400, height: 72 },
    dest: { x: 0, y: 0, width: 400, height: 72 },
  });
});

test('uses native frame dimensions and canvas size independently of display DPI', () => {
  close(getOpticalCrop(fixture({ frame: { width: 3840, height: 2160 }, output: { width: 600, height: 108 } })), {
    source: { x: 240, y: 460, width: 800, height: 144 },
    dest: { x: 0, y: 0, width: 600, height: 108 },
  });
});

test('handles a negative monitor origin and a window on that monitor', () => {
  close(getOpticalCrop(fixture({
    display: { x: -2560, y: -360, width: 2560, height: 1440 },
    windowBounds: { x: -2460, y: -160, width: 600, height: 400 },
    frame: { width: 3840, height: 2160 },
  })), {
    source: { x: 180, y: 345, width: 600, height: 108 },
    dest: { x: 0, y: 0, width: 400, height: 72 },
  });
});

test('maps elastic transformed bounds back into the fixed local canvas extent', () => {
  close(getOpticalCrop(fixture({
    crop: { x: 5.5, y: 17.25, width: 475 * 1.15, height: 72 * 1.08 },
    frame: { width: 2880, height: 1620 },
    output: { width: 950, height: 144 },
  })), {
    source: { x: 158.25, y: 325.875, width: 819.375, height: 116.64 },
    dest: { x: 0, y: 0, width: 950, height: 144 },
  });
});

test('clips the left and top edges and preserves their destination offsets', () => {
  close(getOpticalCrop(fixture({
    windowBounds: { x: -60, y: -50, width: 600, height: 400 },
    crop: { x: 20, y: 30, width: 400, height: 100 },
    frame: { width: 3840, height: 2160 },
    output: { width: 800, height: 200 },
  })), {
    source: { x: 0, y: 0, width: 720, height: 160 },
    dest: { x: 80, y: 40, width: 720, height: 160 },
  });
});

test('clips the right and bottom edges without stretching the surviving pixels', () => {
  close(getOpticalCrop(fixture({
    windowBounds: { x: 1800, y: 1000, width: 600, height: 400 },
    crop: { x: 20, y: 30, width: 400, height: 100 },
    frame: { width: 3840, height: 2160 },
    output: { width: 800, height: 200 },
  })), {
    source: { x: 3640, y: 2060, width: 200, height: 100 },
    dest: { x: 0, y: 0, width: 200, height: 100 },
  });
});

test('a surface spanning monitors samples only the selected display', () => {
  close(getOpticalCrop(fixture({
    display: { x: 1920, y: 0, width: 1280, height: 720 },
    windowBounds: { x: 1800, y: 100, width: 600, height: 400 },
    crop: { x: 20, y: 30, width: 400, height: 100 },
    frame: { width: 2560, height: 1440 },
  })), {
    source: { x: 0, y: 260, width: 600, height: 200 },
    dest: { x: 100, y: 0, width: 300, height: 72 },
  });
});

test('a crop larger than a display clips every edge proportionally', () => {
  close(getOpticalCrop(fixture({
    display: { x: 0, y: 0, width: 100, height: 80 },
    windowBounds: { x: 0, y: 0, width: 600, height: 400 },
    crop: { x: -50, y: -40, width: 200, height: 160 },
    frame: { width: 200, height: 240 },
    output: { width: 400, height: 320 },
  })), {
    source: { x: 0, y: 0, width: 200, height: 240 },
    dest: { x: 100, y: 80, width: 200, height: 160 },
  });
});

test('offscreen and exactly touching crops do not produce drawImage rectangles', () => {
  for (const x of [-500, 1920, 2000]) {
    assert.equal(getOpticalCrop(fixture({ windowBounds: { x, y: 0, width: 600, height: 400 }, crop: { x: 0, y: 0, width: 400, height: 72 } })), null);
  }
  assert.equal(getOpticalCrop(fixture({ crop: { x: 0, y: 880, width: 400, height: 72 } })), null);
});

test('rejects nonfinite origins and invalid sizes safely', () => {
  for (const key of ['display', 'windowBounds', 'crop', 'frame', 'output']) {
    for (const dimension of ['width', 'height']) {
      for (const value of [0, -1, NaN, Infinity]) {
        const input = fixture();
        input[key] = { ...input[key], [dimension]: value };
        assert.equal(getOpticalCrop(input), null, `${key} ${dimension} ${value}`);
      }
    }
  }
  for (const key of ['display', 'windowBounds', 'crop']) {
    const input = fixture();
    input[key] = { ...input[key], x: NaN };
    assert.equal(getOpticalCrop(input), null);
  }
});

test('chooses dark ink for bright surfaces and light ink for dark surfaces', () => {
  assert.equal(chooseGlassInk(1, 0, false), false);
  assert.equal(chooseGlassInk(0, 0, false), true);
  assert.equal(chooseGlassInk(0.3, 0, false), false);
  assert.equal(chooseGlassInk(0.1, 0, false), true);
});

test('accounts for the purple tint and the overLight black veil', () => {
  assert.equal(chooseGlassInk(0.5, 0, false), false);
  assert.equal(chooseGlassInk(0.5, 0.8, false), true);
  assert.equal(chooseGlassInk(0.5, 0, true), true);
  assert.equal(chooseGlassInk(1, 0, true), false);
});

test('hysteresis keeps current ink stable near the contrast crossover', () => {
  for (const luminance of [0.18, 0.2, 0.22, 0.24]) {
    assert.equal(chooseGlassInk(luminance, 0, false, true), true);
    assert.equal(chooseGlassInk(luminance, 0, false, false), false);
  }
  assert.equal(chooseGlassInk(0.26, 0, false, true), false);
  assert.equal(chooseGlassInk(0.16, 0, false, false), true);
});

test('bad samples preserve the current ink and out-of-range input is bounded', () => {
  assert.equal(chooseGlassInk(NaN, 0, false, false), false);
  assert.equal(chooseGlassInk(Infinity, 0, false, true), true);
  assert.equal(chooseGlassInk(NaN, 0, false), true);
  assert.equal(chooseGlassInk(2, -1, false), false);
  assert.equal(chooseGlassInk(-1, 2, false), true);
  assert.equal(chooseGlassInk(1, NaN, false), false);
});

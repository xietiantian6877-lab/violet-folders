'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_GLASS_SETTINGS, sanitizeGlassSettings, validateGlassPatch } = require('../../electron/glass-settings.cjs');

test('glass recovery produces independent defaults for missing and malformed objects', () => {
  for (const input of [undefined, null, [], 'glass', 4, false]) {
    const actual = sanitizeGlassSettings(input);
    assert.deepEqual(actual, DEFAULT_GLASS_SETTINGS);
    actual.mode = 'polar';
    assert.equal(DEFAULT_GLASS_SETTINGS.mode, 'standard');
  }
});

test('glass recovery clamps numeric extremes and preserves fractional optical values', () => {
  assert.deepEqual(sanitizeGlassSettings({ displacementScale: -1, blurAmount: 4, saturation: 999, aberrationIntensity: -1, elasticity: 0.425, cornerRadius: 105, tintOpacity: 0.235, overLight: true, desktopRefraction: false, mode: 'prominent' }), {
    mode: 'prominent', displacementScale: 0, blurAmount: 1, saturation: 300,
    aberrationIntensity: 0, elasticity: 0.425, cornerRadius: 100,
    tintOpacity: 0.235, overLight: true, desktopRefraction: false,
  });
  for (const invalid of [NaN, Infinity, -Infinity, '0.25', null, {}, []]) {
    assert.equal(sanitizeGlassSettings({ blurAmount: invalid }).blurAmount, DEFAULT_GLASS_SETTINGS.blurAmount);
  }
});

test('glass patches accept partial updates, all modes and numeric endpoints', () => {
  for (const mode of ['standard', 'polar', 'prominent', 'shader']) assert.equal(validateGlassPatch({ mode }), true);
  const minimums = { displacementScale: 0, blurAmount: 0, saturation: 0, aberrationIntensity: 0, elasticity: 0, cornerRadius: 0, tintOpacity: 0 };
  const maximums = { displacementScale: 200, blurAmount: 1, saturation: 300, aberrationIntensity: 20, elasticity: 1, cornerRadius: 100, tintOpacity: 0.7 };
  assert.equal(validateGlassPatch(minimums), true);
  assert.equal(validateGlassPatch(maximums), true);
  assert.equal(validateGlassPatch({ blurAmount: 0.0625, overLight: false, desktopRefraction: true }), true);
  assert.equal(validateGlassPatch({ ...DEFAULT_GLASS_SETTINGS }), true);
});

test('glass patches reject malformed objects, unknown keys, non-finite and out-of-range values', () => {
  for (const patch of [undefined, null, [], 'glass', 4, true, {}, { mode: 'custom' }, { overLight: 1 }, { desktopRefraction: 'true' }, { unknown: 1 }, { mode: 'polar', unknown: 1 }, { __proto__: null, constructor: 'value' }]) {
    assert.equal(validateGlassPatch(patch), false);
  }
  const maximums = { displacementScale: 200, blurAmount: 1, saturation: 300, aberrationIntensity: 20, elasticity: 1, cornerRadius: 100, tintOpacity: 0.7 };
  for (const [key, maximum] of Object.entries(maximums)) {
    for (const invalid of [-0.001, maximum + 0.001, NaN, Infinity, -Infinity, '0', null, {}, []]) {
      assert.equal(validateGlassPatch({ [key]: invalid }), false, `${key} must reject ${String(invalid)}`);
    }
  }
});

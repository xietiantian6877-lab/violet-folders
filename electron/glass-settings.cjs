'use strict';

const GLASS_MODES = new Set(['standard', 'polar', 'prominent', 'shader']);
const GLASS_RANGES = Object.freeze({
  displacementScale: [0, 200],
  blurAmount: [0, 1],
  saturation: [0, 300],
  aberrationIntensity: [0, 20],
  elasticity: [0, 1],
  cornerRadius: [0, 100],
  tintOpacity: [0, 0.7],
});

const DEFAULT_GLASS_SETTINGS = Object.freeze({
  mode: 'standard',
  displacementScale: 100,
  blurAmount: 0.0625,
  saturation: 140,
  aberrationIntensity: 2,
  elasticity: 0.15,
  cornerRadius: 36,
  tintOpacity: 0.12,
  overLight: false,
  desktopRefraction: true,
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Saved preferences may come from an older version or a partially edited file.
// Keep valid values, clamp finite numbers and recover invalid fields individually.
function sanitizeGlassSettings(input) {
  const settings = isRecord(input) ? input : {};
  const sanitized = { ...DEFAULT_GLASS_SETTINGS };
  if (GLASS_MODES.has(settings.mode)) sanitized.mode = settings.mode;
  for (const [key, [minimum, maximum]] of Object.entries(GLASS_RANGES)) {
    const value = settings[key];
    if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = Math.max(minimum, Math.min(maximum, value));
  }
  for (const key of ['overLight', 'desktopRefraction']) {
    if (typeof settings[key] === 'boolean') sanitized[key] = settings[key];
  }
  return sanitized;
}

// IPC is stricter than file recovery: reject the entire patch on any invalid
// field, so malformed renderer input cannot silently reset another preference.
function validateGlassPatch(patch) {
  if (!isRecord(patch)) return false;
  const keys = Object.keys(patch);
  if (!keys.length) return false;
  return keys.every(key => {
    if (!Object.hasOwn(DEFAULT_GLASS_SETTINGS, key)) return false;
    const value = patch[key];
    if (key === 'mode') return GLASS_MODES.has(value);
    if (key === 'overLight' || key === 'desktopRefraction') return typeof value === 'boolean';
    const [minimum, maximum] = GLASS_RANGES[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
  });
}

module.exports = { DEFAULT_GLASS_SETTINGS, sanitizeGlassSettings, validateGlassPatch };

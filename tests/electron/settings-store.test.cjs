'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore } = require('../../electron/settings-store.cjs');
const { DEFAULT_GLASS_SETTINGS } = require('../../electron/glass-settings.cjs');

function temporary(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'VioletFolders-electron-settings-'));
  try { return run(new SettingsStore(directory)); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('missing settings return fresh safe defaults', () => temporary(store => {
  const expected = { pinnedPaths: [], language: 'zh-CN', collapsed: false, glass: { ...DEFAULT_GLASS_SETTINGS }, bounds: { x: 12, y: 12, width: 480, height: 52 } };
  assert.deepEqual(store.load(), expected);
  const edited = store.load(); edited.pinnedPaths.push('C:\\Changed'); edited.glass.tintOpacity = 0.6;
  assert.deepEqual(store.load(), expected);
  assert.equal(fs.existsSync(store.settingsPath), false);
}));

test('roundtrips Unicode pins, language, collapse, glass and negative multi-monitor coordinates', () => temporary(store => {
  const settings = { pinnedPaths: ['F:\\培训集合\\店铺授权', '\\\\server\\share\\100% 资料'], language: 'en', collapsed: true, glass: { mode: 'shader', displacementScale: 145.5, blurAmount: 0.0125, saturation: 218, aberrationIntensity: 7.5, elasticity: 0.35, cornerRadius: 28, tintOpacity: 0.21, overLight: true, desktopRefraction: false }, bounds: { x: -1920, y: 80, width: 600, height: 720 } };
  store.save(settings);
  assert.deepEqual(store.load(), settings);
  assert.deepEqual(fs.readdirSync(store.directory), ['settings.json']);
}));

test('atomic replacement overwrites a previous file and leaves no temporary files', () => temporary(store => {
  store.save({ pinnedPaths: ['C:\\Original'] });
  store.save({ pinnedPaths: ['C:\\Replacement'], language: 'en' });
  assert.deepEqual(store.load().pinnedPaths, ['C:\\Replacement']);
  assert.equal(store.load().language, 'en');
  assert.deepEqual(fs.readdirSync(store.directory), ['settings.json']);
}));

test('corrupt settings recover without deleting or rewriting the original', () => temporary(store => {
  fs.writeFileSync(store.settingsPath, '{ damaged JSON', 'utf8');
  assert.equal(store.load().language, 'zh-CN');
  assert.equal(fs.readFileSync(store.settingsPath, 'utf8'), '{ damaged JSON');
}));

test('sanitizes malformed fields, duplicate/unsafe pins and out-of-range geometry', () => temporary(store => {
  fs.writeFileSync(store.settingsPath, JSON.stringify({ pinnedPaths: ['C:\\Valid', 'c:\\valid\\', 'relative', null, 'shell:Home'], language: 'unknown', collapsed: 'true', bounds: { x: '12', y: -30.6, width: 50000, height: -1 } }));
  assert.deepEqual(store.load(), { pinnedPaths: ['C:\\Valid'], language: 'zh-CN', collapsed: false, glass: { ...DEFAULT_GLASS_SETTINGS }, bounds: { x: 12, y: -31, width: 900, height: 40 } });
}));

test('only user preferences persist, excluding live folder history and unknown fields', () => temporary(store => {
  store.save({ pinnedPaths: ['C:\\Pinned'], entries: [{ path: 'C:\\PrivateLiveFolder' }], token: 'secret-should-not-persist', bounds: { width: NaN, height: Infinity } });
  const text = fs.readFileSync(store.settingsPath, 'utf8');
  assert.equal(text.includes('PrivateLiveFolder'), false);
  assert.equal(text.includes('secret-should-not-persist'), false);
  assert.equal(store.load().bounds.width, 480);
  assert.equal(store.load().bounds.height, 52);
}));

test('accepts a Windows UTF-8 BOM and ignores oversized or non-object configuration', () => temporary(store => {
  fs.writeFileSync(store.settingsPath, '\uFEFF{"language":"en"}', 'utf8');
  assert.equal(store.load().language, 'en');
  fs.writeFileSync(store.settingsPath, 'null', 'utf8');
  assert.equal(store.load().language, 'zh-CN');
  fs.writeFileSync(store.settingsPath, ' '.repeat(1024 * 1024 + 1), 'utf8');
  assert.equal(store.load().language, 'zh-CN');
}));

test('migrates existing preferences without changing their pins, language or geometry', () => temporary(store => {
  const previous = { pinnedPaths: ['D:\\My folder'], language: 'en', collapsed: true, bounds: { x: -800, y: 12, width: 504, height: 300 } };
  fs.writeFileSync(store.settingsPath, JSON.stringify(previous));
  const loaded = store.load();
  assert.deepEqual(loaded, { ...previous, glass: { ...DEFAULT_GLASS_SETTINGS } });
  // Reading a previous version does not write or alter the user's file.
  assert.deepEqual(JSON.parse(fs.readFileSync(store.settingsPath, 'utf8')), previous);
  store.save({ ...loaded, glass: { ...loaded.glass, mode: 'polar', blurAmount: 0 } });
  assert.deepEqual(store.load(), { ...previous, glass: { ...DEFAULT_GLASS_SETTINGS, mode: 'polar', blurAmount: 0 } });
}));

test('recovers malformed glass values and persists only recognized glass preferences', () => temporary(store => {
  store.save({ glass: { displacementScale: 900, blurAmount: -3, saturation: '200', aberrationIntensity: Infinity, elasticity: 0.625, cornerRadius: NaN, tintOpacity: 2, mode: 'custom', overLight: 'false', desktopRefraction: false, privateCapture: 'should-not-persist' } });
  assert.deepEqual(store.load().glass, { ...DEFAULT_GLASS_SETTINGS, displacementScale: 200, blurAmount: 0, elasticity: 0.625, tintOpacity: 0.7, desktopRefraction: false });
  assert.equal(fs.readFileSync(store.settingsPath, 'utf8').includes('should-not-persist'), false);
}));

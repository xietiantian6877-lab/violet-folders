'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizePath } = require('./folder-catalog.cjs');

function numberInRange(value, fallback, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(minimum, Math.min(maximum, value))) : fallback;
}

function sanitizeSettings(input) {
  const settings = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const bounds = settings.bounds && typeof settings.bounds === 'object' ? settings.bounds : {};
  const seen = new Set();
  const pinnedPaths = [];
  for (const candidate of Array.isArray(settings.pinnedPaths) ? settings.pinnedPaths.slice(0, 1000) : []) {
    const folderPath = normalizePath(candidate);
    if (!folderPath || seen.has(folderPath.toLowerCase())) continue;
    seen.add(folderPath.toLowerCase());
    pinnedPaths.push(folderPath);
  }
  return {
    pinnedPaths,
    language: settings.language === 'en' ? 'en' : 'zh-CN',
    collapsed: settings.collapsed === true,
    bounds: {
      x: numberInRange(bounds.x, 12, -1000000, 1000000),
      y: numberInRange(bounds.y, 12, -1000000, 1000000),
      width: numberInRange(bounds.width, 480, 340, 900),
      height: numberInRange(bounds.height, 52, 40, 2400),
    },
  };
}

class SettingsStore {
  constructor(directory) {
    if (typeof directory !== 'string' || directory.length === 0) throw new TypeError('A settings directory is required.');
    this.directory = path.resolve(directory);
    this.settingsPath = path.join(this.directory, 'settings.json');
  }

  load() {
    try {
      if (fs.statSync(this.settingsPath).size > 1024 * 1024) return sanitizeSettings();
      return sanitizeSettings(JSON.parse(fs.readFileSync(this.settingsPath, 'utf8').replace(/^\uFEFF/u, '')));
    } catch {
      // Preserve an unreadable/damaged original for recovery. Only a subsequent
      // explicit save replaces it; starting the app never deletes the file.
      return sanitizeSettings();
    }
  }

  save(settings) {
    const sanitized = sanitizeSettings(settings);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `.settings-${randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      // Node's Windows rename uses replacement semantics. Do not unlink the old
      // configuration first: a failed replacement must leave the original intact.
      fs.renameSync(temporary, this.settingsPath);
      return sanitized;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = { SettingsStore, sanitizeSettings };

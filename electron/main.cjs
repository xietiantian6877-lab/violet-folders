'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, desktopCapturer, sharedTexture } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { FolderCatalog, normalizePath } = require('./folder-catalog.cjs');
const { SettingsStore } = require('./settings-store.cjs');
const { validateGlassPatch } = require('./glass-settings.cjs');
const { DesktopSource } = require('./desktop-source.cjs');
const { NativeDesktopCapture } = require('./native-desktop-capture.cjs');

let window = null;
let tray = null;
let worker = null;
let restartTimer = null;
let saveTimer = null;
let watchdog = null;
let hitTimer = null;
let hitRegions = [];
let quitting = false;
let interactive = false;
let store;
let settings;
let catalog;
let monitorStatus = 'starting';
let monitorError;
let restartAttempts = 0;
let lastSnapshot = 0;
let devURL = null;
let desktopSource = null;
let nativeDesktopCapture = null;
let drag = null;
let pointerHeld = false;
let frameRequestTimer = null;
let moveStateTimer = null;
const requests = new Map();
const rendererFile = path.join(__dirname, '..', 'dist-renderer', 'index.html');
// Set this before the singleton lock and userData are resolved so packaged and
// development runs share one predictable Roaming/Violet Folders directory.
app.setName('Violet Folders');
// Development-only isolated profile so diagnostics never touch the user's settings.
if (!app.isPackaged && process.env.VIOLET_USER_DATA) app.setPath('userData', path.resolve(process.env.VIOLET_USER_DATA));
if (!app.isPackaged && process.argv.includes('--inspect-ui')) app.commandLine.appendSwitch('remote-debugging-port', '9222');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (window) { window.show(); window.setAlwaysOnTop(true, 'screen-saver'); } });
  app.whenReady().then(start).catch(error => { console.error('Violet startup failed:', error.message); app.quit(); });
}

async function start() {
  app.setAppUserModelId('dev.violet.folders');
  store = new SettingsStore(app.getPath('userData'));
  settings = store.load();
  catalog = new FolderCatalog(settings.pinnedPaths);
  if (process.env.VITE_DEV_SERVER_URL) {
    const candidate = new URL(process.env.VITE_DEV_SERVER_URL);
    if (app.isPackaged || candidate.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(candidate.hostname)) {
      throw new Error('The development server must use a local HTTP origin.');
    }
    devURL = candidate.href;
  }
  installIPC();
  createWindow();
  // CSS draggable regions suppress DOM pointer events. Polling supplied surface
  // bounds also makes those regions interactive while transparent gaps pass through.
  hitTimer = setInterval(syncHitTest, 40);
  hitTimer.unref();
  createTray();
  globalShortcut.register('CommandOrControl+Alt+F', () => changeCollapsed(!settings.collapsed));
  const refreshDisplays = () => {
    nativeDesktopCapture?.stop();
    desktopSource?.invalidateSource();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('violet:desktop-geometry', null);
    clampBounds(); sendState();
    const geometry = desktopSource?.refreshGeometry();
    if (geometry && window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('violet:desktop-geometry', geometry);
  };
  screen.on('display-added', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  startWorker();
  watchdog = setInterval(() => {
    if (!quitting && lastSnapshot && Date.now() - lastSnapshot > 8000 && monitorStatus !== 'error') {
      monitorStatus = 'error'; monitorError = 'monitor-unresponsive'; sendState();
    }
    if (!quitting && worker && lastSnapshot && Date.now() - lastSnapshot > 25000) worker.kill();
  }, 2000);
  watchdog.unref();
}

function createWindow() {
  const bounds = settings.bounds || { x: 12, y: 12, width: 480, height: 56 };
  window = new BrowserWindow({
    ...bounds, minWidth: 340, minHeight: 64, frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, alwaysOnTop: true,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, show: false, title: 'Violet Folders · 紫璃文件夹',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: false, spellcheck: false,
    },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  clampBounds();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(desktopPermissionAllowed(contents, permission, details) &&
      Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'video');
  });
  window.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    desktopPermissionAllowed(contents, permission, details) && permissionOriginMatches(requestingOrigin) && details.mediaType === 'video');
  window.webContents.on('did-finish-load', () => { nativeDesktopCapture?.stop(); sendState(); desktopSource?.refreshGeometry(); });
  window.once('ready-to-show', () => {
    window.showInactive();
    desktopSource?.refreshProtection();
    sendState();
  });
  // During a drag only the refraction geometry follows every move; layout state
  // is sent once the window settles so the renderer cannot resize mid-drag.
  window.on('move', () => { desktopSource?.refreshGeometry(); scheduleFrameRequest(); if (!drag) { scheduleStateAfterMove(); scheduleSave(); } });
  window.on('resize', () => { desktopSource?.refreshGeometry(); scheduleFrameRequest(); if (!drag) { sendState(); scheduleSave(); } });
  window.on('closed', () => { nativeDesktopCapture?.destroy(); nativeDesktopCapture = null; desktopSource?.destroy(); desktopSource = null; window = null; app.quit(); });
  desktopSource = new DesktopSource({ window, screen, desktopCapturer, onGeometry: geometry => {
    nativeDesktopCapture?.geometryChanged(geometry);
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('violet:desktop-geometry', geometry);
  } });
  nativeDesktopCapture = new NativeDesktopCapture({ window, source: desktopSource, onFrame: sendDesktopFrame });
  nativeDesktopCapture.setFrameRate(settings.glass.frameRate);
  desktopSource.setEnabled(settings.glass.desktopRefraction);
  // Apply native exclusion before Electron adds its click-through layered
  // window state, which can reject the first display-affinity assignment.
  window.setIgnoreMouseEvents(true, { forward: true });
  if (devURL) window.loadURL(devURL); else window.loadFile(rendererFile);
}

async function sendDesktopFrame({ frame, geometry, release }) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) { release(); return; }
  let imported;
  try {
    imported = sharedTexture.importSharedTexture({
      textureInfo: { pixelFormat: 'bgra', codedSize: { width: frame.width, height: frame.height },
        timestamp: frame.timestamp, handle: { ntHandle: frame.ntHandle } },
      allReferencesReleased: release,
    });
    await sharedTexture.sendSharedTexture({ frame: window.webContents.mainFrame, importedSharedTexture: imported }, geometry);
  } catch {
    if (!imported) release();
  } finally { imported?.release(); }
}

function iconPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '..', 'build', 'icon.png');
}

function workArea() {
  return window && !window.isDestroyed() ? screen.getDisplayMatching(window.getBounds()).workArea : screen.getPrimaryDisplay().workArea;
}

function getState() {
  const area = workArea();
  const bounds = window && !window.isDestroyed() ? window.getBounds() : settings.bounds;
  return {
    entries: catalog.entries, collapsed: settings.collapsed, language: settings.language, glass: settings.glass,
    launchAtLogin: app.isPackaged ? app.getLoginItemSettings({ path: startupExecutable() }).openAtLogin : false,
    launchAtLoginSupported: app.isPackaged, monitorStatus,
    ...(monitorError ? { error: monitorError } : {}),
    maxHeight: Math.max(64, area.y + area.height - Math.max(bounds.y, area.y) - 8),
    maxWidth: Math.min(900, area.width - 16),
  };
}

function sendState() {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('violet:state', getState());
}

// Keeps the header on screen. A window that reaches past the bottom edge is
// shortened in place instead of being pushed upward, so it never jumps.
function clampBounds() {
  if (!window || window.isDestroyed() || drag) return;
  const current = window.getBounds();
  const area = screen.getDisplayMatching(current).workArea;
  const width = Math.min(current.width, area.width - 16);
  const x = Math.round(Math.max(area.x, Math.min(current.x, area.x + area.width - width)));
  const y = Math.round(Math.max(area.y, Math.min(current.y, area.y + area.height - 72)));
  const height = Math.round(Math.max(64, Math.min(current.height, area.height - 16, area.y + area.height - y)));
  if (current.x !== x || current.y !== y || current.width !== width || current.height !== height) window.setBounds({ x, y, width, height });
}

function scheduleFrameRequest() {
  if (frameRequestTimer) return;
  frameRequestTimer = setTimeout(() => { frameRequestTimer = null; nativeDesktopCapture?.requestFrame(); }, 120);
}

function scheduleStateAfterMove() {
  clearTimeout(moveStateTimer);
  moveStateTimer = setTimeout(sendState, 120);
}

// Window dragging runs here instead of through a CSS drag region: every step
// is clamped to the work area before the window moves, so dragging against a
// screen edge slides along it rather than fighting a later correction.
function startDrag() {
  if (!window || window.isDestroyed()) return;
  stopDrag(false);
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  drag = { offsetX: cursor.x - bounds.x, offsetY: cursor.y - bounds.y, width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, started: Date.now(), timer: null };
  clearTimeout(moveStateTimer);
  setInteractive(true);
  drag.timer = setInterval(stepDrag, 8);
}

function stepDrag() {
  if (!drag || !window || window.isDestroyed() || Date.now() - drag.started > 120000) { stopDrag(); return; }
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const x = Math.round(Math.max(area.x, Math.min(cursor.x - drag.offsetX, area.x + area.width - drag.width)));
  const y = Math.round(Math.max(area.y, Math.min(cursor.y - drag.offsetY, area.y + area.height - Math.min(drag.height, 72))));
  if (x === drag.x && y === drag.y) return;
  drag.x = x; drag.y = y;
  window.setBounds({ x, y, width: drag.width, height: drag.height });
}

function stopDrag(settle = true) {
  if (!drag) return;
  clearInterval(drag.timer);
  drag = null;
  if (!settle) return;
  clampBounds(); save(); sendState(); syncHitTest();
}

function save() {
  if (!settings || !catalog) return;
  settings.pinnedPaths = catalog.pinnedPaths;
  if (window && !window.isDestroyed()) settings.bounds = window.getBounds();
  try { store.save(settings); }
  catch (error) { console.error('Could not save Violet settings:', error.code || error.message); }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

function changeCollapsed(value) {
  settings.collapsed = value;
  save(); sendState(); createTrayMenu();
}

function createTray() {
  let icon = nativeImage.createFromPath(iconPath());
  if (icon.isEmpty()) {
    // A tiny inline icon keeps development builds operable before icon generation.
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
  }
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Violet Folders · 紫璃文件夹');
  tray.on('double-click', () => { changeCollapsed(false); window?.showInactive(); });
  createTrayMenu();
}

function createTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const en = settings.language === 'en';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: en ? 'Violet Folders' : '紫璃文件夹', enabled: false },
    { label: en ? 'Fold / unfold' : '折叠 / 展开', click: () => changeCollapsed(!settings.collapsed) },
    { label: en ? 'Move to top left' : '回到屏幕左上角', click: () => { const area = screen.getPrimaryDisplay().workArea; window?.setPosition(area.x + 12, area.y + 12); save(); sendState(); } },
    { label: '语言 / Language', submenu: [
      { label: '简体中文', type: 'radio', checked: !en, click: () => changeLanguage('zh-CN') },
      { label: 'English', type: 'radio', checked: en, click: () => changeLanguage('en') },
    ] },
    { type: 'separator' },
    { label: en ? 'Quit Violet Folders' : '退出紫璃文件夹', click: () => app.quit() },
  ]));
}

function changeLanguage(language) { settings.language = language; save(); sendState(); createTrayMenu(); }
function startupExecutable() { return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; }
function resetPosition() { const area = screen.getPrimaryDisplay().workArea; window?.setPosition(area.x + 12, area.y + 12); clampBounds(); save(); sendState(); }

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  return trustedURL(event.senderFrame.url);
}

function trustedURL(origin) {
  if (typeof origin !== 'string') return false;
  if (devURL) { try { return new URL(origin).origin === new URL(devURL).origin; } catch { return false; } }
  return origin.split(/[?#]/, 1)[0] === pathToFileURL(rendererFile).href;
}

function permissionOriginMatches(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const actual = new URL(origin);
    const expected = new URL(devURL || pathToFileURL(rendererFile).href);
    return actual.protocol === expected.protocol && actual.origin === expected.origin;
  } catch { return false; }
}

function desktopPermissionAllowed(contents, permission, details) {
  return permission === 'display-capture' && Boolean(window && !window.isDestroyed() &&
    contents === window.webContents && !window.webContents.isDestroyed() && settings?.glass.desktopRefraction && desktopSource?.protected &&
    details?.isMainFrame === true && trustedURL(window.webContents.mainFrame.url) && trustedURL(details.requestingUrl) &&
    (details.securityOrigin === undefined || permissionOriginMatches(details.securityOrigin)));
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, value) => {
    if (!trusted(event)) throw new Error('Untrusted IPC sender.');
    return callback(value);
  });
}

function knownPath(value) {
  if (typeof value !== 'string' || value.length > 32767) return null;
  const normalized = normalizePath(value);
  return normalized && catalog.has(normalized) ? normalized : null;
}

function installIPC() {
  handle('violet:get-state', getState);
  handle('violet:get-desktop-source', options => {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'refresh') || (Object.hasOwn(options, 'refresh') && typeof options.refresh !== 'boolean'))) {
      return { ok: false, error: 'invalid-desktop-source-request' };
    }
    return nativeDesktopCapture?.start(options?.refresh === true) || { ok: false, error: 'desktop-capture-unavailable' };
  });
  // Development diagnostics only: native capture counters for performance checks.
  if (!app.isPackaged) handle('violet:capture-stats', () => nativeDesktopCapture?.stats() ?? null);
  handle('violet:stop-desktop-capture', () => { nativeDesktopCapture?.stop(); return { ok: true }; });
  handle('violet:open-folder', value => {
    const folder = knownPath(value);
    return folder ? openFolder(folder) : { ok: false, error: 'invalid-folder' };
  });
  handle('violet:reorder', value => {
    if (!Array.isArray(value) || value.length > 2048 || !value.every(item => typeof item === 'string' && item.length <= 32767)) return { ok: false, error: 'invalid-value' };
    if (catalog.reorder(value)) { save(); sendState(); }
    return { ok: true };
  });
  handle('violet:toggle-pin', value => {
    const folder = knownPath(value);
    if (!folder) return { ok: false, error: 'invalid-folder' };
    catalog.togglePin(folder); save(); sendState();
    return { ok: true };
  });
  handle('violet:set-collapsed', value => {
    if (typeof value !== 'boolean') return { ok: false, error: 'invalid-value' };
    changeCollapsed(value); return { ok: true };
  });
  handle('violet:set-language', value => {
    if (!['zh-CN', 'en'].includes(value)) return { ok: false, error: 'invalid-value' };
    changeLanguage(value); return { ok: true };
  });
  handle('violet:set-glass-settings', value => {
    if (!validateGlassPatch(value)) return { ok: false, error: 'invalid-value' };
    settings.glass = { ...settings.glass, ...value };
    nativeDesktopCapture?.setFrameRate(settings.glass.frameRate);
    desktopSource?.setEnabled(settings.glass.desktopRefraction);
    scheduleSave(); sendState();
    return { ok: true };
  });
  handle('violet:set-launch-at-login', value => {
    if (typeof value !== 'boolean') return { ok: false, error: 'invalid-value' };
    if (!app.isPackaged) return { ok: false, error: 'unavailable-in-development' };
    try { app.setLoginItemSettings({ openAtLogin: value, path: startupExecutable() }); sendState(); return { ok: true }; }
    catch { return { ok: false, error: 'startup-unavailable' }; }
  });
  handle('violet:set-content-size', size => {
    if (!size || typeof size !== 'object' || !Number.isFinite(size.width) || !Number.isFinite(size.height) ||
      (size.minimumHeight !== undefined && (!Number.isFinite(size.minimumHeight) || size.minimumHeight < 0 || size.minimumHeight > 1024))) return { ok: false, error: 'invalid-value' };
    if (drag) return { ok: true };
    const area = workArea();
    const bounds = window.getBounds();
    const minimumVisible = Math.min(area.height - 16, Math.max(64, size.minimumHeight ?? Math.min(100, size.height)));
    const latestTop = Math.max(area.y, area.y + area.height - minimumVisible - 8);
    if (bounds.y > latestTop) window.setPosition(bounds.x, Math.round(latestTop));
    const width = Math.round(Math.max(340, Math.min(900, area.width - 16, size.width)));
    const height = Math.round(Math.max(64, Math.min(area.height - 16, getState().maxHeight, size.height)));
    const current = window.getContentSize();
    if (current[0] !== width || current[1] !== height) window.setContentSize(width, height);
    clampBounds(); return { ok: true };
  });
  handle('violet:quit', () => { app.quit(); return { ok: true }; });
  handle('violet:reset-position', () => { resetPosition(); return { ok: true }; });
  ipcMain.on('violet:set-interactive', (event, value) => {
    if (!trusted(event) || typeof value !== 'boolean' || value === interactive) return;
    setInteractive(value);
  });
  // While a folder row is being dragged the whole window keeps the pointer,
  // so passing over the transparent gaps cannot drop the gesture.
  ipcMain.on('violet:hold-pointer', (event, value) => {
    if (!trusted(event) || typeof value !== 'boolean') return;
    pointerHeld = value;
    if (value) setInteractive(true); else syncHitTest();
  });
  ipcMain.on('violet:drag', (event, phase) => {
    if (!trusted(event)) return;
    if (phase === 'start') startDrag();
    else if (phase === 'end') stopDrag();
  });
  ipcMain.on('violet:set-hit-regions', (event, regions) => {
    if (!trusted(event) || !Array.isArray(regions) || regions.length > 2048) return;
    if (!regions.every(region => region && ['x', 'y', 'width', 'height'].every(key => typeof region[key] === 'number' && Number.isFinite(region[key]) && Math.abs(region[key]) <= 20000) && region.width >= 0 && region.height >= 0 && (region.radius === undefined || (Number.isFinite(region.radius) && region.radius >= 0 && region.radius <= 10000)))) return;
    const [width, height] = window.getContentSize();
    hitRegions = regions.map(region => {
      const x = Math.max(0, region.x), y = Math.max(0, region.y);
      const right = Math.min(width, region.x + region.width), bottom = Math.min(height, region.y + region.height);
      return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y), radius: Math.min(region.radius || 0, region.width / 2, region.height / 2) };
    }).filter(region => region.width > 0 && region.height > 0);
    syncHitTest();
  });
}

function setInteractive(value) {
  if (!window || window.isDestroyed() || value === interactive) return;
  interactive = value;
  window.setIgnoreMouseEvents(!value, { forward: true });
}

function syncHitTest() {
  if (!window || window.isDestroyed() || drag || pointerHeld) return;
  if (!window.isVisible() || !hitRegions.length) { setInteractive(false); return; }
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  const x = cursor.x - bounds.x, y = cursor.y - bounds.y;
  const inside = hitRegions.some(region => {
    const localX = x - region.x, localY = y - region.y;
    if (localX < 0 || localY < 0 || localX >= region.width || localY >= region.height) return false;
    const radius = Math.min(region.radius, region.width / 2, region.height / 2);
    if (!radius) return true;
    const nearestX = Math.max(radius, Math.min(localX, region.width - radius));
    const nearestY = Math.max(radius, Math.min(localY, region.height - radius));
    return (localX - nearestX) ** 2 + (localY - nearestY) ** 2 <= radius ** 2;
  });
  setInteractive(inside);
}

function watcherFile() {
  const packaged = path.join(process.resourcesPath, 'watcher.ps1');
  return app.isPackaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, 'watcher.ps1');
}

function startWorker() {
  if (quitting) return;
  if (process.platform !== 'win32') { monitorStatus = 'error'; monitorError = 'windows-required'; sendState(); return; }
  monitorStatus = 'starting'; monitorError = undefined; sendState();
  lastSnapshot = Date.now();
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', watcherFile()], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
  });
  worker = child;
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', line => {
    if (worker !== child || line.length > 2 * 1024 * 1024) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'snapshot' && Array.isArray(message.folders) && message.folders.length <= 2048) {
      const changed = catalog.reconcile(message.folders);
      const changedStatus = monitorStatus !== 'ready';
      lastSnapshot = Date.now(); restartAttempts = 0; monitorStatus = 'ready'; monitorError = undefined;
      if (changed || changedStatus) sendState();
    } else if (message.type === 'response' && typeof message.id === 'string') {
      const pending = requests.get(message.id);
      if (pending) { clearTimeout(pending.timer); requests.delete(message.id); pending.resolve({ ok: message.ok === true, ...(message.ok ? {} : { error: typeof message.error === 'string' ? message.error : 'folder-unavailable' }) }); }
    } else if (message.type === 'status' && message.status === 'error') {
      monitorStatus = 'error'; monitorError = typeof message.error === 'string' ? message.error : 'explorer-unavailable'; sendState();
    }
  });
  child.stderr.on('data', data => { if (!quitting) console.error('Explorer monitor:', data.toString('utf8').trim().slice(0, 500)); });
  child.stdin.on('error', () => {});
  let finished = false;
  const exit = () => {
    if (finished) return; finished = true; lines.close();
    if (worker !== child) return;
    worker = null;
    for (const pending of requests.values()) { clearTimeout(pending.timer); pending.resolve({ ok: false, error: 'monitor-unavailable' }); }
    requests.clear();
    if (quitting) return;
    monitorStatus = 'error'; monitorError = 'monitor-unavailable'; sendState();
    const delay = Math.min(10000, 750 * 2 ** Math.min(restartAttempts++, 4));
    restartTimer = setTimeout(startWorker, delay);
  };
  child.once('error', exit); child.once('exit', exit);
}

function openFolder(folder) {
  if (!worker || worker.killed || !worker.stdin.writable) return Promise.resolve({ ok: false, error: 'monitor-unavailable' });
  if (requests.size >= 16) return Promise.resolve({ ok: false, error: 'monitor-busy' });
  return new Promise(resolve => {
    const id = randomUUID();
    const timer = setTimeout(() => { requests.delete(id); resolve({ ok: false, error: 'open-timeout' }); }, 15000);
    requests.set(id, { resolve, timer });
    worker.stdin.write(JSON.stringify({ type: 'open', id, path: folder }) + '\n');
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  quitting = true;
  nativeDesktopCapture?.destroy(); nativeDesktopCapture = null;
  desktopSource?.destroy(); desktopSource = null;
  stopDrag(false);
  clearTimeout(restartTimer); clearTimeout(saveTimer); clearTimeout(frameRequestTimer); clearTimeout(moveStateTimer); clearInterval(watchdog); clearInterval(hitTimer);
  save(); globalShortcut.unregisterAll(); tray?.destroy();
  for (const pending of requests.values()) { clearTimeout(pending.timer); pending.resolve({ ok: false, error: 'monitor-unavailable' }); }
  requests.clear();
  if (worker) {
    const child = worker; worker = null;
    // Keep Electron alive briefly so a blocked COM call cannot leave an orphaned
    // PowerShell process after the user quits. Only this app's child is terminated.
    event.preventDefault();
    let complete = false;
    let timeout;
    const finish = () => { if (complete) return; complete = true; clearTimeout(timeout); app.exit(0); };
    child.once('exit', finish);
    timeout = setTimeout(() => { if (child.exitCode === null) child.kill(); finish(); }, 700);
    try { child.stdin.end(JSON.stringify({ type: 'quit' }) + '\n'); } catch { child.kill(); finish(); }
  }
});

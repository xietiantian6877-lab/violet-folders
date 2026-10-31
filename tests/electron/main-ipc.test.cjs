'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { DEFAULT_GLASS_SETTINGS } = require('../../electron/glass-settings.cjs');
const { DesktopSource } = require('../../electron/desktop-source.cjs');
const { NativeDesktopCapture } = require('../../electron/native-desktop-capture.cjs');

const mainFile = path.resolve(__dirname, '../../electron/main.cjs');
const mainSource = fs.readFileSync(mainFile, 'utf8');
const realRequire = createRequire(mainFile);
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Executes the actual main process with no Electron runtime or real subprocess. */
async function createHarness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'VioletFolders-main-ipc-'));
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  const workers = [];
  const timers = new Set();
  const intervalCallbacks = new Map();
  const errors = [];
  const sourceCalls = [];
  const nativeSessions = [];
  const transfers = [];
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: options.packaged === true,
    setName(value) { this.name = value; },
    getName() { return this.name; },
    commandLine: { appendSwitch() {} },
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    setAppUserModelId(value) { this.modelId = value; },
    getPath: () => directory,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings(value) { this.loginSettings = value; },
    quit() {
      if (this.didQuit) return;
      this.didQuit = true;
      this.emit('before-quit', { preventDefault() {} });
    },
    exit(code) { this.exitCode = code; },
  });
  const area = { x: 0, y: 0, width: 1280, height: 800, ...options.workArea };
  const screen = new EventEmitter();
  screen.getDisplayMatching = screen.getPrimaryDisplay = () => ({ id: 42, bounds: area, workArea: area, scaleFactor: 1 });
  const cursor = { x: -9999, y: -9999 };
  screen.getCursorScreenPoint = () => ({ ...cursor });

  class FakeBrowserWindow extends EventEmitter {
    constructor(settings) {
      super();
      this.options = settings;
      this.bounds = { x: settings.x, y: settings.y, width: Math.max(settings.minWidth, settings.width), height: Math.max(settings.minHeight, settings.height) };
      this.mouseCalls = [];
      this.protectionCalls = [];
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: '' },
        session: {
          setPermissionRequestHandler(callback) { this.requestHandler = callback; },
          setPermissionCheckHandler(callback) { this.checkHandler = callback; },
        },
        isDestroyed: () => false,
        setWindowOpenHandler(callback) { this.openHandler = callback; },
        send(channel, state) { this.lastSent = { channel, state }; (this.sentMessages ??= []).push({ channel, state }); },
      });
      windows.push(this);
    }
    isDestroyed() { return false; }
    isVisible() { return this.shown === true; }
    setAlwaysOnTop(value, level) { this.alwaysOnTop = { value, level }; }
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(ignore, settings) {
      this.mouseCalls.push({ ignore, settings });
      this.ignoreMouse = ignore;
    }
    setContentProtection(value) {
      this.protectionCalls.push(value);
      if (options.layeredProtectionOrdering && value && this.ignoreMouse && !this.nativeProtected)
        throw new Error('Initial exclusion cannot be applied after click-through');
      if (this.shown || options.layeredProtectionOrdering) this.nativeProtected = value;
    }
    getBounds() { return { ...this.bounds }; }
    getNativeWindowHandle() { return Buffer.alloc(8, 1); }
    getContentSize() { return [this.bounds.width, this.bounds.height]; }
    setContentSize(width, height) { this.bounds.width = width; this.bounds.height = height; this.emit('resize'); }
    setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; this.emit('move'); }
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('move'); this.emit('resize'); }
    loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; this.emit('ready-to-show'); this.webContents.emit('did-finish-load'); }
    loadURL(url) { this.webContents.mainFrame.url = url; this.emit('ready-to-show'); this.webContents.emit('did-finish-load'); }
    showInactive() { this.shown = true; }
    show() { this.shown = true; }
  }
  class FakeTray extends EventEmitter {
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu; }
    isDestroyed() { return this.destroyed === true; }
    destroy() { this.destroyed = true; }
  }
  const image = { isEmpty: () => false, resize() { return this; } };
  const electron = {
    app, screen, BrowserWindow: FakeBrowserWindow, Tray: FakeTray,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: (name, callback) => listeners.set(name, callback) },
    Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath: () => image, createFromDataURL: () => image },
    globalShortcut: { register: () => true, unregisterAll() {} },
    desktopCapturer: { async getSources(options) { sourceCalls.push(options); return [{ id: 'screen:42:0', display_id: '42' }]; } },
    sharedTexture: {
      importSharedTexture(options) { return { options, release() { options.allReferencesReleased(); } }; },
      async sendSharedTexture(options, geometry) { transfers.push({ options, geometry }); },
    },
  };
  function spawn(executable, args, settings) {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.commands = []; child.killed = false; child.exitCode = null;
    child.spawnArguments = { executable, args, settings };
    child.stdin = new Writable({
      write(data, _encoding, callback) {
        for (const line of data.toString('utf8').trim().split('\n')) {
          const message = JSON.parse(line); child.commands.push(message);
          if (message.type === 'open') setImmediate(() => child.stdout.write(JSON.stringify({ type: 'response', id: message.id, ok: true }) + '\n'));
        }
        callback();
      },
    });
    child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('exit', 0); };
    workers.push(child);
    return child;
  }
  const sandbox = {
    require: name => name === 'electron' ? electron : name === 'node:child_process' ? { spawn } : name === './desktop-source.cjs'
      ? { DesktopSource: class extends DesktopSource { constructor(settings) { super({ ...settings, platform: 'win32', release: '10.0.19045',
        setProtection(_handle, enabled) { settings.window.setContentProtection(enabled); return enabled ? 0x11 : 0; },
      }); } } }
      : name === './native-desktop-capture.cjs' ? { NativeDesktopCapture: class extends NativeDesktopCapture {
        constructor(settings) { super({ ...settings, settle: async () => {}, createCapture(options) {
          assert.equal(windows[0].nativeProtected, true, 'capture requires protection on the shown native widget');
          const controller = { cursorCaptureEnabled: false, closed: false, released: [], close() { this.closed = true; }, releaseFrame(id) { this.released.push(id); } };
          nativeSessions.push({ options, controller });
          return controller;
        } }); }
      } } : realRequire(name),
    __dirname: path.dirname(mainFile), __filename: mainFile, URL,
    process: { argv: ['node', mainFile], platform: 'win32', execPath: 'C:\\Violet\\VioletFolders.exe', resourcesPath: directory, env: { SystemRoot: 'C:\\Windows', ...(options.devURL ? { VITE_DEV_SERVER_URL: options.devURL } : {}) } },
    console: { error: (...args) => errors.push(args.join(' ')), log() {} },
    setTimeout(callback, delay) { const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    setInterval(callback, delay) { intervalCallbacks.set(delay, callback); const timer = setInterval(callback, delay); timers.add(timer); return timer; },
    clearInterval(timer) { timers.delete(timer); clearInterval(timer); },
  };
  t.after(() => {
    app.quit();
    for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
    for (const worker of workers) { worker.stdout.destroy(); worker.stderr.destroy(); worker.stdin.destroy(); }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  vm.runInNewContext(mainSource, sandbox, { filename: mainFile });
  await tick();
  if (!windows.length) throw new Error('Main process did not initialize: ' + errors.join('; '));
  const window = windows[0];
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return {
    app, window, area, workers, handlers, listeners, sourceCalls, nativeSessions, transfers, screen,
    invoke: (name, value, sender = event()) => handlers.get('violet:' + name)(sender, value),
    send: (name, value, sender = event()) => listeners.get('violet:' + name)(sender, value),
    event,
    cursorAt(x, y) { cursor.x = window.bounds.x + x; cursor.y = window.bounds.y + y; intervalCallbacks.get(40)(); },
    settings: () => JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8')),
    async snapshot(folders) { workers[0].stdout.write(JSON.stringify({ type: 'snapshot', folders }) + '\n'); await tick(); },
  };
}

test('main creates a sandboxed transparent topmost window and a shell-free hidden watcher', async t => {
  const h = await createHarness(t);
  assert.equal(h.app.name, 'Violet Folders');
  assert.equal(h.app.modelId, 'dev.violet.folders');
  assert.equal(h.window.options.transparent, true);
  assert.equal(h.window.options.skipTaskbar, true);
  assert.equal(h.window.options.webPreferences.nodeIntegration, false);
  assert.equal(h.window.options.webPreferences.contextIsolation, true);
  assert.equal(h.window.options.webPreferences.sandbox, true);
  assert.equal(h.window.alwaysOnTop.value, true);
  assert.equal(h.window.webContents.openHandler().action, 'deny');
  assert.equal(h.window.webContents.session.checkHandler(), false);
  assert.equal(h.workers[0].spawnArguments.settings.shell, false);
  assert.equal(h.workers[0].spawnArguments.settings.windowsHide, true);
  assert.ok(h.workers[0].spawnArguments.args.includes('-Sta'));
});

test('shown native widgets receive exclusion again before any capture session starts', async t => {
  const h = await createHarness(t, { packaged: true });
  assert.equal(h.window.shown, true);
  assert.equal(h.window.nativeProtected, true);
  // Model a native widget replacement after startup; a new capture request
  // must protect the current widget before allowing Desktop Duplication.
  h.window.nativeProtected = false;
  assert.equal((await h.invoke('get-desktop-source', { refresh: true })).ok, true);
  assert.equal(h.window.nativeProtected, true);
  assert.equal(h.nativeSessions.length, 1);
});

test('initial native exclusion precedes click-through so the automatic shown path can capture', async t => {
  const h = await createHarness(t, { packaged: true, layeredProtectionOrdering: true });
  assert.equal(h.window.ignoreMouse, true);
  assert.equal(h.window.nativeProtected, true);
  assert.equal((await h.invoke('get-desktop-source')).ok, true);
  assert.equal(h.nativeSessions.length, 1);
});

test('IPC rejects other web contents, subframes and a navigated foreign origin', async t => {
  const h = await createHarness(t);
  assert.throws(() => h.invoke('get-state', undefined, { sender: {}, senderFrame: h.window.webContents.mainFrame }), /Untrusted IPC sender/u);
  assert.throws(() => h.invoke('get-state', undefined, { sender: h.window.webContents, senderFrame: { url: h.window.webContents.mainFrame.url } }), /Untrusted IPC sender/u);
  const original = h.window.webContents.mainFrame.url;
  h.window.webContents.mainFrame.url = 'https://attacker.example/';
  assert.throws(() => h.invoke('set-collapsed', true), /Untrusted IPC sender/u);
  h.window.webContents.mainFrame.url = original;
  assert.equal(h.invoke('get-state').collapsed, false);
});

test('open and pin accept catalog-known filesystem paths only', async t => {
  const h = await createHarness(t);
  await h.snapshot([{ path: 'C:\\Known\\中文 folder', windowHandle: 12 }]);
  for (const candidate of ['C:\\Unknown', 'shell:Downloads', 'C:relative', 'C:\\Known\\中文 folder" & calc', null, {}]) {
    assert.equal(h.invoke('open-folder', candidate).error, 'invalid-folder');
    assert.equal(h.invoke('toggle-pin', candidate).error, 'invalid-folder');
  }
  assert.equal(h.workers[0].commands.length, 0);
  assert.equal(h.invoke('toggle-pin', 'c:\\known\\中文 folder').ok, true);
  assert.equal(h.invoke('get-state').entries[0].isPinned, true);
  assert.equal((await h.invoke('open-folder', 'C:\\Known\\中文 folder')).ok, true);
  assert.equal(h.workers[0].commands[0].type, 'open');
  assert.equal(h.workers[0].commands[0].path, 'C:\\Known\\中文 folder');
});

test('invalid preference and content-size values are rejected without changing state', async t => {
  const h = await createHarness(t);
  for (const value of [null, 'true', 1, {}, []]) assert.equal(h.invoke('set-collapsed', value).error, 'invalid-value');
  for (const value of [null, 'en-US', '', 1, {}]) assert.equal(h.invoke('set-language', value).error, 'invalid-value');
  for (const value of [null, {}, { width: '480', height: 100 }, { width: NaN, height: 100 }, { width: 480, height: Infinity }]) assert.equal(h.invoke('set-content-size', value).error, 'invalid-value');
  for (const minimumHeight of [-1, 1025, Infinity, NaN, '400', null, {}]) {
    assert.equal(h.invoke('set-content-size', { width: 480, height: 100, minimumHeight }).error, 'invalid-value');
  }
  assert.equal(h.invoke('set-launch-at-login', 'true').error, 'invalid-value');
  assert.equal(h.invoke('set-launch-at-login', true).error, 'unavailable-in-development');
  assert.equal(h.invoke('get-state').collapsed, false);
  assert.equal(h.invoke('get-state').language, 'zh-CN');
});

test('valid collapse/language changes and retained pins are persisted, live history is omitted', async t => {
  const h = await createHarness(t);
  await h.snapshot([{ path: 'F:\\Pinned' }, { path: 'F:\\Unpinned private history' }]);
  h.invoke('toggle-pin', 'F:\\Pinned');
  assert.equal(h.invoke('set-collapsed', true).ok, true);
  assert.equal(h.invoke('set-language', 'en').ok, true);
  assert.equal(h.settings().collapsed, true);
  assert.equal(h.settings().language, 'en');
  assert.deepEqual(h.settings().pinnedPaths, ['F:\\Pinned']);
  assert.equal(JSON.stringify(h.settings()).includes('Unpinned private history'), false);
  await h.snapshot([]);
  assert.equal(h.invoke('get-state').entries.length, 1);
  assert.equal(h.invoke('get-state').entries[0].isOpen, false);
  h.invoke('toggle-pin', 'F:\\Pinned');
  assert.equal(h.invoke('get-state').entries.length, 0);
});

test('glass patches update published state immediately and persist after the debounce without replacing other preferences', async t => {
  const h = await createHarness(t);
  await h.snapshot([{ path: 'F:\\Pinned glass settings' }]);
  h.invoke('toggle-pin', 'F:\\Pinned glass settings');
  h.invoke('set-language', 'en');
  h.invoke('set-collapsed', true);
  assert.deepEqual({ ...h.invoke('get-state').glass }, DEFAULT_GLASS_SETTINGS);
  assert.equal(h.invoke('set-glass-settings', { mode: 'polar', displacementScale: 123.5, blurAmount: 0.025, tintOpacity: 0.19 }).ok, true);
  assert.equal(h.invoke('set-glass-settings', { overLight: true, desktopRefraction: false, cornerRadius: 24 }).ok, true);
  const expected = { ...DEFAULT_GLASS_SETTINGS, mode: 'polar', displacementScale: 123.5, blurAmount: 0.025, tintOpacity: 0.19, overLight: true, desktopRefraction: false, cornerRadius: 24 };
  assert.deepEqual({ ...h.invoke('get-state').glass }, expected);
  assert.equal(h.window.webContents.lastSent.channel, 'violet:state');
  assert.deepEqual({ ...h.window.webContents.lastSent.state.glass }, expected);
  await new Promise(resolve => setTimeout(resolve, 300));
  const saved = h.settings();
  assert.deepEqual(saved.glass, expected);
  assert.deepEqual(saved.pinnedPaths, ['F:\\Pinned glass settings']);
  assert.equal(saved.language, 'en');
  assert.equal(saved.collapsed, true);
});

test('glass IPC rejects invalid patches atomically and keeps the last valid optical state', async t => {
  const h = await createHarness(t);
  assert.equal(h.invoke('set-glass-settings', { mode: 'prominent', saturation: 180 }).ok, true);
  const expected = { ...DEFAULT_GLASS_SETTINGS, mode: 'prominent', saturation: 180 };
  for (const patch of [null, [], {}, 'standard', { mode: 'custom' }, { displacementScale: 201 }, { blurAmount: -0.1 }, { saturation: NaN }, { aberrationIntensity: Infinity }, { elasticity: '0.5' }, { cornerRadius: 101 }, { tintOpacity: 0.71 }, { overLight: 1 }, { desktopRefraction: 'false' }, { unknown: 1 }, { mode: 'shader', displacementScale: -1 }]) {
    assert.equal(h.invoke('set-glass-settings', patch).error, 'invalid-value');
    assert.deepEqual({ ...h.invoke('get-state').glass }, expected);
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(h.settings().glass, expected);
});

test('glass IPC rejects foreign web contents and subframes before mutating settings', async t => {
  const h = await createHarness(t);
  assert.throws(() => h.invoke('set-glass-settings', { mode: 'shader' }, { sender: {}, senderFrame: h.window.webContents.mainFrame }), /Untrusted IPC sender/u);
  assert.throws(() => h.invoke('set-glass-settings', { mode: 'shader' }, { sender: h.window.webContents, senderFrame: { url: h.window.webContents.mainFrame.url } }), /Untrusted IPC sender/u);
  assert.deepEqual({ ...h.invoke('get-state').glass }, DEFAULT_GLASS_SETTINGS);
});

test('content sizing near the bottom moves the shelf upward and preserves a usable header', async t => {
  const h = await createHarness(t);
  h.window.setPosition(12, h.area.height - 10);
  assert.equal(h.invoke('set-content-size', { width: 480, height: 700 }).ok, true);
  const bounds = h.window.getBounds();
  assert.ok(bounds.y < h.area.height - 10);
  assert.ok(bounds.height >= 64);
  assert.ok(bounds.y + bounds.height <= h.area.y + h.area.height - 8);
  assert.equal(h.invoke('set-content-size', { width: 100000, height: 100000 }).ok, true);
  assert.equal(h.window.getBounds().width, 900);
  assert.equal(h.invoke('set-content-size', { width: -1, height: -1 }).ok, true);
  assert.equal(h.window.getBounds().width, 340);
  assert.equal(h.window.getBounds().height, 64);
});

test('menu minimumHeight moves a low shelf upward enough to reveal the full menu', async t => {
  const h = await createHarness(t);
  h.window.setPosition(12, h.area.y + h.area.height - 10);
  assert.equal(h.invoke('set-content-size', { width: 504, height: 420, minimumHeight: 420 }).ok, true);
  const bounds = h.window.getBounds();
  assert.equal(bounds.height, 420);
  assert.ok(bounds.y + bounds.height <= h.area.y + h.area.height - 8);
  assert.ok(h.invoke('get-state').maxHeight >= 420);
});

test('oversized menu minimumHeight is capped safely to the monitor work area', async t => {
  const h = await createHarness(t, { workArea: { x: -1280, y: -100, width: 1280, height: 600 } });
  h.window.setPosition(-1200, 490);
  assert.equal(h.invoke('set-content-size', { width: 504, height: 2000, minimumHeight: 1024 }).ok, true);
  const bounds = h.window.getBounds();
  assert.ok(bounds.y >= h.area.y);
  assert.ok(bounds.y + bounds.height <= h.area.y + h.area.height - 8);
  assert.ok(bounds.height >= 64 && bounds.height <= h.area.height - 16);
});

test('interactive click-through events validate sender and boolean values, ignoring duplicates', async t => {
  const h = await createHarness(t);
  assert.equal(h.window.mouseCalls.length, 1);
  h.send('set-interactive', 'true');
  h.send('set-interactive', true, { sender: {}, senderFrame: h.window.webContents.mainFrame });
  assert.equal(h.window.mouseCalls.length, 1);
  h.send('set-interactive', true);
  assert.equal(h.window.mouseCalls.at(-1).ignore, false);
  h.send('set-interactive', true);
  assert.equal(h.window.mouseCalls.length, 2);
  h.send('set-interactive', false);
  assert.equal(h.window.mouseCalls.at(-1).ignore, true);
  assert.equal(h.window.mouseCalls.length, 3);
});

test('development IPC trusts only the configured local origin', async t => {
  const h = await createHarness(t, { devURL: 'http://127.0.0.1:5173/' });
  assert.equal(h.invoke('get-state').language, 'zh-CN');
  h.window.webContents.mainFrame.url = 'http://127.0.0.1:5173/another-local-route';
  assert.equal(h.invoke('get-state').collapsed, false);
  h.window.webContents.mainFrame.url = 'http://127.0.0.1:5174/';
  assert.throws(() => h.invoke('get-state'), /Untrusted IPC sender/u);
});

test('hit regions reject foreign senders, malformed arrays and unbounded rectangle values', async t => {
  const h = await createHarness(t);
  h.invoke('set-content-size', { width: 480, height: 200 });
  const header = { x: 0, y: 0, width: 220, height: 56, radius: 28 };
  h.send('set-hit-regions', [header]);
  const coveringGap = [{ x: 0, y: 0, width: 480, height: 200 }];
  h.send('set-hit-regions', coveringGap, { sender: {}, senderFrame: h.window.webContents.mainFrame });
  const invalid = [null, {}, Array(2049).fill(header), [{ ...header, x: NaN }], [{ ...header, y: Infinity }], [{ ...header, width: 20001 }], [{ ...header, x: -20001 }], [{ ...header, width: -1 }], [{ ...header, height: -1 }], [{ ...header, radius: -1 }], [{ ...header, radius: 10001 }], [{ ...header, radius: '28' }]];
  for (const regions of invalid) h.send('set-hit-regions', regions);
  h.cursorAt(100, 70);
  assert.equal(h.window.mouseCalls.at(-1).ignore, true, 'rejected regions cannot make the gap interactive');
  h.cursorAt(100, 28);
  assert.equal(h.window.mouseCalls.at(-1).ignore, false, 'the previous valid header remains interactive');
});

test('rounded hit testing activates pill centers while capsule corners and row gaps pass through', async t => {
  const h = await createHarness(t);
  h.invoke('set-content-size', { width: 480, height: 200 });
  h.send('set-hit-regions', [
    { x: 0, y: 0, width: 220, height: 56, radius: 28 },
    { x: 0, y: 80, width: 460, height: 64, radius: 32 },
  ]);
  h.cursorAt(110, 28);
  assert.equal(h.window.mouseCalls.at(-1).ignore, false);
  h.cursorAt(1, 1);
  assert.equal(h.window.mouseCalls.at(-1).ignore, true);
  h.cursorAt(100, 70);
  assert.equal(h.window.mouseCalls.at(-1).ignore, true);
  h.cursorAt(220, 112);
  assert.equal(h.window.mouseCalls.at(-1).ignore, false);
  h.cursorAt(479, 190);
  assert.equal(h.window.mouseCalls.at(-1).ignore, true);
});

test('hit regions clip to the content bounds and clearing them restores click-through', async t => {
  const h = await createHarness(t);
  h.invoke('set-content-size', { width: 480, height: 200 });
  h.send('set-hit-regions', [{ x: -20, y: -10, width: 60, height: 50, radius: 0 }]);
  h.cursorAt(20, 20);
  assert.equal(h.window.mouseCalls.at(-1).ignore, false);
  h.cursorAt(45, 20);
  assert.equal(h.window.mouseCalls.at(-1).ignore, true);
  h.cursorAt(20, 20);
  assert.equal(h.window.mouseCalls.at(-1).ignore, false);
  h.send('set-hit-regions', []);
  assert.equal(h.window.mouseCalls.at(-1).ignore, true);
});

test('desktop source IPC authenticates its caller and starts cursor-free native capture without thumbnails', async t => {
  const h = await createHarness(t);
  assert.throws(() => h.invoke('get-desktop-source', undefined, { sender: {}, senderFrame: h.window.webContents.mainFrame }), /Untrusted IPC sender/u);
  assert.throws(() => h.invoke('get-desktop-source', undefined, { sender: h.window.webContents, senderFrame: { url: h.window.webContents.mainFrame.url } }), /Untrusted IPC sender/u);
  assert.equal(h.sourceCalls.length, 0);
  const source = await h.invoke('get-desktop-source');
  assert.equal(source.ok, true);
  assert.equal(source.sourceId, undefined);
  assert.deepEqual(source.geometry.windowBounds, h.window.getBounds());
  assert.deepEqual(h.sourceCalls, []);
  assert.equal(h.nativeSessions.length, 1);
  h.window.setPosition(30, 40);
  h.window.setContentSize(600, 500);
  await h.invoke('get-desktop-source');
  assert.equal(h.nativeSessions.length, 1, 'moving and resizing reuse the active native capture');
  h.area.width = 1400;
  h.screen.emit('display-metrics-changed');
  const current = await h.invoke('get-desktop-source');
  assert.equal(current.geometry.windowBounds.x, 30);
  assert.equal(current.geometry.windowBounds.height, 500);
  assert.equal(current.geometry.display.width, 1400);
  assert.equal(h.nativeSessions.length, 2, 'display metric changes restart the native capture');
  assert.equal(h.nativeSessions[0].controller.closed, true);
  const nativeFrame = { id: 1, ntHandle: Buffer.alloc(8, 1), width: 1280, height: 800, timestamp: 100 };
  h.nativeSessions.at(-1).options.onFrame(nativeFrame);
  await tick();
  assert.equal(h.transfers.length, 1);
  assert.equal(h.transfers[0].options.importedSharedTexture.options.textureInfo.handle.ntHandle, nativeFrame.ntHandle);
  assert.deepEqual(h.nativeSessions.at(-1).controller.released, [1]);
  const messages = h.window.webContents.sentMessages;
  assert.ok(messages.some(message => message.channel === 'violet:desktop-geometry'));
  assert.equal(messages.some(message => message.channel === 'violet:desktop-frame' || JSON.stringify(message).includes('data:image/')), false);
});

test('desktop source refresh accepts only its narrow options and topology events invalidate its cache', async t => {
  const h = await createHarness(t);
  for (const value of [null, false, 'refresh', [], { refresh: 1 }, { refresh: null }, { refresh: undefined }, { unknown: true }, { refresh: true, sourceId: 'screen:99:0' }]) {
    assert.equal(h.invoke('get-desktop-source', value).error, 'invalid-desktop-source-request');
  }
  assert.equal(h.sourceCalls.length, 0);
  assert.equal((await h.invoke('get-desktop-source', {})).ok, true);
  assert.equal((await h.invoke('get-desktop-source', { refresh: false })).ok, true);
  assert.equal(h.nativeSessions.length, 1);
  assert.equal((await h.invoke('get-desktop-source', { refresh: true })).ok, true);
  assert.equal(h.nativeSessions.length, 2);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    h.screen.emit(event);
    assert.equal((await h.invoke('get-desktop-source')).ok, true);
  }
  assert.equal(h.nativeSessions.length, 5);
  assert.equal(h.invoke('stop-desktop-capture').ok, true);
  assert.equal(h.nativeSessions.at(-1).controller.closed, true);
});

test('desktop permission allows only video-only display capture by the trusted main frame', async t => {
  const h = await createHarness(t);
  const session = h.window.webContents.session;
  const details = { isMainFrame: true, requestingUrl: h.window.webContents.mainFrame.url, securityOrigin: 'file://' };
  const check = (permission = 'display-capture', patch = {}, contents = h.window.webContents, origin = 'file://') =>
    session.checkHandler(contents, permission, origin, { ...details, mediaType: 'video', ...patch });
  const request = (permission = 'display-capture', patch = {}, contents = h.window.webContents) => {
    let accepted;
    session.requestHandler(contents, permission, result => { accepted = result; }, { ...details, mediaTypes: ['video'], ...patch });
    return accepted;
  };
  assert.equal(check(), true);
  assert.equal(request(), true);
  for (const permission of ['media', 'geolocation', 'notifications', 'unknown']) {
    assert.equal(check(permission), false);
    assert.equal(request(permission), false);
  }
  for (const patch of [{ mediaType: 'audio' }, { mediaType: 'unknown' }, { mediaType: undefined }, { isMainFrame: false }, { requestingUrl: 'https://attacker.example/' }, { securityOrigin: 'https://attacker.example/' }]) assert.equal(check('display-capture', patch), false);
  for (const patch of [{ mediaTypes: ['audio'] }, { mediaTypes: ['video', 'audio'] }, { mediaTypes: [] }, { mediaTypes: undefined }, { isMainFrame: false }, { requestingUrl: 'https://attacker.example/' }, { securityOrigin: 'https://attacker.example/' }]) assert.equal(request('display-capture', patch), false);
  assert.equal(check('display-capture', {}, {}), false);
  assert.equal(request('display-capture', {}, {}), false);
  assert.equal(check('display-capture', {}, h.window.webContents, 'https://attacker.example/'), false);
  h.window.webContents.mainFrame.url = 'https://attacker.example/';
  assert.equal(check(), false);
  assert.equal(request(), false);
  h.window.webContents.mainFrame.url = details.requestingUrl;
  h.invoke('set-glass-settings', { desktopRefraction: false });
  assert.equal(check(), false);
  assert.equal(request(), false);
  assert.equal((await h.invoke('get-desktop-source')).error, 'desktop-capture-disabled');
  assert.equal(h.window.protectionCalls.at(-1), false);
  assert.equal(h.window.webContents.sentMessages.filter(message => message.channel === 'violet:desktop-geometry').at(-1).state, null);
});

test('development capture permissions stay on the configured local origin', async t => {
  const h = await createHarness(t, { devURL: 'http://127.0.0.1:5173/' });
  const session = h.window.webContents.session;
  const details = { isMainFrame: true, requestingUrl: h.window.webContents.mainFrame.url, mediaType: 'video' };
  assert.equal(session.checkHandler(h.window.webContents, 'display-capture', 'http://127.0.0.1:5173', details), true);
  assert.equal(session.checkHandler(h.window.webContents, 'display-capture', 'http://127.0.0.1:5174', details), false);
  assert.equal(session.checkHandler(h.window.webContents, 'display-capture', 'http://127.0.0.1:5173', { ...details, requestingUrl: 'http://127.0.0.1:5174/' }), false);
});

test('closing or quitting releases native self-exclusion and clears desktop geometry', async t => {
  for (const action of ['close', 'quit']) {
    const h = await createHarness(t);
    assert.equal(h.window.protectionCalls.at(-1), true);
    if (action === 'close') h.window.emit('closed'); else h.app.quit();
    assert.equal(h.window.protectionCalls.at(-1), false);
    assert.equal(h.window.webContents.sentMessages.filter(message => message.channel === 'violet:desktop-geometry').at(-1).state, null);
  }
});

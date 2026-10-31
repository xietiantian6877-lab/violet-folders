'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopSource } = require('../../electron/desktop-source.cjs');

function fixture(t, overrides = {}) {
  let bounds = { x: -1800, y: 60, width: 480, height: 300 };
  let display = { id: 42, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 };
  const geometries = [];
  const protections = [];
  const calls = [];
  const window = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    getNativeWindowHandle: () => Buffer.alloc(8, 1),
    setContentProtection: value => protections.push(value),
  };
  const desktopCapturer = {
    async getSources(options) {
      calls.push(options);
      return [
        { id: 'screen:99:0', display_id: '99' },
        { id: 'screen:42:0', display_id: '42', get thumbnail() { throw new Error('Pixels must never be accessed'); } },
      ];
    },
  };
  const source = new DesktopSource({ window, screen: { getDisplayMatching: () => display }, desktopCapturer,
    onGeometry: geometry => geometries.push(geometry), platform: 'win32', release: '10.0.19045',
    setProtection: (_handle, enabled) => { window.setContentProtection(enabled); return enabled ? 0x11 : 0; }, ...overrides });
  t.after(() => source.destroy());
  return { source, window, desktopCapturer, calls, protections, geometries,
    move: patch => { bounds = { ...bounds, ...patch }; },
    display: next => { display = next; },
  };
}

function protectionClock() {
  const pending = new Map();
  let sequence = 0;
  return {
    pending,
    setTimer(callback, delay) { const id = ++sequence; pending.set(id, { callback, delay }); return id; },
    clearTimer(id) { pending.delete(id); },
    next() {
      const [id, timer] = pending.entries().next().value;
      pending.delete(id);
      timer.callback();
      return timer.delay;
    },
  };
}

test('disabled source performs no enumeration and returns a clear disabled result', async t => {
  const h = fixture(t);
  assert.deepEqual(await h.source.getSource(), { ok: false, error: 'desktop-capture-disabled' });
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.geometries, []);
});

test('source selection excludes self first, selects exact screen and requests no thumbnails', async t => {
  const h = fixture(t);
  h.source.setEnabled(true);
  assert.deepEqual(h.protections, [true]);
  const result = await h.source.getSource();
  assert.deepEqual(h.calls, [{ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 0, height: 0 } }]);
  assert.deepEqual(result, {
    ok: true, sourceId: 'screen:42:0',
    geometry: { display: { id: '42', x: -1920, y: 0, width: 1920, height: 1080 }, windowBounds: { x: -1800, y: 60, width: 480, height: 300 } },
  });
  assert.equal(h.geometries.length, 1);
});

test('protection refresh reapplies exclusion to a newly shown widget and fails closed on errors', t => {
  const h = fixture(t);
  h.source.setEnabled(true);
  let nativeProtected = false;
  h.window.setContentProtection = value => { nativeProtected = value; };
  assert.ok(h.source.refreshProtection());
  assert.equal(nativeProtected, true);
  h.window.setContentProtection = () => { throw new Error('Widget unavailable'); };
  assert.equal(h.source.refreshProtection(), null);
  assert.equal(h.geometries.at(-1), null);
  h.source.setEnabled(false);
  nativeProtected = false;
  h.window.setContentProtection = value => { nativeProtected = value; };
  assert.equal(h.source.refreshProtection(), null);
  assert.equal(nativeProtected, false);
});

test('native exclusion rejects monitor-only affinity instead of trusting a toolkit boolean', t => {
  const h = fixture(t, { setProtection: () => 1 });
  h.source.setEnabled(true);
  assert.equal(h.source.refreshGeometry(), null);
  assert.equal(h.source.refreshProtection(), null);
  assert.equal(h.source.protected, false);
});

test('startup protection retries autonomously and publishes restored geometry without an IPC request', t => {
  const clock = protectionClock();
  let attempts = 0;
  const h = fixture(t, { setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    setProtection: (_handle, enabled) => !enabled ? 0 : ++attempts < 3 ? 1 : 0x11,
  });
  h.source.setEnabled(true);
  assert.equal(h.source.refreshGeometry(), null);
  assert.equal(clock.pending.size, 1);
  assert.equal(clock.next(), 100);
  assert.equal(h.geometries.length, 0);
  assert.equal(clock.next(), 250);
  assert.equal(attempts, 3);
  assert.equal(h.geometries.length, 1);
  assert.equal(h.geometries[0].display.id, '42');
  assert.equal(h.calls.length, 0);
  assert.equal(clock.pending.size, 0);
});

test('protection recovery wakes a renderer waiting for geometry and delivers its first frame automatically', async t => {
  const { startDesktopStream } = require('../../renderer/desktop-stream-controller.ts');
  const clock = protectionClock();
  const listeners = new Set();
  const updates = [];
  let attempts = 0, requests = 0, frameListener;
  const h = fixture(t, { setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    setProtection: (_handle, enabled) => !enabled ? 0 : ++attempts < 2 ? 1 : 0x11,
    onGeometry: geometry => { for (const listener of listeners) listener(geometry); },
  });
  h.source.setEnabled(true);
  const cleanup = startDesktopStream({
    async getSource() { requests += 1; return { ok: true, geometry: h.source.refreshGeometry() }; },
    async stopSource() {},
    onGeometry(callback) { listeners.add(callback); callback(null); return () => listeners.delete(callback); },
    onFrame(callback) { frameListener = callback; return () => {}; },
    update: optics => updates.push(optics),
  });
  t.after(cleanup);
  assert.equal(requests, 0);
  assert.equal(updates.at(-1).status, 'unavailable');
  clock.next();
  await Promise.resolve();
  assert.equal(requests, 1);
  frameListener({ clone: () => ({ close() {} }) }, h.source.refreshGeometry());
  assert.equal(updates.at(-1).status, 'ready');
  assert.equal(clock.pending.size, 0);
});

test('protection retries cap their delay, avoid duplicate timers and cancel on disable or destroy', t => {
  for (const action of ['disable', 'destroy']) {
    const clock = protectionClock();
    let attempts = 0;
    const h = fixture(t, { setTimer: clock.setTimer, clearTimer: clock.clearTimer,
      setProtection: (_handle, enabled) => { if (enabled) attempts += 1; return enabled ? 1 : 0; },
    });
    h.source.setEnabled(true);
    h.source.refreshProtection();
    assert.equal(clock.pending.size, 1);
    assert.deepEqual(Array.from({ length: 6 }, () => clock.next()), [100, 250, 500, 1000, 2000, 2000]);
    const late = clock.pending.values().next().value.callback;
    if (action === 'disable') h.source.setEnabled(false); else h.source.destroy();
    assert.equal(clock.pending.size, 0);
    const stoppedAttempts = attempts;
    late();
    assert.equal(attempts, stoppedAttempts);
    assert.equal(clock.pending.size, 0);
    if (action === 'disable') {
      h.source.setEnabled(true);
      const restartedAttempts = attempts;
      late();
      assert.equal(attempts, restartedAttempts);
      assert.equal(clock.pending.size, 1);
    }
  }
});

test('moves and resizes emit only changed geometry and reuse the cached stream source', async t => {
  const h = fixture(t);
  h.source.setEnabled(true);
  await h.source.getSource();
  h.source.refreshGeometry();
  assert.equal(h.geometries.length, 1);
  h.move({ x: -1700, width: 700 });
  h.source.refreshGeometry();
  const result = await h.source.getSource();
  assert.equal(h.calls.length, 1);
  assert.equal(h.geometries.length, 2);
  assert.equal(result.geometry.windowBounds.x, -1700);
  assert.equal(result.geometry.windowBounds.width, 700);
  assert.deepEqual(Object.keys(h.geometries[1]).sort(), ['display', 'windowBounds']);
});

test('changing screens invalidates the cache and never chooses the other screen as a fallback', async t => {
  const h = fixture(t);
  h.source.setEnabled(true);
  await h.source.getSource();
  h.display({ id: 99, bounds: { x: 0, y: -200, width: 2560, height: 1440 }, scaleFactor: 2 });
  h.move({ x: 100, y: -100 });
  h.source.refreshGeometry();
  const next = await h.source.getSource();
  assert.equal(h.calls.length, 2);
  assert.equal(next.sourceId, 'screen:99:0');
  assert.equal(next.geometry.display.id, '99');
  h.display({ id: 100, bounds: { x: 2560, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 });
  assert.equal((await h.source.getSource()).ok, false);
});

test('concurrent requests share a single pending enumeration', async t => {
  let resolve;
  let calls = 0;
  const h = fixture(t, { desktopCapturer: { getSources() { calls += 1; return new Promise(done => { resolve = done; }); } } });
  h.source.setEnabled(true);
  const first = h.source.getSource();
  const second = h.source.getSource();
  assert.equal(calls, 1);
  h.move({ x: -1600 });
  resolve([{ id: 'screen:42:0', display_id: '42' }]);
  const results = await Promise.all([first, second]);
  assert.ok(results.every(result => result.ok && result.geometry.windowBounds.x === -1600));
  assert.equal(calls, 1);
});

test('an in-flight screen transition discards old source and serializes the new lookup', async t => {
  const pending = [];
  const h = fixture(t, { desktopCapturer: { getSources: () => new Promise(resolve => pending.push(resolve)) } });
  h.source.setEnabled(true);
  const old = h.source.getSource();
  h.display({ id: 99, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 2 });
  h.source.refreshGeometry();
  const next = h.source.getSource();
  assert.equal(pending.length, 1);
  pending[0]([{ id: 'screen:42:0', display_id: '42' }]);
  assert.equal((await old).error, 'desktop-source-changed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1]([{ id: 'screen:99:0', display_id: '99' }]);
  assert.equal((await next).sourceId, 'screen:99:0');
});

test('disable releases self-exclusion, clears geometry and invalidates source cache', async t => {
  const h = fixture(t);
  h.source.setEnabled(true);
  await h.source.getSource();
  h.source.setEnabled(false);
  assert.deepEqual(h.protections, [true, false]);
  assert.equal(h.geometries.at(-1), null);
  assert.equal((await h.source.getSource()).ok, false);
  h.source.setEnabled(true);
  await h.source.getSource();
  assert.equal(h.calls.length, 2);
});

test('disabled or destroyed pending enumeration never returns a usable source', async t => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    const h = fixture(t, { desktopCapturer: { getSources: () => new Promise(done => { resolve = done; }) } });
    h.source.setEnabled(true);
    const request = h.source.getSource();
    if (action === 'disable') h.source.setEnabled(false); else h.source.destroy();
    resolve([{ id: 'screen:42:0', display_id: '42' }]);
    assert.equal((await request).ok, false);
    assert.equal(h.geometries.at(-1), null);
    assert.deepEqual(h.protections, [true, false]);
  }
});

test('unsupported self-exclusion, rejected enumeration and non-screen ids fail without pixels', async t => {
  const old = fixture(t, { release: '10.0.18363' });
  old.source.setEnabled(true);
  assert.equal((await old.source.getSource()).ok, false);
  assert.equal(old.calls.length, 0);
  for (const getSources of [async () => { throw new Error('Denied'); }, async () => [{ id: 'window:42:0', display_id: '42' }]]) {
    const h = fixture(t, { desktopCapturer: { getSources } });
    h.source.setEnabled(true);
    assert.deepEqual(await h.source.getSource(), { ok: false, error: 'desktop-capture-unavailable' });
  }
});

test('consumer mutation cannot corrupt subsequent geometry', async t => {
  const h = fixture(t);
  h.source.setEnabled(true);
  h.geometries[0].windowBounds.x = 99999;
  const result = await h.source.getSource();
  result.geometry.display.id = 'corrupted';
  assert.equal((await h.source.getSource()).geometry.display.id, '42');
  assert.equal(h.source.refreshGeometry().windowBounds.x, -1800);
});

test('topology invalidation and a renderer refresh enumerate the same display again', async t => {
  const h = fixture(t);
  h.source.setEnabled(true);
  await h.source.getSource();
  h.source.invalidateSource();
  await h.source.getSource();
  await h.source.getSource(true);
  assert.equal(h.calls.length, 3);
  assert.equal(h.geometries.length, 1);
});

test('a refresh during enumeration discards its old source and serializes a fresh lookup', async t => {
  const pending = [];
  const h = fixture(t, { desktopCapturer: { getSources: () => new Promise(resolve => pending.push(resolve)) } });
  h.source.setEnabled(true);
  const old = h.source.getSource();
  const refreshed = h.source.getSource(true);
  assert.equal(pending.length, 1);
  pending[0]([{ id: 'screen:42:0', display_id: '42' }]);
  assert.equal((await old).error, 'desktop-source-changed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1]([{ id: 'screen:42:1', display_id: '42' }]);
  assert.equal((await refreshed).sourceId, 'screen:42:1');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NativeDesktopCapture } = require('../../electron/native-desktop-capture.cjs');
const geometry = (id = '42', x = 0) => ({ display: { id, x, y: 0, width: 1920, height: 1080 }, windowBounds: { x: x + 12, y: 12, width: 480, height: 300 } });

function fixture(t, overrides = {}) {
  let current = geometry();
  const events = [], sessions = [], frames = [];
  const source = { enabled: true, refreshGeometry: () => current,
    refreshProtection() { events.push('protection-applied'); return current; },
  };
  const capture = new NativeDesktopCapture({
    window: { getNativeWindowHandle: () => Buffer.alloc(8) }, source,
    settle: async () => { events.push('composition-settled'); if (overrides.settle) await overrides.settle(); },
    createCapture(options) {
      events.push('capture-created');
      const controller = { cursorCaptureEnabled: false, closes: 0, released: [], close() { this.closes += 1; }, releaseFrame(id) { this.released.push(id); }, ...overrides.controller };
      sessions.push({ options, controller }); return controller;
    },
    onFrame(value) { frames.push(value); if (overrides.onFrame) overrides.onFrame(value); },
  });
  t.after(() => capture.destroy());
  return { capture, source, events, sessions, frames,
    geometry(value) { current = value; capture.geometryChanged(value); },
  };
}

test('native capture waits for exclusion composition and enforces the actual cursor-disabled flag', async t => {
  const h = fixture(t);
  assert.equal((await h.capture.start()).ok, true);
  assert.deepEqual(h.events, ['protection-applied', 'composition-settled', 'capture-created']);
  const wrong = fixture(t, { controller: { cursorCaptureEnabled: true } });
  assert.equal((await wrong.capture.start()).ok, false);
  assert.equal(wrong.sessions[0].controller.closes, 1);
});

test('concurrent starts share the session and same-monitor movement only changes frame geometry', async t => {
  const h = fixture(t);
  const results = await Promise.all([h.capture.start(), h.capture.start()]);
  assert.ok(results.every(result => result.ok));
  assert.equal(h.sessions.length, 1);
  h.geometry(geometry('42', 30));
  h.sessions[0].options.onFrame({ id: 1 });
  assert.equal(h.frames[0].geometry.windowBounds.x, 42);
  assert.equal(h.sessions.length, 1);
  h.frames[0].release(); h.frames[0].release();
  assert.deepEqual(h.sessions[0].controller.released, [1]);
});

test('disable and monitor changes stop capture, and old callbacks release without delivery', async t => {
  const h = fixture(t);
  await h.capture.start();
  h.source.enabled = false; h.geometry(null);
  assert.equal(h.sessions[0].controller.closes, 1);
  h.sessions[0].options.onFrame({ id: 1 });
  assert.equal(h.frames.length, 0);
  assert.deepEqual(h.sessions[0].controller.released, [1]);
  assert.equal((await h.capture.start()).error, 'desktop-capture-disabled');
  h.source.enabled = true; h.geometry(geometry('99', 1920));
  assert.equal((await h.capture.start()).ok, true);
  assert.equal(h.sessions.length, 2);
});

test('refresh replaces a session and in-flight GPU frames remain releasable after close', async t => {
  const h = fixture(t);
  await h.capture.start();
  h.sessions[0].options.onFrame({ id: 3 });
  await h.capture.start(true);
  assert.equal(h.sessions[0].controller.closes, 1);
  assert.deepEqual(h.sessions[0].controller.released, []);
  h.frames[0].release();
  assert.deepEqual(h.sessions[0].controller.released, [3]);
  assert.equal(h.sessions.length, 2);
});

test('cancelled composition waits cannot start a stale or disabled native session', async t => {
  const pending = [];
  const h = fixture(t, { settle: () => new Promise(resolve => pending.push(resolve)) });
  const old = h.capture.start();
  h.capture.stop();
  const next = h.capture.start();
  pending[0]();
  assert.equal((await old).error, 'desktop-source-changed');
  assert.equal(h.sessions.length, 0);
  pending[1]();
  assert.equal((await next).ok, true);
  assert.equal(h.sessions.length, 1);
});

test('a surface failure releases its frame exactly once', async t => {
  const h = fixture(t, { onFrame: () => { throw new Error('Renderer disconnected'); } });
  await h.capture.start();
  h.sessions[0].options.onFrame({ id: 1 });
  assert.deepEqual(h.sessions[0].controller.released, [1]);
});

test('a moved window asks the active capture for one fresh desktop sample', async t => {
  let requests = 0;
  const h = fixture(t, { controller: { requestFrame() { requests += 1; } } });
  h.capture.requestFrame();
  assert.equal(requests, 0, 'nothing to refresh before capture starts');
  assert.equal((await h.capture.start()).ok, true);
  h.capture.requestFrame();
  assert.equal(requests, 1);
  h.capture.stop();
  h.capture.requestFrame();
  assert.equal(requests, 1, 'a stopped capture is not refreshed');
});

test('frame rate settings become native frame intervals, including unlimited', async t => {
  const intervals = [];
  const h = fixture(t, { controller: { setFrameInterval(ms) { intervals.push(ms); } } });
  h.capture.setFrameRate(30);
  assert.equal((await h.capture.start()).ok, true);
  h.capture.setFrameRate(60);
  h.capture.setFrameRate(0);
  assert.deepEqual(intervals, [33, 16, 0]);
});

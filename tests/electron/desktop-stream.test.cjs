'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startDesktopStream } = require('../../renderer/desktop-stream-controller.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const geometry = (id = '42', x = 0) => ({ display: { id, x, y: 0, width: 1920, height: 1080 }, windowBounds: { x: x + 12, y: 12, width: 480, height: 300 } });
function frame() {
  return { displayWidth: 1920, displayHeight: 1080, clones: [], closes: 0,
    clone() { const retained = frame(); this.clones.push(retained); return retained; },
    close() { this.closes += 1; },
  };
}

function fixture(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [], updates = [];
  let onGeometry, onFrame, stops = 0, current = geometry();
  const stop = startDesktopStream({
    async getSource(options) { requests.push(options); return overrides.getSource ? overrides.getSource(options) : { ok: true, geometry: current }; },
    async stopSource() { stops += 1; },
    onGeometry(callback) { onGeometry = callback; return () => { onGeometry = undefined; }; },
    onFrame(callback) { onFrame = callback; return () => { onFrame = undefined; }; },
    update: value => updates.push(value),
  });
  t.after(stop);
  return { requests, updates, stop, stops: () => stops,
    emit(value) { if (value) current = value; onGeometry?.(value); },
    frame(value = frame(), capturedGeometry = current) { onFrame?.(value, capturedGeometry); return value; },
    latest: () => updates.at(-1),
    async advance(milliseconds) { t.mock.timers.tick(milliseconds); await tick(); },
  };
}

test('source becomes ready only after a frame and same-monitor movement keeps its stable reference', async t => {
  const h = fixture(t);
  await tick();
  assert.equal(h.latest().status, 'starting');
  h.frame();
  const source = h.latest().source;
  assert.equal(h.latest().status, 'ready');
  h.emit(geometry('42', 20));
  assert.equal(h.latest().source, source);
  assert.equal(h.latest().geometry.windowBounds.x, 32);
  assert.equal(h.requests.length, 1);
  h.stop();
  assert.equal(h.stops(), 1);
});

test('frame hub delivers synchronously without React updates and isolates a failing surface', async t => {
  const h = fixture(t);
  await tick(); h.frame();
  let received;
  h.latest().source.subscribe(() => { throw new Error('Detached canvas'); });
  const unsubscribe = h.latest().source.subscribe((frame, geometry) => { received = { frame, geometry }; });
  const count = h.updates.length;
  const frame = h.frame();
  assert.equal(received.frame, frame);
  assert.equal(received.geometry.display.id, '42');
  assert.equal(h.updates.length, count);
  unsubscribe(); received = undefined; h.frame();
  assert.equal(received, undefined);
});

test('temporary capture failures retry with backoff and fresh source selection', async t => {
  let attempts = 0;
  const h = fixture(t, { getSource: async () => ++attempts < 3 ? { ok: false, error: 'desktop-capture-unavailable' } : { ok: true, geometry: geometry() } });
  await tick();
  assert.equal(h.latest().status, 'unavailable');
  await h.advance(499); assert.equal(h.requests.length, 1);
  await h.advance(1); assert.deepEqual(h.requests[1], { refresh: true });
  await h.advance(999); assert.equal(h.requests.length, 2);
  await h.advance(1); h.frame();
  assert.equal(h.latest().status, 'ready');
});

test('a capture with no first frame restarts, while a ready static desktop stays connected', async t => {
  const h = fixture(t);
  await tick();
  await h.advance(2500);
  assert.equal(h.latest().status, 'unavailable');
  await h.advance(500); h.frame();
  assert.equal(h.latest().status, 'ready');
  await h.advance(30000);
  assert.equal(h.requests.length, 2);
});

test('null geometry cancels retry and restoring geometry reconnects', async t => {
  let attempts = 0;
  const h = fixture(t, { getSource: async () => ++attempts === 1 ? { ok: false, error: 'desktop-capture-unavailable' } : { ok: true, geometry: geometry() } });
  await tick(); h.emit(null); await h.advance(30000);
  assert.equal(h.requests.length, 1);
  h.emit(geometry()); await tick(); h.frame();
  assert.equal(h.requests.length, 2);
  assert.equal(h.latest().status, 'ready');
});

test('late source responses and frames cannot revive a previous monitor', async t => {
  let resolveOld, attempts = 0;
  const h = fixture(t, { getSource: () => ++attempts === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ ok: true, geometry: geometry('99', 1920) }) });
  h.emit(null); h.emit(geometry('99', 1920)); await tick();
  h.frame(frame(), geometry('42'));
  assert.equal(h.latest().status, 'starting');
  resolveOld({ ok: true, geometry: geometry('42') }); await tick();
  h.frame(frame(), geometry('99', 1920));
  assert.equal(h.latest().status, 'ready');
  assert.equal(h.latest().geometry.display.id, '99');
});

test('pending source responses preserve newer movement geometry', async t => {
  let resolve;
  const h = fixture(t, { getSource: () => new Promise(done => { resolve = done; }) });
  h.emit(geometry('42', 30));
  resolve({ ok: true, geometry: geometry() }); await tick(); h.frame();
  assert.equal(h.latest().geometry.windowBounds.x, 42);
});

test('persistent failures cap backoff and cleanup cancels future attempts', async t => {
  const h = fixture(t, { getSource: async () => { throw new Error('Driver unavailable'); } });
  await tick();
  for (const delay of [500, 1000, 2000, 4000, 8000, 8000]) await h.advance(delay);
  assert.equal(h.requests.length, 7);
  h.stop(); await h.advance(30000);
  assert.equal(h.requests.length, 7);
});

test('desktop-source-changed retries quickly and disabled capture waits for restoration', async t => {
  let attempts = 0;
  const h = fixture(t, { getSource: async () => ({ ok: false, error: ++attempts === 1 ? 'desktop-source-changed' : 'desktop-capture-disabled' }) });
  await tick(); await h.advance(199); assert.equal(h.requests.length, 1);
  await h.advance(1); assert.equal(h.requests.length, 2);
  assert.equal(h.latest().status, 'unavailable');
  await h.advance(30000); assert.equal(h.requests.length, 2);
});

test('a surface subscribing after the only desktop frame immediately receives the retained first frame', async t => {
  const h = fixture(t);
  await tick();
  const original = h.frame();
  let received;
  h.latest().source.subscribe((value, sampledGeometry) => { received = { value, sampledGeometry }; });
  assert.equal(received.value, original.clones[0]);
  assert.notEqual(received.value, original);
  assert.equal(received.sampledGeometry.display.id, '42');
  assert.equal(received.value.closes, 0);
  await h.advance(30000);
  assert.equal(h.requests.length, 1);
});

test('cache replacement closes its prior clone and still broadcasts each original frame', async t => {
  const h = fixture(t);
  await tick();
  const first = h.frame();
  const received = [];
  h.latest().source.subscribe(value => received.push(value));
  const second = h.frame();
  assert.equal(first.clones[0].closes, 1);
  assert.equal(second.clones[0].closes, 0);
  assert.equal(first.closes, 0);
  assert.equal(second.closes, 0);
  assert.deepEqual(received, [first.clones[0], second]);
  h.stop();
  assert.equal(second.clones[0].closes, 1);
});

test('late subscriptions use current geometry and isolate cache callback exceptions', async t => {
  const h = fixture(t);
  await tick();
  const original = h.frame();
  const source = h.latest().source;
  h.emit(geometry('42', 230));
  assert.doesNotThrow(() => source.subscribe(() => { throw new Error('Unmounted surface'); }));
  let sampled;
  source.subscribe((value, currentGeometry) => { sampled = { value, currentGeometry }; });
  assert.equal(sampled.value, original.clones[0]);
  assert.equal(sampled.currentGeometry.windowBounds.x, 242);
  assert.equal(sampled.value.closes, 0);
});

test('geometry loss and monitor changes immediately release cached frames before reconnecting', async t => {
  const h = fixture(t);
  await tick();
  const initial = h.frame();
  const source = h.latest().source;
  h.emit(null);
  assert.equal(initial.clones[0].closes, 1);
  let calls = 0;
  source.subscribe(() => { calls += 1; });
  assert.equal(calls, 0);
  h.emit(geometry('42')); await tick();
  const restored = h.frame();
  h.emit(geometry('99', 1920));
  assert.equal(restored.clones[0].closes, 1);
  await tick();
  const moved = h.frame();
  h.stop(); h.stop();
  assert.equal(moved.clones[0].closes, 1);
  const afterStop = calls;
  source.subscribe(() => { calls += 1; });
  assert.equal(calls, afterStop);
});

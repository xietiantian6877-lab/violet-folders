'use strict';

const path = require('node:path');

// Desktop Duplication leaves independent hardware cursors out of the texture.
// Only shared GPU handles cross processes; textures live until Chromium releases them.
class NativeDesktopCapture {
  constructor({ window, source, onFrame, createCapture, settle = () => new Promise(resolve => setTimeout(resolve, 100)) }) {
    this.window = window;
    this.source = source;
    this.onFrame = onFrame;
    this.createCapture = createCapture || (options => require(path.join(__dirname, '..', 'native', 'desktop-capture', 'build', 'desktop_capture.node')).createCapture(options));
    this.settle = settle;
    this.active = null;
    this.pending = null;
    this.revision = 0;
    this.destroyed = false;
  }

  geometryChanged(geometry) {
    if (!geometry || (this.active && this.active.displayId !== geometry.display.id) ||
      (this.pending && this.pending.displayId !== geometry.display.id)) this.stop();
  }

  async start(refresh = false) {
    if (this.destroyed) return { ok: false, error: 'desktop-capture-unavailable' };
    const geometry = this.source.refreshProtection();
    if (!geometry) return { ok: false, error: this.source.enabled ? 'desktop-capture-unavailable' : 'desktop-capture-disabled' };
    if (refresh) this.stop();
    if (this.active?.displayId === geometry.display.id) return { ok: true, geometry };
    if (this.pending) return this.pending.promise;
    const pending = { displayId: geometry.display.id, revision: ++this.revision, promise: null };
    pending.promise = this._start(pending).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending.promise;
  }

  async _start(request) {
    // Let Windows remove the protected window from desktop composition first.
    // The native addon also DwmFlushes before opening Desktop Duplication.
    await this.settle();
    if (this.destroyed || request.revision !== this.revision) return { ok: false, error: 'desktop-source-changed' };
    const geometry = this.source.refreshGeometry();
    if (!geometry || geometry.display.id !== request.displayId) return { ok: false, error: 'desktop-source-changed' };
    try {
      const active = { displayId: request.displayId, controller: null };
      active.controller = this.createCapture({
        windowHandle: this.window.getNativeWindowHandle(),
        onFrame: frame => {
          let released = false;
          const release = () => { if (!released) { released = true; active.controller?.releaseFrame(frame.id); } };
          if (this.destroyed || this.active !== active) { release(); return; }
          const current = this.source.refreshGeometry();
          if (!current || current.display.id !== active.displayId) { release(); return; }
          try { this.onFrame({ frame, geometry: current, release }); }
          catch { release(); }
        },
      });
      if (active.controller.cursorCaptureEnabled !== false) {
        active.controller.close();
        throw new Error('Cursor-free desktop capture is required');
      }
      this.active = active;
      return { ok: true, geometry };
    } catch (error) {
      console.error('Violet desktop capture unavailable:', error?.message || 'Unknown capture error');
      return { ok: false, error: 'desktop-capture-unavailable' };
    }
  }

  stop() {
    ++this.revision;
    this.pending = null;
    const active = this.active;
    this.active = null;
    try { active?.controller.close(); } catch { /* A removed monitor must not block cleanup. */ }
  }

  destroy() { this.destroyed = true; this.stop(); }
}

module.exports = { NativeDesktopCapture };

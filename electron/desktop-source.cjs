'use strict';

const os = require('node:os');
const path = require('node:path');

function rectangle(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) || value.width <= 0 || value.height <= 0) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function copyGeometry(geometry) {
  return geometry ? { display: { ...geometry.display }, windowBounds: { ...geometry.windowBounds } } : null;
}

// Owns monitor geometry and native self-exclusion. The capture controller sends
// shared GPU textures separately; movement only needs these DIP rectangles.
class DesktopSource {
  constructor({ window, screen, desktopCapturer, onGeometry, setProtection, setTimer = setTimeout, clearTimer = clearTimeout, platform = process.platform, release = os.release() }) {
    this.window = window;
    this.screen = screen;
    this.desktopCapturer = desktopCapturer;
    this.onGeometry = onGeometry;
    this.setProtection = setProtection || ((handle, enabled) => require(path.join(__dirname, '..', 'native', 'desktop-capture', 'build', 'desktop_capture.node')).setWindowCaptureExcluded(handle, enabled));
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.protectionRetry = null;
    this.protectionFailures = 0;
    this.protectionRevision = 0;
    this.supported = platform === 'win32' && Number(release.split('.')[2]) >= 19041;
    this.enabled = false;
    this.protected = false;
    this.destroyed = false;
    this.generation = 0;
    this.geometry = null;
    this.cachedSource = null;
    this.inFlight = null;
  }

  _protect(value) {
    if (!this.window || this.window.isDestroyed()) { this.protected = false; this._cancelProtectionRetry(); return; }
    if (value && !this.supported) return;
    try {
      const affinity = this.setProtection(this.window.getNativeWindowHandle(), value);
      this.protected = value && affinity === 0x11;
    } catch (error) {
      this.protected = false;
      console.error('Violet desktop exclusion unavailable:', error?.message || 'Unknown exclusion error');
    }
    if (!value || this.protected) this._cancelProtectionRetry();
    else this._retryProtection();
  }

  _cancelProtectionRetry() {
    this.protectionRevision += 1;
    if (this.protectionRetry !== null) this.clearTimer(this.protectionRetry);
    this.protectionRetry = null;
    this.protectionFailures = 0;
  }

  _retryProtection() {
    if (!this.enabled || !this.supported || this.destroyed || this.protectionRetry !== null) return;
    const delays = [100, 250, 500, 1000, 2000];
    const delay = delays[Math.min(this.protectionFailures++, delays.length - 1)];
    const revision = this.protectionRevision;
    this.protectionRetry = this.setTimer(() => {
      if (revision !== this.protectionRevision) return;
      this.protectionRetry = null;
      if (!this.enabled || this.destroyed || !this.window || this.window.isDestroyed()) return;
      this._protect(true);
      // The renderer may be waiting for geometry after startup protection
      // failed. A successful retry must wake it without another IPC request.
      this.refreshGeometry();
    }, delay);
    this.protectionRetry?.unref?.();
  }

  _emit(geometry) {
    if (this.destroyed) return;
    try { this.onGeometry(copyGeometry(geometry)); } catch { /* Renderer teardown cannot prevent native cleanup. */ }
  }

  _readGeometry() {
    if (!this.enabled || !this.protected || this.destroyed || !this.window || this.window.isDestroyed()) return null;
    try {
      const windowBounds = rectangle(this.window.getBounds());
      if (!windowBounds) return null;
      const display = this.screen.getDisplayMatching(windowBounds);
      const bounds = rectangle(display?.bounds);
      if (!bounds || display.id === undefined || display.id === null) return null;
      return { display: { id: String(display.id), ...bounds }, windowBounds };
    } catch { return null; }
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.destroyed || next === this.enabled) return;
    this.enabled = next;
    this.generation += 1;
    this.cachedSource = null;
    this._protect(next);
    if (!next) {
      this.geometry = null;
      this._emit(null);
      return;
    }
    this.refreshGeometry();
  }

  refreshGeometry() {
    if (this.destroyed) return null;
    const next = this._readGeometry();
    if (this.geometry?.display.id !== next?.display.id) {
      this.cachedSource = null;
      this.generation += 1;
    }
    if (JSON.stringify(next) !== JSON.stringify(this.geometry)) {
      this.geometry = next;
      this._emit(next);
    }
    return copyGeometry(next);
  }

  refreshProtection() {
    if (this.destroyed) return null;
    // A transparent window may acquire its final native widget only when it is
    // shown. Reapply to that widget instead of trusting the earlier JS flag.
    if (this.enabled) this._protect(true);
    return this.refreshGeometry();
  }

  _failure() {
    return { ok: false, error: !this.enabled ? 'desktop-capture-disabled' : 'desktop-capture-unavailable' };
  }

  invalidateSource() {
    if (this.destroyed) return;
    this.cachedSource = null;
    this.generation += 1;
  }

  async getSource(refresh = false) {
    if (refresh) this.invalidateSource();
    const geometry = this.refreshGeometry();
    if (!geometry || typeof this.desktopCapturer?.getSources !== 'function') return this._failure();
    const displayId = geometry.display.id;
    if (this.cachedSource?.displayId === displayId) {
      return { ok: true, sourceId: this.cachedSource.sourceId, geometry };
    }
    if (this.inFlight) {
      const active = this.inFlight;
      const result = await active.promise;
      const latest = this.refreshGeometry();
      if (!latest) return this._failure();
      // A disable/re-enable or monitor transition may happen while source
      // enumeration is pending. Wait for it, then select the current screen.
      if (active.generation !== this.generation || active.displayId !== latest.display.id) return this.getSource();
      return result.ok ? { ...result, geometry: latest } : result;
    }
    const request = { displayId, generation: this.generation, promise: null };
    request.promise = this._loadSource(request).finally(() => { if (this.inFlight === request) this.inFlight = null; });
    this.inFlight = request;
    return request.promise;
  }

  async _loadSource(request) {
    try {
      const sources = await this.desktopCapturer.getSources({
        types: ['screen'], fetchWindowIcons: false,
        // This is source enumeration, not the old thumbnail capture loop.
        thumbnailSize: { width: 0, height: 0 },
      });
      const geometry = this.refreshGeometry();
      if (!geometry) return this._failure();
      if (request.generation !== this.generation || request.displayId !== geometry.display.id) return { ok: false, error: 'desktop-source-changed' };
      const source = sources.find(candidate => candidate.display_id === request.displayId);
      if (!source || typeof source.id !== 'string' || !/^screen:[^\s]+$/u.test(source.id)) return this._failure();
      this.cachedSource = { displayId: request.displayId, sourceId: source.id };
      return { ok: true, sourceId: source.id, geometry };
    } catch { return this._failure(); }
  }

  destroy() {
    if (this.destroyed) return;
    this.enabled = false;
    this.generation += 1;
    this.cachedSource = null;
    this.geometry = null;
    this._protect(false);
    this._emit(null);
    this.destroyed = true;
  }
}

module.exports = { DesktopSource };

'use strict';

const { app, BrowserWindow } = require('electron');
const { createCapture, setWindowCaptureExcluded } = require('./build/desktop_capture.node');
const path = require('node:path');
const os = require('node:os');

app.setName('Violet Native Capture Smoke');
app.setPath('userData', path.join(os.tmpdir(), 'violet-native-capture-smoke'));

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 120, height: 80, x: -32000, y: -32000, show: false, frame: false, transparent: true, skipTaskbar: true });
  await window.loadURL('data:text/html,<body style="margin:0;background:transparent"></body>');
  window.showInactive();
  const handle = window.getNativeWindowHandle();
  if (setWindowCaptureExcluded(handle, true) !== 0x11) throw new Error('Native exclusion did not read back as 0x11');
  if (setWindowCaptureExcluded(handle, false) !== 0) throw new Error('Native exclusion could not be cleared');
  if (setWindowCaptureExcluded(handle, true) !== 0x11) throw new Error('Native exclusion did not restore');
  window.setIgnoreMouseEvents(true, { forward: true });
  const repeatedClickThroughExclusion = setWindowCaptureExcluded(handle, true) === 0x11;
  if (!repeatedClickThroughExclusion) throw new Error('Click-through lost the native exclusion flag');
  window.setIgnoreMouseEvents(false);
  await new Promise(resolve => setTimeout(resolve, 150));
  let controller;
  let count = 0;
  const started = Date.now();
  const held = [];
  let backpressureVerified = false;
  const timeout = setTimeout(() => { console.error('No clean Desktop Duplication frames arrived.'); controller?.close(); app.exit(1); }, 8000);
  controller = createCapture({ windowHandle: window.getNativeWindowHandle(), onFrame(frame) {
    if (!Buffer.isBuffer(frame.ntHandle) || frame.ntHandle.length !== 8 || frame.width <= 0 || frame.height <= 0) {
      console.error('Malformed native frame'); app.exit(1); return;
    }
    count += 1;
    if (!backpressureVerified) {
      held.push(frame.id);
      if (count === 3) setTimeout(() => {
        if (count !== 3) { console.error('Native capture exceeded three in-flight frames.'); app.exit(1); return; }
        backpressureVerified = true;
        held.forEach(id => controller.releaseFrame(id));
      }, 200);
      return;
    }
    if (count === 30) {
      clearTimeout(timeout);
      controller.close();
      setTimeout(() => {
        controller.releaseFrame(frame.id);
        const exclusionCleared = setWindowCaptureExcluded(handle, false) === 0;
        console.log(JSON.stringify({ frames: count, width: frame.width, height: frame.height, elapsedMs: Date.now() - started, backend: controller.backend, cursorCaptureEnabled: controller.cursorCaptureEnabled, captureExcluded: controller.captureExcluded, displayAffinity: controller.displayAffinity, backpressureVerified, nativeExclusionVerified: true, repeatedClickThroughExclusion, exclusionCleared, releaseAfterClose: true }));
        window.destroy(); app.exit(0);
      }, 50);
    } else controller.releaseFrame(frame.id);
  } });
  if (controller.cursorCaptureEnabled !== false) throw new Error('Desktop Duplication must not compose a cursor');
  if (controller.backend !== 'dxgi-desktop-duplication') throw new Error('Expected the border-free Desktop Duplication backend');
  if (controller.captureExcluded !== true || controller.displayAffinity !== 0x11) throw new Error('Capture did not establish native window exclusion');
}).catch(error => { console.error(error); app.exit(1); });

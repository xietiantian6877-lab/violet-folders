# DXGI desktop duplication

Build with `node scripts/build-native-capture.mjs` on Windows x64. The build needs
MSVC, a Windows SDK with C++/WinRT, and the Node headers cached by node-gyp.
`NODE_HEADERS_DIR` can select a different headers directory.

The N-API module exports `createCapture({windowHandle, onFrame})`. Pass Electron's
`BrowserWindow.getNativeWindowHandle()` and keep the returned controller alive.
The controller provides `close()` and `releaseFrame(id)`, plus the read-only
`backend: 'dxgi-desktop-duplication'` and `cursorCaptureEnabled: false` properties.
It never opens a Windows Graphics Capture session or composites a separate
pointer. The API reports backend behavior rather than a WGC session flag.

`onFrame` receives `{id, ntHandle, width, height, timestamp}`. `ntHandle` is a
process-local NT texture handle suitable for Electron's `sharedTexture` import.
Frames are BGRA GPU textures; no pixel readback or encoded frame transport occurs.
Call `releaseFrame(id)` only after Electron's `allReferencesReleased` callback.
At most three textures can be outstanding, so slow consumers drop frames.

Capture follows the monitor containing the supplied window when created. Reopen
the session when the window changes monitors or display topology changes. The
matching DXGI output and its own adapter create the D3D11 device. Access loss and
device resets trigger bounded retries to recreate duplication.

DXGI can supply a separate pointer or an image with an embedded software pointer.
The module caches pointer metadata and checks the current cursor when needed;
ambiguous visible-pointer frames are discarded instead of composited. This can
pause updates on unsupported drivers. Rotated outputs and system-memory desktop
images currently fail safely rather than returning misaligned or cursor-bearing
frames. The selected monitor must expose a GPU BGRA desktop surface.

`setWindowCaptureExcluded(handle, enabled)` directly sets and reads back the
window's display affinity. The shelf reapplies it after showing and before
capture; `createCapture` also requires the exact `WDA_EXCLUDEFROMCAPTURE` value.
Clearing it returns `WDA_NONE`. A cached Electron content-protection request is
not used as proof of native exclusion.

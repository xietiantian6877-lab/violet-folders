# Violet Folders · 紫璃文件夹

A Windows folder shelf built with **Electron + React + TypeScript**, using [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) for its glass UI. Opening a folder in File Explorer adds an independent purple glass row near the top-left edge of your desktop. Click to return; pin to keep a folder available.

[简体中文](README.md)

![Violet Folders with live desktop refraction on a dark background](docs/images/glass-shelf-dark.png)

All screenshots show the real Windows desktop with **live desktop refraction enabled**; the folder paths are demo data.

| Light background · black text locked · blur 0 | Liquid glass settings |
| --- | --- |
| ![Light background with black text locked](docs/images/glass-shelf-light.png) | ![Liquid glass settings panel](docs/images/glass-controls.png) |

## What's new in 1.3

- **Much lighter**: the desktop sample refreshes only when the area behind the glass actually changes. Video or animation elsewhere on screen no longer costs anything (measured: about one CPU core down to about 2%). A loop where the shelf's own repaint counted as a desktop change is also gone.
- **Adjustable frame rate**: 30 / 60 / 120 / no limit, default 60.
- **Clear mode**: with blur at 0 there is no hidden minimum blur, so desktop text behind the glass stays sharp.
- **Lockable text colour**: auto / white / black. Locking also skips background brightness sampling.
- **No more jitter at screen edges**: dragging is clamped to the work area on every step, so the shelf slides along edges smoothly. Double-click the header to fold.
- **Press-and-hold to reorder**: hold a folder row for about 0.3 s, drag it, and the other rows glide aside; the list auto-scrolls near its edges. The order is saved.
- **Refreshed UI**: slimmer glass rows, round folder chips and a glowing pin. Edge fades replace the scrollbar, and folding and unfolding animate row by row.

## Run the portable app

Run `H:\CZWJJ\release\VioletFolders-1.3.0-win-x64.exe`, or extract `VioletFolders-1.3.0-win-x64.zip` from the same directory and launch the app. The portable package includes Electron and the native capture module, so users do not need Node.js, .NET, Visual Studio, or the Windows SDK. Repository users with access can also download it from GitHub Releases.

1. Open a folder in Windows File Explorer. Each detected path gets an independent glass row; duplicate paths are merged.
2. The final folder name is prominent, with the parent path as supporting information. Hover for the complete path.
3. Click to activate the matching Explorer window or reopen a pinned folder that has been closed.
4. Pin a folder to keep it after Explorer closes and across app restarts. Unpinned rows disappear when all corresponding windows close or navigate elsewhere.
5. Fold all rows with the top control. Drag the top area to move the shelf. Gaps stay transparent, with no shared background panel.

The top **×** exits the whole app, leaving Explorer windows open. The menu offers Chinese / English, reset to the top-left corner, and optional start at sign-in, off by default and available in packaged builds. The tray icon also provides expand, collapse, and quit actions. Empty and collapsed states leave only the compact control bar.

| Action | Shortcut |
| --- | --- |
| Expand / collapse globally | `Ctrl` + `Alt` + `F` |
| Close glass settings or an open menu, otherwise collapse folders | `Esc` |
| Return to or reopen a folder | Click its glass row |

## Glass effect and scope

Version 1.2 uses the reference project's SVG displacement filter, RGB chromatic aberration, and reflected edge highlights. Open **Liquid glass effect** from the top menu to adjust the effect. Changes apply immediately and save automatically.

- Four refraction modes: `Standard`, `Polar`, `Prominent`, and experimental `Shader`.
- Seven sliders: displacement, blur amount, saturation, chromatic aberration, elasticity, corner radius, and violet tint.
- **Over a light background** darkens the glass; **Live desktop refraction** controls desktop sampling.
- **Clear / Frosted / Refractive** presets and **Reset**. Radius is limited by the capsule size: up to 36px for folder rows and 23px for the header.

Desktop refraction uses DXGI Desktop Duplication. It does not open a WGC session that produces a yellow capture border or composite the separate mouse pointer. Frames pass through D3D11 shared textures, Electron `sharedTexture`, and `VideoFrame` to a shared frame source. Each glass surface draws only its own area and the border needed by its filters into a local canvas, then applies blur, saturation, and displacement. The native layer keeps one up-to-date desktop texture and uses dirty rectangles plus a pixel comparison to tell whether the area behind the glass (including filter margins) really changed. Only then does it publish a frame, at the configured rate (default 60, or unlimited); after the window moves it sends one fresh frame. Frames are not encoded as JPEGs or copied as pixel arrays through IPC; GPU textures are shared across processes. All processing stays in local memory, with no recording, saving, or uploading.

After the window is shown and before each capture starts, the native module directly sets `WDA_EXCLUDEFROMCAPTURE`, reads it back, and uses `DwmFlush` to wait for desktop composition to update. This avoids relying on a toolkit's cached protection state. Failed verification prevents capture from starting. Turning off live desktop refraction stops capture and releases its textures. Unsupported systems or capture failures use transparent glass with a stable dark tint and show the status in the controls.

Text and icons switch between light and dark ink according to the background. Fifteen pixels are read every 250ms, accounting for saturation, violet tint, and over-light darkening; hysteresis reduces flicker near the switching threshold. Text shadows are removed. Tint and reflections sit above the optical source and below sharp text, and complementary filter regions are added to preserve opacity, preventing an untreated desktop layer from showing through as a duplicate image.

Elasticity defaults to 0.15. Stretching and movement reserve space according to the current elasticity setting instead of being clipped by the folder list's edges.

Cursor-free capture and capture exclusion require Windows 10 version 2004 (build 19041) or later. Windows 11 remains a target requiring verification. The browser preview uses a detailed fixture scene with text, a grid, and graphics to reveal edge bending; it does not read the desktop. In the current desktop app, glass controls stay below the header, up to 340px wide, and scroll within the available height. Opening the panel reserves a fixed window width, so adjusting elasticity no longer shifts the controls from side to side.

Some drivers draw a software pointer directly into the desktop image. When a separate pointer cannot be confirmed, the module drops those frames and retains the last clean image to avoid refracting the pointer. Live updates may pause in that case.

Capture currently supports unrotated GPU desktop outputs. Rotated monitors and environments that provide only system-memory desktop images use the fallback appearance.

- Targets Windows 10 / 11 x64. DXGI self-exclusion, first frames, click-through, backpressure, and packaged automatic startup were verified on Windows 10 22H2 with a 2560×1440 desktop. Duplication delivers new frames when the desktop changes; static scenes reuse the latest GPU frame. Performance varies with hardware, glass settings, and system load. Windows 11 still requires target-machine verification.
- Tracks file-system paths exposed by Windows File Explorer, including drive paths and accessible network shares. Third-party file managers, browsers, and virtual Home views are outside its scope.
- Complete enumeration of background Windows 11 tabs is not guaranteed; it depends on the windows and tabs exposed by the system Shell interface.
- Topmost behavior applies to ordinary desktop windows, with no guarantee over the secure desktop, UAC prompts, lock screen, or exclusive fullscreen apps.
- The current portable build is unsigned. If another app owns the shortcut, use the shelf or tray controls.

## Local data

Pins, language, position, glass settings, and preferences are stored in `%APPDATA%\Violet Folders\settings.json`. Development and packaged builds use the same application name and settings directory. Older settings receive default glass values while retaining existing preferences. The running app does not upload folder paths, file contents, or desktop samples. Personal settings are excluded from the source and distribution packages.

To remove the app, turn off start at sign-in, quit, and delete its portable files. Delete the settings directory separately if you also want to remove preferences.

## Develop and package

Requires Windows x64, Node.js 22.12 or later, npm, Visual Studio C++ x64 build tools, and a Windows SDK with C++/WinRT. Source builds do not require .NET. These compilation tools build the native capture module; the packaged app does not require them.

```powershell
Set-Location H:\CZWJJ
npm install
npm run dev
```

To get the source from GitHub:

```powershell
git clone https://github.com/xietiantian6877-lab/violet-folders.git
Set-Location violet-folders
npm ci
npm run dev
```

```powershell
npm test            # Backend and domain tests
npm run build:native # DXGI desktop duplication native module
npm run build       # TypeScript checks and Vite build
npm run dist        # Native module, renderer, Windows x64 EXE / ZIP, and checksums
```

`npm run dev` runs `npm run build:native` first. `npm run dist` prepares the Electron runtime before building the native module and renderer; it downloads a missing runtime and stops packaging if preparation fails. The Windows one-command entry point is `.\scripts\build.ps1`. It installs dependencies, runs tests, and invokes the current Electron project's `npm run dist`. Use `-SkipInstall` when dependencies are already installed.

The renderer builds into `dist-renderer/`. Portable packages and SHA-256 checksums go into `release/`. `npm run preview` is a browser UI preview only and does not connect to the real Explorer session.

The UI component is `renderer/App.tsx`, with mounting in `renderer/main.tsx` and material / layout styles in `renderer/style.css`. `renderer/Glass.tsx` handles local canvases and ink brightness, with coordinate mapping in `renderer/optical-geometry.ts`. Glass controls live in `renderer/GlassControls.tsx`, with defaults in `renderer/glass-defaults.ts`. `native/desktop-capture/desktop_capture.cc` implements cursor-free capture, `electron/native-desktop-capture.cjs` manages its lifecycle, and `electron/desktop-source.cjs` manages displays and capture exclusion. `renderer/useDesktopStream.ts` and `renderer/desktop-stream-controller.ts` manage the shared frame source; `renderer/desktop-frame-receiver.ts` receives and releases `VideoFrame` objects. Preference validation lives in `electron/glass-settings.cjs`. Electron starts from `electron/main.cjs`; Vite configuration is `vite.config.mts`.

```text
release/
  VioletFolders-1.3.0-win-x64.exe
  VioletFolders-1.3.0-win-x64.zip
  VioletFolders-1.3.0-win-x64.exe.sha256
  VioletFolders-1.3.0-win-x64.zip.sha256
  SHA256SUMS.txt
```

## GitHub releases

GitHub Actions uses Node.js 24 to install with `npm ci`, test, build, and package Windows artifacts. `npm run dist` prepares the Electron runtime and builds the native capture module automatically. It saves the EXE, ZIP, and checksums. A version tag such as `v1.3.0` creates a GitHub Release or updates the assets of an existing release. Repository permissions determine visibility.

## Preserved WPF source

The earlier C# / WPF app remains in `src/VioletFolders/`, with its .NET tests in `tests/VioletFolders.Tests/` and `tests/VioletFolders.UiTests/`. Use `scripts/build-legacy-wpf.ps1` only to rebuild that earlier app with the .NET 10 SDK; its output lives in `dist/`. The current primary app uses Electron and builds through npm or `scripts/build.ps1`.

The main project uses the MIT License; see [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.

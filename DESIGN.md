---
name: Violet Folders Electron surface
description: Adjustable liquid-glass capsules with local desktop refraction, transparent gaps and readable controls
colors:
  ink: '#FAF5FF'
  secondary: '#D6C7E5'
  violet: '#DCBAFF'
  folder-name: '#FAF3FF'
  folder-name-on-light: '#281734'
  parent-path: '#DFD1E9'
  parent-path-on-light: '#4C365C'
  menu-surface: '#21192C'
  menu-hover: '#42304F'
  menu-ink: '#FCF6FF'
  focus: '#EFDAFF'
typography:
  ui:
    fontFamily: 'Segoe UI Variable, Microsoft YaHei UI, Segoe UI, sans-serif'
  folder-name:
    fontSize: 15
    fontWeight: 600
    lineHeight: 1.15
  parent-path:
    fontSize: 11
    lineHeight: 1.15
  pin-label:
    fontSize: 9
spacing:
  shelf-max-width: 504
  shelf-padding: 'calc(8px + elasticY) 12px 10px'
  elastic-x: '8 + ceil(100 * elasticity)'
  elastic-y: '10 + ceil(22 * elasticity)'
  row-height: 72
  row-gap: 10
  row-extent: 82
  row-radius: 36
  header-width: 266
  header-height: 46
  header-radius: 23
  header-bottom-gap: 12
  menu-width: 266
  menu-radius: 18
  glass-controls-width: 340
  glass-controls-radius: 20
  glass-controls-left: 12
  glass-controls-top: 65
  glass-controls-side-rule: 'min(720, maxWidth) + 360 <= maxWidth'
  expanded-window-width: 'min(720, maxWidth) + (sideControls ? 360 : 0)'
---

# Violet Folders Electron surface

This compact Operate surface helps a user return to a folder while working in other Windows apps. The visual direction is the user's purple and black liquid glass: separate capsule rows, a substantial rounded rim, soft frosting, and clear desktop between rows. The main implementation is React inside an Electron transparent, frameless window. Earlier WPF source is preserved separately and does not define this renderer's tokens.

## Material

Version 1.2 uses rdev/liquid-glass-react for each header or folder capsule, preserving the library's SVG displacement filters, separate RGB channel displacement, and reflected edge layers. Defaults are `mode="standard"`, `cornerRadius={36}`, `displacementScale={100}`, `blurAmount={0.0625}`, `saturation={140}`, `aberrationIntensity={2}`, `elasticity={0.15}`, `tintOpacity={0.12}`, `overLight={false}`, and `desktopRefraction={true}`. Users can change all these settings. Effective corner radius is capped at half the capsule height: 36px for rows and 23px for the header. All CSS eight-digit colors below are RRGGBBAA, rather than WPF ARGB.

The glass parent has a transparent background. A light `rgb(77 37 111 / var(--glass-tint))` overlay adds adjustable violet color above the optical source, followed by a black veil at 0.38 opacity when over-light darkening is enabled. Reflections sit above this material and below the sharp names and controls. Text shadows, including the library's content shadow, are disabled to remove the blurred halo around text. A half-pixel `#E3CEF340` border, inset upper reflection, and lower reflection supplement the library's highlights. A second inset outline sits 1.5px inside the rim. The shared window, document, and gaps remain transparent.

CSS filters operate on Chromium content. Desktop pixels therefore follow this path: DXGI Desktop Duplication → D3D11 shared texture → Electron `sharedTexture` → `VideoFrame` → each glass surface's local canvas. All surfaces consume the same frame source. The native module directly sets and verifies `WDA_EXCLUDEFROMCAPTURE` on the app window, never composites the separate pointer, and discards frames that may contain an embedded software pointer. It calls `DwmFlush` before capture starts; failed exclusion prevents capture, with automatic recovery for transient startup failures. This backend does not create a WGC yellow capture border. The main process forwards shared GPU resources with DIP geometry, without per-frame JPEG encoding or pixel arrays over IPC. Capture targets 30fps and depends on the device and system load. The platform requirement is Windows 10 build 19041 or later; Windows 11 remains a target awaiting verification. Frames stay in local memory and are never recorded, written to disk, or uploaded. Disabling desktop refraction stops capture and releases textures; unsupported or failed capture uses transparent glass with a stable dark veil and light ink, and exposes its status in the controls.

The renderer crops only the transformed glass bounds and their overscan into a local canvas inside each library `.glass__warp` layer. Screen and window coordinates stay in DIPs; native frame dimensions determine source pixel density, so negative monitor origins, DPI changes, clipping, and elastic transforms do not apply devicePixelRatio twice. With `blurPx = (overLight ? 12 : 4) + blurAmount * 32`, the local padding is `P = ceil(3 * blurPx + maxRGBDisplacement / 2 + 3)`. `maxRGBDisplacement` includes the selected mode, over-light displacement reduction, and the largest RGB channel scale. The SVG filter region expands with P while the displacement map remains sized to the original capsule, preventing the filter from clipping the extra source pixels.

The local source receives blur and saturation before SVG displacement. Complementary edge and center masks are added with arithmetic composition instead of alpha-over, preserving opacity for opaque source frames so the untreated desktop cannot leak through as a second image. The explicit source also avoids losing the backdrop at opacity or other backdrop roots during row animations and scrolling. With this source present, the warp layer's CSS backdrop filter is disabled to avoid applying blur twice. Offscreen or document-hidden surfaces skip their canvas work. Browser preview uses aligned clones of a fixture scene containing text, a grid, and graphics; it does not capture the desktop.

Every visible glass surface measures a 5 × 3 grid, fifteen pixels, at most once per 250ms. The meter applies the current saturation before calculating relative luminance, then estimates the violet tint and over-light veil. Ink selection uses hysteresis: initial crossover at 0.21, light-to-dark above 0.25, and dark-to-light below 0.17. This keeps text and icons stable near the crossover. Light ink is `#FAF3FF`, muted ink `#DFD1E9`, and icons `#E6D0FA`; on light backgrounds these become `#281734`, `#4C365C`, and `#69408B`. The small meter readback does not read the full desktop into CPU memory.

### CSS paint inventory

These authored colors in `renderer/style.css` extend the core tokens above. Alpha values belong to the optical layers and interaction states. They are intentional material paints, rather than extra opaque theme surfaces. Shorthand CSS white and black are normalized here to six digits; `#FFF7` is `#FFFFFF77`.

| Role | CSS colors |
| --- | --- |
| Core text and violet | `#FAF5FF`, `#D6C7E5`, `#DCBAFF` |
| Glass violet overlay | `#4D256F` with adjustable alpha, default 0.12 |
| Glass rim and inset outline | `#E3CEF340`, `#FFFFFF30`, `#E2CAFF24` |
| Glass inset light and lower reflection | `#FFFFFF38`, `#B999E624` |
| Glass elevation shadow | `#0D071126` |
| Adaptive name / action ink | `#FAF3FF` / `#281734` |
| Adaptive parent path / header count | `#DFD1E9` / `#4C365C` |
| Adaptive brand, folder, and pin icons | `#E6D0FA` / `#69408B` |
| Reflected brand tint | `#DAB8FF24` |
| Adaptive action hover and fill | `#FFFFFF` / `#281734`, `#DEC4FA1C` / `#6C3D8B1C` |
| Close hover and folder hover | `#DBA1C438`, `#E1C4FF0C` |
| Over-light / fallback black veil | `#000000` at 0.38 / 0.52 opacity |
| Name, path, and library content text shadows | none |
| Pinned gradient and inset light | `#D3A8F747`, `#BD8DE129`, `#F5DEFF20` |
| Opaque menu, border, ink, and hover | `#21192C`, `#80628F`, `#FCF6FF`, `#42304F` |
| Menu shadow, title, icons, divider, and help | `#100B154D`, `#CDB9DF`, `#D6BEE9`, `#C9ABD526`, `#CDB9DD` |
| Shortcut text and key surface | `#DDC9EC`, `#B094C016` |
| Toggle off, thumb, and on | `#5C4B69`, `#C5B6D1`, `#A16AC3` |
| Notice surface, border, and ink | `#261B33F5`, `#A888BD80`, `#F3E7FA` |
| Focus, selection, and scrollbar | `#EFDAFF`, `#A77BCB55`, `#AD8CC270` |
| Browser preview background and graphics | `#211B38`, `#74638B`, `#202538`, `#E2B6F1`, `#825ED4`, `#242151`, `#D0B4E6`, `#693E99` |
| Glass controls surfaces and selected mode | `#21192C`, `#31233D`, `#291E34`, `#42304F`, `#DCBAFF`, `#271333` |
| White / black utilities | `#FFFFFF`, `#000000` |

## Hierarchy and layout

The base shelf width is `min(504, max(290, maxWidth - 2 * elasticX))` pixels. The outer surface also reserves `elasticX` on each side, while the folder list keeps 12px horizontal shelf padding. Each folder capsule is 72px tall with an adjustable radius up to 36px; its 82px outer slot leaves a 10px transparent gap. The path is two lines: a 15px semibold final folder name in adaptive primary ink, and an 11px parent path in adaptive muted ink, separated by 6px. Each line truncates independently; the button tooltip contains the complete path. A consistent Lucide folder icon distinguishes the navigation target, and a small dot marks an open folder.

The pin control has an icon plus a 9px label. It reads 固定 / Pin before pinning and 常驻 / Kept afterward. The pinned state adds a tinted fill and uses `aria-pressed`; it remains recognizable without color alone. The folder name and pin are independent buttons.

The 266 × 46px header contains the mark, short app name, count, collapse, settings, and visible exit. Its drag region excludes button targets. Empty and collapsed states leave the compact header, without a large empty-state card. The folder list scrolls within the available monitor work area.

The settings menu is an opaque `#21192C` surface with light `#FCF6FF` text, a `#80628F` border, and `#42304F` hover treatment. This readability is retained regardless of the desktop behind it. Liquid glass effect, language, startup, reset position, help copy, shortcut, and exit have separate rows; keyboard focus uses `#EFDAFF`.

The Liquid glass effect entry opens `renderer/GlassControls.tsx`. Four mode buttons select Standard, Polar, Prominent, or experimental Shader. Seven sliders control displacement, blur, saturation, aberration, elasticity, corner radius, and violet tint. Two switches control over-light darkening and desktop sampling. Clear, Frosted, and Refractive presets change the optical parameters; Reset restores all defaults. Native changes update immediately and save after a 250ms debounce, with validation at the IPC boundary. Existing preference files gain default glass settings while retaining their original pins and other preferences.

The control panel has an opaque surface, a 20px radius, and width `min(340px, 100vw - 24px)`. Its normal position is fixed at left 12px and top 65px. Its maximum height depends on the available work area and viewport, and its content scrolls. Panel position, width, and maximum height do not depend on elasticity; this prevents controls from shifting while the elasticity slider is dragged.

While glass controls are open, the native window reserves `controlsShelfWidth = min(720, maxWidth)` pixels for the shelf and its maximum elastic travel budget. Side placement is allowed only when `controlsShelfWidth + 360 <= maxWidth`; it uses left 730px and top 8px with a 340px panel. The current main process caps `maxWidth` at 900px, so the native app uses the normal placement below the header. The open-panel window width stays fixed as elasticity changes. Closing the panel returns to the compact width based on the shelf and its current elastic margins. Opening and closing update the native hit regions and window dimensions.

## Motion and interaction

New rows enter downward over 380ms with cubic-bezier(.16,1,.3,1), changing opacity .3→1 and translation -10px→0. The entrance avoids scale and filter animation so the glass library's backdrop measurements remain stable. List folding lasts 280ms, and menu entry lasts 160ms. The `prefers-reduced-motion` media query disables transitions and animations.

Elastic movement reserves `elasticX = 8 + ceil(100 * elasticity)` pixels horizontally and `elasticY = 10 + ceil(22 * elasticity)` pixels vertically. At the default elasticity of 0.15, these margins are 23px and 14px. The scrollport includes this padding so stretching and translation are not clipped by the list viewport. Optical source alignment and interactive hit regions follow the transformed surface while the spaces between rows remain transparent.

Pointer activity is passed to Electron through a narrow preload API so transparent gaps can forward input to the underlying app. Folder rows, header, menus, glass controls, and notices remain interactive. Rounded hit regions update with the optical settings. Hover, visible keyboard focus, loading, errors, open/closed, and pin states have explicit treatments. Escape first closes glass controls, then an open menu, otherwise folds the list; Ctrl+Alt+F folds or unfolds globally.

## Verification boundaries

The renderer, preload bridge, Electron window, and live Explorer watcher must be checked together for application behavior. Browser preview verifies layout, controls, elastic movement, and refraction over the fixture scene, but cannot establish actual desktop capture, live folder monitoring, native click-through, or topmost behavior. Desktop checks must cover cursor exclusion, verified self-exclusion and composition settling before startup, shared-texture and VideoFrame lifetimes, stopping capture when disabled, failure fallback, display changes, alignment during movement, overscan at optical extremes, and adaptive contrast. Frame rate and Windows 11 compatibility require target-machine verification; the development host running Windows 10 22H2 does not establish those results. Backend tests cover settings validation and migration, IPC updates, persistence, optical geometry, and existing folder behavior through `npm test`. Production packages come from `npm run dist` into `release/`.

The React component lives in `renderer/App.tsx`; `renderer/main.tsx` mounts it once, and `renderer/style.css` owns the visual tokens. `renderer/Glass.tsx` owns local optical canvases, filter adaptation, and luminance metering; `renderer/optical-geometry.ts` owns crop mapping and ink hysteresis. `renderer/GlassControls.tsx` and `renderer/glass-controls.css` own the control panel. Vite configuration lives in `vite.config.mts`. The native window and shared-texture transport entry point is `electron/main.cjs`; `electron/desktop-source.cjs` handles display geometry and capture exclusion, and `electron/native-desktop-capture.cjs` manages the capture session implemented in `native/desktop-capture/desktop_capture.cc`. `renderer/desktop-frame-receiver.ts` receives and releases VideoFrames, while `renderer/useDesktopStream.ts` and `renderer/desktop-stream-controller.ts` manage the shared frame source. Parameter validation lives in `electron/glass-settings.cjs`.

Source builds require Visual Studio C++ x64 build tools and a Windows SDK containing C++/WinRT, alongside Node.js and npm. `npm run build:native` compiles the native module; `npm run dev` and `npm run dist` invoke it automatically, including CI packaging. The portable app includes that module and the Electron runtime, so users do not install compiler tools or an SDK.

`docs/images/preview.png` is a browser capture of the renderer with example paths. It is illustrative UI evidence, not a capture of a user's live Explorer paths. Native desktop material appearance depends on the sampled content, the selected optical settings, and capture availability.

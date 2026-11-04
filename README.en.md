# Violet Folders · 紫璃文件夹

[简体中文](README.md)

I usually have a pile of folders open at once, and digging through stacked Explorer windows for the one I was just using got old. So this is a small shelf that lives in a corner of the screen. Every folder you open shows up as a strip of purple glass, and one click takes you back to that window. Pin the ones you use a lot and they stay, even after Explorer closes or the PC restarts.

![Violet Folders with live desktop refraction](docs/images/glass-shelf-dark.png)

All screenshots were taken on a real desktop with live desktop refraction turned on. The paths are made-up examples.

| Light background, black text locked, blur at 0 | Liquid glass settings |
| --- | --- |
| ![Light background with black text locked](docs/images/glass-shelf-light.png) | ![Liquid glass settings panel](docs/images/glass-controls.png) |

## Download

Grab the latest `VioletFolders-x.x.x-win-x64.exe` from [Releases](https://github.com/xietiantian6877-lab/violet-folders/releases) and double-click it. Nothing else to install. The ZIP has the same app if you prefer an unpacked folder.

It needs 64-bit Windows 10 version 2004 or newer and has mostly been tested on Windows 10 22H2.

## Using it

- **Folders appear on their own**: open a folder in File Explorer and it shows up. The folder name is large, the parent path is small, and hovering shows the full path.
- **Go back**: click a strip to jump to that Explorer window. If the window is gone, a pinned folder opens again.
- **Pin**: click the pin on the right. Unpinned strips disappear when their folder closes.
- **Reorder**: press and hold a strip for about half a second, then drag. The others move out of the way and the order is remembered.
- **Move and fold**: drag the top bar to move the shelf; it slides along screen edges without jittering. Double-click the top bar or press `Ctrl` + `Alt` + `F` to fold everything.
- **Quit**: the × at the top, or the tray icon menu. Your Explorer windows stay open.

The `…` menu also has a language switch, "move to top left", and launch at login (off by default).

## Tuning the glass

Open "Liquid glass effect" from the menu. Changes apply immediately and are saved.

- **Clear / Frosted / Refractive** presets if you don't want to fiddle.
- **Blur** at 0 is fully clear, so you can read the desktop behind the glass; slide right for frosted glass.
- **Text colour** follows the background by default. Lock it to white or black if the switching bothers you.
- **Desktop frame rate**: 30 / 60 / 120 / no limit, default 60. It only refreshes when the area behind the glass changes, so it is nearly free most of the time; higher is smoother and uses more power.
- Displacement, chromatic aberration, elasticity, corner radius and violet tint are there to play with; "Reset" puts everything back.
- Turn off live desktop refraction for a plain translucent purple look that costs almost nothing.

## How it works

The UI is Electron + React, and the glass comes from [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react).

A web page can't see the desktop behind its window, so a small native module grabs the desktop with DXGI Desktop Duplication and hands it to the UI as a shared GPU texture. The window excludes itself from capture (`WDA_EXCLUDEFROMCAPTURE`) so it never refracts itself. That is also why screenshot tools can't see it.

To stay light, the native side checks what Windows reports as changed, then compares the pixels behind the glass, and only sends a new frame when something there really changed. A video playing elsewhere on screen barely affects it.

Desktop images stay in local memory and GPU memory. Nothing is recorded, saved or uploaded.

## Known limits

- Only Windows File Explorer is tracked; third-party file managers aren't. Background tabs on Windows 11 may not all be detected.
- Rotated displays fall back to the plain glass look for now.
- Always-on-top covers normal windows, not UAC prompts, the lock screen or exclusive full-screen games.
- The EXE isn't code-signed, so Windows may warn the first time; choose "Run anyway".
- Windows 11 hasn't had long-term testing yet. Issues are welcome.

## Where settings live

`%APPDATA%\Violet Folders\settings.json` holds pinned paths, position, language and glass settings. Delete that folder to reset. The app is portable: turn off launch at login, then delete the EXE to uninstall.

## Building it yourself

You need Windows x64, Node.js 22.12+, and the Visual Studio C++ build tools with a Windows SDK that includes C++/WinRT (only for the native capture module).

```powershell
git clone https://github.com/xietiantian6877-lab/violet-folders.git
cd violet-folders
npm ci
npm run dev      # development mode
npm test         # tests
npm run dist     # EXE and ZIP in release/
```

`npm run preview` shows the UI in a browser with sample data, without Explorer.

Pushing a `v*` tag makes GitHub Actions build the EXE, ZIP and checksums and attach them to that release.

Where things are:

- `electron/main.cjs`: the main process (window, dragging, tray, and talking to the Explorer watcher).
- `renderer/`: the UI. `App.tsx` is the shell, `FolderList.tsx` the list, sorting and animation, `Glass.tsx` the glass and refraction, `GlassControls.tsx` the settings panel.
- `native/desktop-capture/`: the native desktop capture module.

`src/VioletFolders/` holds the original C# / WPF version for reference; the current app doesn't use it.

## License

MIT, see [LICENSE](LICENSE).

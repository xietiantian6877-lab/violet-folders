# 紫璃文件夹 / Violet Folders

The primary application is a Windows x64 folder shelf built with Electron, React, TypeScript, Vite, and rdev/liquid-glass-react. It watches Windows File Explorer file-system locations and keeps independent purple glass rows near the top-left edge of the desktop.

The core loop is open a folder → recognize its name and parent path → click to return. Identical paths share one row. Pinning changes a temporary row into a persistent shortcut that survives Explorer closure and app restart. Unpinned paths disappear after their last matching Explorer window closes or navigates away. A full-path tooltip supports long names.

The transparent, frameless shelf stays above ordinary desktop applications. Its header folds the folder list, supports dragging, and offers settings plus visible exit. Chinese and English UI, a tray recovery path, and Ctrl+Alt+F support frequent use. Start at sign-in is optional and off by default.

The material comes from liquid-glass-react inside Electron's Chromium renderer. The library's refraction and frosting operate on page content; CSS does not directly refract other apps or arbitrary desktop pixels behind a transparent native window. Each 72px capsule occupies an 82px slot with a transparent gap. A solid, high-contrast settings menu preserves readability. Empty and collapsed states show only the compact header.

Windows 10 22H2 x64 is the local verification environment. Windows 11 is a target requiring verification, with specific limitations around background Explorer tabs exposed through Shell COM. Secure desktop, UAC, lockscreens, exclusive fullscreen, virtual Shell pages, and third-party file managers are outside the normal operation guarantee.

Preferences are local to the current user at %APPDATA%\Violet Folders\settings.json, shared by development and packaged builds through the fixed application name. Runtime behavior does not upload paths or contents. Source and unsigned portable EXE / ZIP packages can be distributed through the private GitHub repository. npm scripts and scripts/build.ps1 build the primary Electron app; the renderer builds to dist-renderer and packages to release.

The earlier WPF implementation remains under src/VioletFolders with its existing .NET tests and scripts/build-legacy-wpf.ps1. It is preserved source, not the current primary application or distribution path.

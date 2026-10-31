# 紫璃文件夹 · Violet Folders

基于 **Electron + React + TypeScript** 的 Windows 文件夹悬浮工具，玻璃界面使用 [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)。打开资源管理器里的文件夹，屏幕左上角就会出现独立的紫色玻璃条；点击返回，固定后随时重新打开。

[English](README.en.md)

![紫璃文件夹 React 界面预览](docs/images/preview.png)

浏览器中的示例路径预览；实际桌面效果会随背景变化。

## 直接运行

双击 `H:\CZWJJ\release\VioletFolders-1.1.0-win-x64.exe`，或者解压同目录的 `VioletFolders-1.1.0-win-x64.zip` 后运行应用。便携包包含 Electron 运行时，使用时无需另装 Node.js 或 .NET。有仓库访问权限的用户也可以从 GitHub Release 下载。

1. 正常打开 Windows 文件资源管理器中的文件夹。每个检测到的路径显示为独立玻璃条，相同路径合并。
2. 最后一级文件夹名突出显示，父路径作为辅助信息；悬停查看完整路径。
3. 点击路径切回对应资源管理器窗口；已关闭的固定文件夹会重新打开。
4. 点击图钉常驻。固定路径会在关闭资源管理器和重启应用后保留；未固定条目在对应文件夹全部关闭或导航离开后移除。
5. 顶部按钮可折叠全部条目，拖动顶部区域可移动悬浮位置。条目之间保持透明，没有公共背景面板。

顶部 **×** 退出整个应用，资源管理器窗口保持打开。菜单提供中英文切换、返回左上角和可选的开机启动；开机启动默认关闭，在打包版本中可设置。托盘图标也提供展开、折叠和退出操作。没有文件夹或全部折叠时，只保留紧凑控制条。

| 操作 | 快捷方式 |
| --- | --- |
| 全局展开 / 折叠 | `Ctrl` + `Alt` + `F` |
| 关闭打开的菜单，否则折叠文件夹 | `Esc` |
| 切回或重新打开文件夹 | 点击对应玻璃条 |

## 玻璃效果与适用范围

`liquid-glass-react` 提供玻璃边缘折射、磨砂和反光；本应用关闭弹性位移，保持滚动时的边缘稳定。它处理 Chromium 内的网页内容；CSS 滤镜不能直接采样其他应用或桌面画面，因此不承诺把任意桌面内容做成真实折射。浏览器预览与透明桌面窗口的视觉背景也会不同。

- 目标为 Windows 10 / 11 x64。本机验证环境是 Windows 10 22H2；Windows 11 仍需目标机验证。
- 仅跟踪 Windows 文件资源管理器可枚举的文件系统路径，包括盘符路径和可访问的网络共享。第三方文件管理器、浏览器和虚拟主页不在范围内。
- Windows 11 后台标签页不保证完整枚举，具体取决于系统 Shell 接口暴露的窗口和标签页。
- 置顶适用于普通桌面窗口，不承诺覆盖安全桌面、UAC 提示、锁屏和独占全屏。
- 当前便携包未做代码签名。快捷键若被其他程序占用，可使用界面或托盘按钮。

## 本地数据

固定路径、语言、位置和偏好保存在 `%APPDATA%\Violet Folders\settings.json` 中。开发版和打包版使用相同的应用名称与配置目录。应用运行时不上传文件夹路径或文件内容；个人配置不包含在源码与发布包中。

需要移除程序时，先关闭开机启动并退出应用，再删除便携文件。需要清除偏好时，另行删除配置目录。

## 从源码运行与打包

需要 Windows、Node.js 22 和 npm；开发不需要 .NET。

```powershell
Set-Location H:\CZWJJ
npm install
npm run dev
```

从 GitHub 获取源码：

```powershell
git clone https://github.com/xietiantian6877-lab/violet-folders.git
Set-Location violet-folders
npm ci
npm run dev
```

```powershell
npm test            # 后端与领域测试
npm run build       # TypeScript 检查与 Vite 构建
npm run dist        # Windows x64 便携 EXE、ZIP 与校验文件
```

Windows 一键构建入口为 `.\scripts\build.ps1`，默认安装依赖、运行测试并执行当前 Electron 项目的 `npm run dist`。已有依赖时可加 `-SkipInstall`。

构建的渲染器位于 `dist-renderer/`，便携产物与 SHA-256 校验文件位于 `release/`。`npm run preview` 仅用于浏览器界面预览，不会连接真实资源管理器。

主界面为 `renderer/App.tsx`，`renderer/main.tsx` 仅负责挂载，材质和布局为 `renderer/style.css`。Electron 入口为 `electron/main.cjs`，Vite 配置为 `vite.config.mts`。

```text
release/
  VioletFolders-1.1.0-win-x64.exe
  VioletFolders-1.1.0-win-x64.zip
  VioletFolders-1.1.0-win-x64.exe.sha256
  VioletFolders-1.1.0-win-x64.zip.sha256
  SHA256SUMS.txt
```

## GitHub 发布

GitHub Actions 使用 Node.js 22 执行 `npm ci`、测试、构建和 Windows 打包，保存 EXE、ZIP 与校验文件。推送版本标签（如 `v1.1.0`）会创建 GitHub Release；同名 Release 已存在时更新附件。仓库权限决定 Release 的可见范围。

## 保留的 WPF 源码

早期 C# / WPF 版本保留在 `src/VioletFolders/`，其 .NET 测试仍位于 `tests/VioletFolders.Tests/` 和 `tests/VioletFolders.UiTests/`。仅需重建旧版时使用 `scripts/build-legacy-wpf.ps1`，需要 .NET 10 SDK；旧版输出位于 `dist/`。当前主程序使用 Electron，构建入口为 npm 或 `scripts/build.ps1`。

主项目采用 MIT License，见 [LICENSE](LICENSE)。第三方依赖遵循其各自许可证。

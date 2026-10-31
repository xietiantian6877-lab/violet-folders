import type { AppState, VioletBridge } from './types'

// Browser-only visual preview. Electron always uses the real, isolated preload bridge.
let preview: AppState = {
  entries: [
    { path: 'F:\\9.21\\培训集合\\店铺授权', name: '店铺授权', parentPath: 'F:\\9.21\\培训集合', isPinned: true, isOpen: true },
    { path: 'D:\\Work\\品牌资料\\视觉规范', name: '视觉规范', parentPath: 'D:\\Work\\品牌资料', isPinned: false, isOpen: true },
    { path: 'D:\\Projects\\Violet Folders', name: 'Violet Folders', parentPath: 'D:\\Projects', isPinned: false, isOpen: true },
  ],
  collapsed: false, language: 'zh-CN', launchAtLogin: false, monitorStatus: 'ready', maxHeight: 900, maxWidth: 520,
}
const listeners = new Set<(state: AppState) => void>()
const update = (patch: Partial<AppState>) => { preview = { ...preview, ...patch }; for (const listener of listeners) listener(preview) }
const browserBridge: VioletBridge = {
  getState: async () => preview,
  onState: callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
  openFolder: async () => ({ ok: true }),
  togglePin: async path => update({ entries: preview.entries.map(entry => entry.path === path ? { ...entry, isPinned: !entry.isPinned } : entry) }),
  setCollapsed: async collapsed => update({ collapsed }),
  setLanguage: async language => update({ language }),
  setLaunchAtLogin: async launchAtLogin => { update({ launchAtLogin }); return { ok: true } },
  setContentSize: async () => {}, setInteractive: () => {}, setHitRegions: () => {}, resetPosition: async () => {}, quit: () => {},
}
export const bridge = window.violet ?? browserBridge
export const isBrowserPreview = !window.violet

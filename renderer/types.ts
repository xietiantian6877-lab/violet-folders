export interface FolderEntry { path: string; name: string; parentPath: string; isPinned: boolean; isOpen: boolean }
export interface AppState {
  entries: FolderEntry[]; collapsed: boolean; language: 'zh-CN' | 'en'; launchAtLogin: boolean;
  monitorStatus: 'starting' | 'ready' | 'error'; error?: string; maxHeight: number; maxWidth: number;
}
export interface Result { ok: boolean; error?: string }
export interface VioletBridge {
  getState(): Promise<AppState>;
  onState(callback: (state: AppState) => void): () => void;
  openFolder(path: string): Promise<Result>;
  togglePin(path: string): Promise<unknown>;
  setCollapsed(collapsed: boolean): Promise<unknown>;
  setLanguage(language: 'zh-CN' | 'en'): Promise<unknown>;
  setLaunchAtLogin(enabled: boolean): Promise<Result>;
  setContentSize(size: { width: number; height: number; minimumHeight?: number }): Promise<unknown>;
  setInteractive(interactive: boolean): void;
  setHitRegions(regions: { x: number; y: number; width: number; height: number; radius?: number }[]): void;
  resetPosition(): Promise<unknown>;
  quit(): void;
}
declare global { interface Window { violet?: VioletBridge } }

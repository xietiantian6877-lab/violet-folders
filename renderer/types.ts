export interface FolderEntry { path: string; name: string; parentPath: string; isPinned: boolean; isOpen: boolean }
export interface GlassSettings {
  mode: 'standard' | 'polar' | 'prominent' | 'shader';
  displacementScale: number; blurAmount: number; saturation: number;
  aberrationIntensity: number; elasticity: number; cornerRadius: number;
  tintOpacity: number; overLight: boolean; desktopRefraction: boolean;
  ink: 'auto' | 'light' | 'dark';
  /** Desktop samples per second behind the glass; 0 = unlimited. */
  frameRate: number;
}
export interface DesktopGeometry {
  display: { id: string; x: number; y: number; width: number; height: number };
  windowBounds: { x: number; y: number; width: number; height: number };
}
export interface DesktopSourceResult { ok: boolean; sourceId?: string; geometry?: DesktopGeometry; error?: string }
export interface DesktopFrameSource {
  subscribe(callback: (frame: VideoFrame, geometry: DesktopGeometry) => void): () => void;
}
export interface AppState {
  entries: FolderEntry[]; collapsed: boolean; language: 'zh-CN' | 'en'; launchAtLogin: boolean;
  monitorStatus: 'starting' | 'ready' | 'error'; error?: string; maxHeight: number; maxWidth: number;
  glass: GlassSettings;
}
export interface Result { ok: boolean; error?: string }
export interface VioletBridge {
  getState(): Promise<AppState>;
  onState(callback: (state: AppState) => void): () => void;
  openFolder(path: string): Promise<Result>;
  togglePin(path: string): Promise<unknown>;
  reorder(paths: string[]): Promise<unknown>;
  holdPointer(held: boolean): void;
  setCollapsed(collapsed: boolean): Promise<unknown>;
  setLanguage(language: 'zh-CN' | 'en'): Promise<unknown>;
  setLaunchAtLogin(enabled: boolean): Promise<Result>;
  setGlassSettings(patch: Partial<GlassSettings>): Promise<Result>;
  getDesktopSource(options?: { refresh?: boolean }): Promise<DesktopSourceResult>;
  stopDesktopCapture(): Promise<Result>;
  onDesktopGeometry(callback: (geometry: DesktopGeometry | null) => void): () => void;
  setContentSize(size: { width: number; height: number; minimumHeight?: number }): Promise<unknown>;
  setInteractive(interactive: boolean): void;
  setHitRegions(regions: { x: number; y: number; width: number; height: number; radius?: number }[]): void;
  dragWindow(phase: 'start' | 'end'): void;
  resetPosition(): Promise<unknown>;
  quit(): void;
}
declare global { interface Window { violet?: VioletBridge } }

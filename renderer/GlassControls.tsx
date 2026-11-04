import { RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { defaultGlass } from './glass-defaults'
import type { GlassSettings } from './types'
import './glass-controls.css'

interface GlassControlsProps {
  settings: GlassSettings
  en: boolean
  desktopStatus?: string
  onChange: (patch: Partial<GlassSettings>) => void
  onClose: () => void
}

type NumericKey = 'displacementScale' | 'blurAmount' | 'saturation' | 'aberrationIntensity' | 'elasticity' | 'cornerRadius' | 'tintOpacity'

const modes: { value: GlassSettings['mode']; label: string; zh: string; description: string }[] = [
  { value: 'standard', label: 'Standard', zh: '均衡的边缘弯折与折射。', description: 'Balanced edge bending and refraction.' },
  { value: 'polar', label: 'Polar', zh: '沿玻璃轮廓向外展开折射。', description: 'Refraction spreads around the glass contour.' },
  { value: 'prominent', label: 'Prominent', zh: '更鲜明的边缘放大与变形。', description: 'Stronger magnification and edge distortion.' },
  { value: 'shader', label: 'Shader', zh: '动态生成折射贴图，实验性效果。', description: 'Dynamically generated refraction map. Experimental.' },
]

const sliders: { key: NumericKey; zh: string; en: string; min: number; max: number; step: number; format: (value: number) => string }[] = [
  { key: 'displacementScale', zh: '折射强度', en: 'Displacement', min: 0, max: 200, step: 1, format: value => value.toFixed(0) },
  { key: 'blurAmount', zh: '磨砂程度', en: 'Blur amount', min: 0, max: 1, step: 0.0125, format: value => value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') },
  { key: 'saturation', zh: '背景饱和度', en: 'Saturation', min: 0, max: 300, step: 5, format: value => `${value.toFixed(0)}%` },
  { key: 'aberrationIntensity', zh: '色散强度', en: 'Chromatic aberration', min: 0, max: 20, step: 0.1, format: value => value.toFixed(1) },
  { key: 'elasticity', zh: '鼠标弹性', en: 'Elasticity', min: 0, max: 1, step: 0.05, format: value => value.toFixed(2) },
  { key: 'cornerRadius', zh: '圆角半径', en: 'Corner radius', min: 0, max: 100, step: 1, format: value => `${value.toFixed(0)} px` },
  { key: 'tintOpacity', zh: '紫色着色', en: 'Violet tint', min: 0, max: 0.7, step: 0.01, format: value => `${Math.round(value * 100)}%` },
]

const inks: { value: GlassSettings['ink']; zh: string; en: string }[] = [
  { value: 'auto', zh: '自动', en: 'Auto' },
  { value: 'light', zh: '白色', en: 'White' },
  { value: 'dark', zh: '黑色', en: 'Black' },
]

const frameRates: { value: number; zh: string; en: string }[] = [
  { value: 30, zh: '30', en: '30' },
  { value: 60, zh: '60', en: '60' },
  { value: 120, zh: '120', en: '120' },
  { value: 0, zh: '无限制', en: 'No limit' },
]

const presets: { zh: string; en: string; values: Partial<GlassSettings> }[] = [
  { zh: '清透', en: 'Clear', values: { mode: 'standard', displacementScale: 100, blurAmount: 0.0625, saturation: 140, aberrationIntensity: 2, tintOpacity: 0.12, overLight: false } },
  { zh: '柔雾', en: 'Frosted', values: { mode: 'standard', displacementScale: 70, blurAmount: 0.5, saturation: 150, aberrationIntensity: 1, tintOpacity: 0.18, overLight: false } },
  { zh: '强折射', en: 'Refractive', values: { mode: 'prominent', displacementScale: 145, blurAmount: 0, saturation: 170, aberrationIntensity: 5, tintOpacity: 0.07, overLight: false } },
]

export default function GlassControls({ settings, en, desktopStatus, onChange, onClose }: GlassControlsProps) {
  const t = (zh: string, english: string) => en ? english : zh
  const selectedMode = modes.find(mode => mode.value === settings.mode) ?? modes[0]
  const status = !settings.desktopRefraction
    ? t('已关闭桌面取样', 'Desktop sampling is off')
    : desktopStatus === 'ready'
      ? t('桌面折射已连接', 'Desktop refraction connected')
      : desktopStatus === 'unavailable'
        ? t('桌面取样不可用 · 当前使用透明模式', 'Desktop sampling unavailable · Transparent mode')
        : desktopStatus === 'preview'
          ? t('预览背景折射', 'Preview background refraction')
          : t('正在连接桌面取样…', 'Connecting to desktop sampling…')

  return <section className="glass-controls" role="dialog" aria-labelledby="glass-controls-title" data-interactive>
    <header className="glass-controls-header">
      <div>
        <span className="glass-controls-eyebrow">LIQUID GLASS</span>
        <h2 id="glass-controls-title"><SlidersHorizontal size={16} aria-hidden="true"/>{t('液态玻璃', 'Glass effect')}</h2>
      </div>
      <button type="button" className="glass-controls-close" aria-label={t('关闭玻璃设置', 'Close glass settings')} onClick={onClose}><X size={17}/></button>
    </header>

    <div className="glass-controls-presets" aria-label={t('玻璃预设', 'Glass presets')}>
      {presets.map(preset => <button type="button" key={preset.en} onClick={() => onChange(preset.values)}>{t(preset.zh, preset.en)}</button>)}
    </div>

    <div className="glass-controls-mode">
      <div className="glass-control-heading"><span>{t('折射模式', 'Refraction mode')}</span>{settings.mode === 'shader' && <span className="glass-controls-experimental">{t('实验性', 'Experimental')}</span>}</div>
      <div className="glass-controls-mode-options" role="group" aria-label={t('折射模式', 'Refraction mode')}>
        {modes.map(mode => <button type="button" key={mode.value} aria-pressed={settings.mode === mode.value} onClick={() => onChange({ mode: mode.value })}>{mode.label}</button>)}
      </div>
      <p>{en ? selectedMode.description : selectedMode.zh}</p>
    </div>

    <div className="glass-controls-mode">
      <div className="glass-control-heading"><span>{t('文字颜色', 'Text colour')}</span></div>
      <div className="glass-controls-mode-options glass-controls-ink" role="group" aria-label={t('文字颜色', 'Text colour')}>
        {inks.map(ink => <button type="button" key={ink.value} aria-pressed={settings.ink === ink.value} onClick={() => onChange({ ink: ink.value })}>
          <i className={`ink-swatch ink-${ink.value}`} aria-hidden="true"/>{t(ink.zh, ink.en)}
        </button>)}
      </div>
      <p>{settings.ink === 'auto' ? t('根据玻璃背后的桌面亮度自动切换。', 'Switches with the brightness behind the glass.') : t('已锁定，不随背景变化。', 'Locked. Ignores the background.')}</p>
    </div>

    <div className="glass-controls-mode">
      <div className="glass-control-heading"><span>{t('桌面刷新帧率', 'Desktop frame rate')}</span><output>{settings.frameRate ? `${settings.frameRate} FPS` : t('无限制', 'No limit')}</output></div>
      <div className="glass-controls-mode-options glass-controls-fps" role="group" aria-label={t('桌面刷新帧率', 'Desktop frame rate')}>
        {frameRates.map(rate => <button type="button" key={rate.value} aria-pressed={settings.frameRate === rate.value} onClick={() => onChange({ frameRate: rate.value })}>{t(rate.zh, rate.en)}</button>)}
      </div>
      <p>{t('只在玻璃背后的画面变化时刷新。帧率越高越跟手，也越耗电。', 'Refreshes only when the view behind the glass changes. Higher is smoother and uses more power.')}</p>
    </div>

    <div className="glass-controls-sliders">
      {sliders.map(slider => <label className="glass-control-range" key={slider.key} htmlFor={`glass-${slider.key}`}>
        <span className="glass-control-heading"><span>{t(slider.zh, slider.en)}</span><output htmlFor={`glass-${slider.key}`}>{slider.format(settings[slider.key])}</output></span>
        <input id={`glass-${slider.key}`} type="range" min={slider.min} max={slider.max} step={slider.step} value={settings[slider.key]} aria-valuetext={slider.format(settings[slider.key])} onChange={event => onChange({ [slider.key]: Number(event.currentTarget.value) })}/>
      </label>)}
    </div>

    <div className="glass-controls-switches">
      <label className="glass-control-switch">
        <span><strong>{t('浅色背景增强', 'Over a light background')}</strong><small>{t('加深玻璃，保持文字清晰', 'Darken glass for readable text')}</small></span>
        <input type="checkbox" role="switch" checked={settings.overLight} onChange={event => onChange({ overLight: event.currentTarget.checked })}/>
      </label>
      <label className="glass-control-switch">
        <span><strong>{t('桌面实时折射', 'Live desktop refraction')}</strong><small>{t('取样玻璃背后的桌面画面', 'Sample the desktop behind the glass')}</small></span>
        <input type="checkbox" role="switch" checked={settings.desktopRefraction} onChange={event => onChange({ desktopRefraction: event.currentTarget.checked })}/>
      </label>
      <div className={`glass-controls-status ${settings.desktopRefraction && desktopStatus === 'unavailable' ? 'is-unavailable' : ''}`} role="status"><i aria-hidden="true"/>{status}</div>
      <p className="glass-controls-privacy">{t('桌面取样仅在本机内存中处理，不保存、不上传。', 'Desktop samples stay in local memory. Never saved or uploaded.')}</p>
    </div>

    <footer className="glass-controls-footer">
      <span>{t('实时生效 · 自动保存', 'Live preview · Auto saved')}</span>
      <button type="button" onClick={() => onChange({ ...defaultGlass })}><RotateCcw size={13}/>{t('恢复默认', 'Reset')}</button>
    </footer>
  </section>
}

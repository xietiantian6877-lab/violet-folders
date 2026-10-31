import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpLeft, Check, ChevronDown, ChevronUp, Ellipsis, Folder, Languages, Pin, Power, SlidersHorizontal, X } from 'lucide-react'
import { bridge, isBrowserPreview } from './bridge'
import type { AppState, FolderEntry, GlassSettings } from './types'
import { defaultGlass } from './glass-defaults'
import GlassControls from './GlassControls'
import { useDesktopStream } from './useDesktopStream'
import Glass, { PreviewScene } from './Glass'

const starting: AppState = { entries: [], collapsed: false, language: 'zh-CN', launchAtLogin: false, monitorStatus: 'starting', maxHeight: 800, maxWidth: 520, glass: defaultGlass }

function App() {
  const [state, setState] = useState(starting)
  const [menuOpen, setMenuOpen] = useState(false)
  const [glassOpen, setGlassOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const optics = useDesktopStream(loaded && state.glass.desktopRefraction)
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [listHeight, setListHeight] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const en = state.language === 'en'
  const t = (zh: string, english: string) => en ? english : zh
  const elasticX = 8 + Math.ceil(state.glass.elasticity * 100)
  const elasticY = 10 + Math.ceil(state.glass.elasticity * 22)
  const shelfWidth = Math.min(504, Math.max(290, state.maxWidth - 2 * elasticX))
  // Keep the panel and native window stationary while elasticity is adjusted.
  const controlsShelfWidth = Math.min(720, state.maxWidth)
  const sideControls = glassOpen && controlsShelfWidth + 360 <= state.maxWidth

  useEffect(() => {
    let mounted = true
    bridge.getState().then(next => { if (mounted) { setState(next); setLoaded(true) } }).catch(() => setNotice('无法连接应用 / Cannot connect to app'))
    const unsubscribe = bridge.onState(next => setState(next))
    return () => { mounted = false; unsubscribe() }
  }, [])

  useEffect(() => { document.documentElement.lang = state.language }, [state.language])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (glassOpen) { setGlassOpen(false); menuButton.current?.focus({ preventScroll: true }) } else if (menuOpen) { setMenuOpen(false); menuButton.current?.focus({ preventScroll: true }) } else bridge.setCollapsed(true) }
      if (menuOpen && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.settings-menu > button') ?? [])
        if (!items.length) return
        event.preventDefault()
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[index].focus({ preventScroll: true })
      }
    }
    const outside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.settings-menu, .menu-trigger')) setMenuOpen(false) }
    document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', outside) }
  }, [menuOpen, glassOpen])

  useEffect(() => {
    if (menuOpen) root.current?.querySelector<HTMLButtonElement>('.settings-menu > button')?.focus({ preventScroll: true })
  }, [menuOpen])
  useEffect(() => {
    if (glassOpen) root.current?.querySelector<HTMLButtonElement>('.glass-controls-close')?.focus({ preventScroll: true })
  }, [glassOpen])

  useLayoutEffect(() => {
    const hasNotice = Boolean(notice) || state.monitorStatus === 'error'
    const targetHeight = state.collapsed || !state.entries.length ? 0 : Math.min(state.entries.length * 82 + 2 * elasticY, Math.max(0, state.maxHeight - 76 - elasticY - (hasNotice ? 56 : 0)))
    setListHeight(targetHeight)
    // Grow before the entrance animation; delay shrinking until the fold has finished.
    const resize = () => {
      const measuredMenu = root.current?.querySelector('.settings-menu')?.getBoundingClientRect().bottom ?? 330
      const measuredGlass = root.current?.querySelector('.glass-controls')?.getBoundingClientRect().bottom ?? 720
      const minimumHeight = Math.ceil(Math.max(menuOpen ? measuredMenu + 14 : 68, glassOpen ? Math.max(720, measuredGlass + 14) : 68))
      const height = Math.ceil(Math.max(76 + elasticY + targetHeight + (hasNotice ? 56 : 0), minimumHeight))
      return bridge.setContentSize({ width: glassOpen ? controlsShelfWidth + (sideControls ? 360 : 0) : Math.min(shelfWidth + 2 * elasticX, state.maxWidth), height, minimumHeight })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    if (state.collapsed && !menuOpen && !glassOpen) timer = setTimeout(resize, 280)
    else resize()
    const observer = new ResizeObserver(resize)
    const panel = root.current?.querySelector('.glass-controls')
    if (panel) observer.observe(panel)
    window.addEventListener('resize', resize)
    return () => { if (timer) clearTimeout(timer); observer.disconnect(); window.removeEventListener('resize', resize) }
  }, [state.collapsed, state.entries.length, state.maxHeight, state.maxWidth, menuOpen, glassOpen, notice, state.monitorStatus, state.language, elasticX, elasticY, shelfWidth, controlsShelfWidth, sideControls])

  useLayoutEffect(() => {
    let frame = 0
    const sendRegions = () => {
      if (!root.current) return
      const viewport = root.current.querySelector('.folder-viewport')!.getBoundingClientRect()
      const regions = Array.from(root.current.querySelectorAll<HTMLElement>('[data-interactive]')).flatMap(element => {
        const surface = element.querySelector<HTMLElement>('.liquid-surface > .glass') ?? element
        const rect = surface.getBoundingClientRect()
        const inList = Boolean(element.closest('.folder-viewport'))
        if (inList && state.collapsed && listHeight === 0) return []
        const x = Math.max(0, rect.left)
        const y = Math.max(0, rect.top, inList ? viewport.top : 0)
        const right = Math.min(window.innerWidth, rect.right)
        const bottom = Math.min(window.innerHeight, rect.bottom, inList ? viewport.bottom : window.innerHeight)
        if (right <= x || bottom <= y) return []
        return [{ x, y, width: right - x, height: bottom - y, radius: Math.min(parseFloat(getComputedStyle(surface).borderRadius) || 0, (bottom - y) / 2) }]
      })
      bridge.setHitRegions(regions)
    }
    let until = performance.now() + 450
    const animate = () => { sendRegions(); frame = performance.now() < until ? requestAnimationFrame(animate) : 0 }
    const schedule = () => { until = performance.now() + 450; if (!frame) frame = requestAnimationFrame(animate) }
    animate()
    const observer = new ResizeObserver(sendRegions)
    if (root.current) observer.observe(root.current)
    const mutations = new MutationObserver(schedule)
    root.current?.querySelectorAll('.liquid-surface').forEach(surface => mutations.observe(surface, { attributes: true, attributeFilter: ['style'] }))
    document.addEventListener('scroll', sendRegions, true)
    window.addEventListener('resize', sendRegions)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect(); document.removeEventListener('scroll', sendRegions, true); window.removeEventListener('resize', sendRegions) }
  }, [state.collapsed, state.entries, listHeight, menuOpen, glassOpen, notice, state.monitorStatus, state.language, state.glass])

  const errorText = (code?: string) => {
    if (code === 'folder-unavailable') return t('文件夹不可用，请检查磁盘或网络连接。', 'Folder unavailable. Check the drive or network.')
    if (code === 'unavailable-in-development') return t('请使用打包版本设置开机启动。', 'Use the packaged app to set launch at login.')
    return t('暂时无法完成操作，请稍后重试。', 'The action could not complete. Please try again.')
  }
  const open = async (entry: FolderEntry) => {
    setOpening(entry.path)
    try { const result = await bridge.openFolder(entry.path); if (!result.ok) setNotice(errorText(result.error)) }
    catch { setNotice(errorText()) }
    finally { setOpening(null) }
  }

  const updateGlass = async (patch: Partial<GlassSettings>) => {
    setState(previous => ({ ...previous, glass: { ...previous.glass, ...patch } }))
    try { const result = await bridge.setGlassSettings(patch); if (!result.ok) setNotice(errorText(result.error)) }
    catch { setNotice(errorText()) }
  }

  return <main className={`shelf ${isBrowserPreview ? 'browser-preview' : ''} ${sideControls ? 'side-controls' : ''}`} ref={root} style={{ '--available-height': `${state.maxHeight}px`, '--shelf-width': `${shelfWidth}px`, '--elastic-x': `${elasticX}px`, '--elastic-y': `${elasticY}px` } as React.CSSProperties} aria-label={t('紫璃文件夹', 'Violet Folders')}>
    {isBrowserPreview && <PreviewScene/>}
    <Glass className="header-glass" settings={state.glass} optics={optics}>
      <header className="toolbar">
        <div className="drag-handle" title={t('拖动移动 · Ctrl+Alt+F 折叠 / 展开', 'Drag to move · Ctrl+Alt+F to fold / unfold')}>
          <svg className="brand-mark" width="21" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5.5L9.3 18c1.2 2.4 3.3 2.4 4.6-.2L21 4M8.5 4L12 11.5 15.6 4" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="brand-name">{t('紫璃', 'Violet')}</span>
          <span className="folder-count" aria-label={t('文件夹数量', 'Folder count')}>{state.entries.length}</span>
        </div>
        <button className="icon-button" onClick={() => { setMenuOpen(false); bridge.setCollapsed(!state.collapsed) }} title={t('折叠 / 展开全部', 'Fold / unfold all')} aria-label={t('折叠 / 展开全部', 'Fold / unfold all')} aria-expanded={!state.collapsed}>{state.collapsed ? <ChevronDown size={18}/> : <ChevronUp size={18}/>}</button>
        <button className={`icon-button menu-trigger ${menuOpen ? 'selected' : ''}`} ref={menuButton} onClick={() => setMenuOpen(value => !value)} title={t('设置', 'Settings')} aria-label={t('设置', 'Settings')} aria-haspopup="menu" aria-expanded={menuOpen}><Ellipsis size={18}/></button>
        <button className="icon-button close-button" onClick={() => bridge.quit()} title={t('关闭并退出', 'Close and quit')} aria-label={t('关闭并退出', 'Close and quit')}><X size={17}/></button>
      </header>
    </Glass>

    <div className={`folder-viewport ${state.collapsed ? 'folded' : ''}`} style={{ height: listHeight }} aria-hidden={state.collapsed}>
      <div className="folder-list" ref={list} inert={state.collapsed}>
        {state.entries.map(entry => <div className="folder-entrance" key={entry.path}>
          <Glass settings={state.glass} optics={optics} className={`folder-glass ${entry.isPinned ? 'is-pinned' : ''}`}>
            <article className="folder-row">
              <button className="open-folder" onClick={() => open(entry)} disabled={opening === entry.path} title={entry.path} aria-label={`${t('打开文件夹', 'Open folder')} ${entry.path}`}>
                <span className={`folder-symbol ${entry.isOpen ? 'is-open' : ''}`}><Folder size={23} strokeWidth={1.55}/><i/></span>
                <span className="path-text"><strong>{entry.name}</strong><span className="parent-path">{entry.parentPath || t('磁盘根目录', 'Drive root')}</span></span>
              </button>
              <button className={`pin-button ${entry.isPinned ? 'active' : ''}`} onClick={() => bridge.togglePin(entry.path)} aria-pressed={entry.isPinned} title={entry.isPinned ? t('取消常驻', 'Unpin folder') : t('常驻：关闭后仍保留', 'Pin: keep after closing')} aria-label={`${entry.isPinned ? t('取消常驻', 'Unpin') : t('常驻', 'Pin')} ${entry.name}`}>
                {entry.isPinned ? <Pin size={15} fill="currentColor" strokeWidth={1.4}/> : <Pin size={15} strokeWidth={1.6}/>}
                <span>{entry.isPinned ? t('常驻', 'Kept') : t('固定', 'Pin')}</span>
              </button>
            </article>
          </Glass>
        </div>)}
      </div>
    </div>

    {notice && <div className="notice" role="status" data-interactive>{notice}<button className="icon-button" aria-label={t('关闭提示', 'Dismiss notice')} onClick={() => setNotice('')}><X size={15}/></button></div>}
    {state.monitorStatus === 'error' && !notice && <div className="notice" role="status" data-interactive>{t('资源管理器连接中断，正在重连…', 'Explorer disconnected. Reconnecting…')}</div>}

    {menuOpen && <section className="settings-menu" role="menu" aria-label={t('设置', 'Settings')} data-interactive>
      <div className="menu-title"><span>{t('紫璃文件夹', 'Violet Folders')}</span><span>1.2</span></div>
      <button role="menuitem" onClick={() => { setMenuOpen(false); setGlassOpen(true) }}><SlidersHorizontal size={17}/><span>{t('液态玻璃效果', 'Liquid glass effect')}</span></button>
      <button role="menuitemcheckbox" aria-checked={state.launchAtLogin} onClick={async () => { try { const result = await bridge.setLaunchAtLogin(!state.launchAtLogin); if (!result.ok) setNotice(errorText(result.error)) } catch { setNotice(errorText()) } }}><Power size={16}/><span>{t('开机启动', 'Launch at login')}</span><span className={`toggle ${state.launchAtLogin ? 'on' : ''}`}><i/></span></button>
      <button role="menuitem" onClick={() => bridge.setLanguage(en ? 'zh-CN' : 'en')}><Languages size={17}/><span>{en ? '简体中文' : 'English'}</span><Check size={14} className="language-check"/></button>
      <button role="menuitem" onClick={() => { bridge.resetPosition(); setMenuOpen(false) }}><ArrowUpLeft size={17}/><span>{t('回到屏幕左上角', 'Move to top left')}</span></button>
      <div className="menu-divider"/>
      <p>{t('打开文件夹自动出现，固定后常驻。', 'Open a folder to add it. Pin it to keep it.')}</p>
      <div className="menu-shortcut"><span>{t('全部折叠', 'Fold everything')}</span><kbd>Ctrl Alt F</kbd></div>
      <div className="menu-divider"/>
      <button role="menuitem" onClick={() => bridge.quit()}><X size={17}/><span>{t('退出紫璃', 'Quit Violet Folders')}</span></button>
    </section>}
    {glassOpen && <GlassControls settings={state.glass} en={en} desktopStatus={optics.status} onChange={updateGlass} onClose={() => setGlassOpen(false)}/>}
    <span className="sr-only" role="status">{state.monitorStatus === 'starting' ? t('正在连接资源管理器', 'Connecting to Explorer') : ''}</span>
  </main>
}

export default App

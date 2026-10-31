import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import LiquidGlass from 'liquid-glass-react'
import { ArrowUpLeft, Check, ChevronDown, ChevronUp, Ellipsis, Folder, Languages, Pin, Power, X } from 'lucide-react'
import { bridge, isBrowserPreview } from './bridge'
import type { AppState, FolderEntry } from './types'

const starting: AppState = { entries: [], collapsed: false, language: 'zh-CN', launchAtLogin: false, monitorStatus: 'starting', maxHeight: 800, maxWidth: 520 }

function Glass({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass-frame ${className}`} data-interactive>
    <LiquidGlass className="liquid-surface" cornerRadius={36} displacementScale={48} blurAmount={0.1} saturation={125} aberrationIntensity={1.2} elasticity={0} padding="0" mode="standard" style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' }}>
      {children}
    </LiquidGlass>
  </div>
}

function App() {
  const [state, setState] = useState(starting)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [listHeight, setListHeight] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const en = state.language === 'en'
  const t = (zh: string, english: string) => en ? english : zh

  useEffect(() => {
    let mounted = true
    bridge.getState().then(next => { if (mounted) setState(next) }).catch(() => setNotice('无法连接应用 / Cannot connect to app'))
    const unsubscribe = bridge.onState(next => setState(next))
    return () => { mounted = false; unsubscribe() }
  }, [])

  useEffect(() => { document.documentElement.lang = state.language }, [state.language])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (menuOpen) { setMenuOpen(false); menuButton.current?.focus({ preventScroll: true }) } else bridge.setCollapsed(true) }
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
  }, [menuOpen])

  useEffect(() => {
    if (menuOpen) root.current?.querySelector<HTMLButtonElement>('.settings-menu > button')?.focus({ preventScroll: true })
  }, [menuOpen])

  useLayoutEffect(() => {
    const hasNotice = Boolean(notice) || state.monitorStatus === 'error'
    const targetHeight = state.collapsed ? 0 : Math.min(state.entries.length * 82, Math.max(0, state.maxHeight - 86 - (hasNotice ? 56 : 0)))
    setListHeight(targetHeight)
    const measuredMenu = root.current?.querySelector('.settings-menu')?.getBoundingClientRect().bottom ?? 330
    const height = Math.ceil(Math.max(68 + targetHeight + (hasNotice ? 56 : 0), menuOpen ? measuredMenu + 14 : 68))
    // Grow before the entrance animation; delay shrinking until the fold has finished.
    const resize = () => bridge.setContentSize({ width: Math.min(504, state.maxWidth), height, minimumHeight: menuOpen ? Math.ceil(measuredMenu + 14) : 68 })
    let timer: ReturnType<typeof setTimeout> | undefined
    if (state.collapsed && !menuOpen) timer = setTimeout(resize, 280)
    else resize()
    return () => { if (timer) clearTimeout(timer) }
  }, [state.collapsed, state.entries.length, state.maxHeight, state.maxWidth, menuOpen, notice, state.monitorStatus, state.language])

  useLayoutEffect(() => {
    let frame = 0
    const sendRegions = () => {
      if (!root.current) return
      const viewport = root.current.querySelector('.folder-viewport')!.getBoundingClientRect()
      const regions = Array.from(root.current.querySelectorAll<HTMLElement>('[data-interactive]')).flatMap(element => {
        const rect = element.getBoundingClientRect()
        const inList = Boolean(element.closest('.folder-viewport'))
        if (inList && state.collapsed && listHeight === 0) return []
        const x = Math.max(0, rect.left)
        const y = Math.max(0, rect.top, inList ? viewport.top : 0)
        const right = Math.min(window.innerWidth, rect.right)
        const bottom = Math.min(window.innerHeight, rect.bottom, inList ? viewport.bottom : window.innerHeight)
        if (right <= x || bottom <= y) return []
        return [{ x, y, width: right - x, height: bottom - y, radius: Math.min(parseFloat(getComputedStyle(element).borderRadius) || 0, (bottom - y) / 2) }]
      })
      bridge.setHitRegions(regions)
    }
    const until = performance.now() + 450
    const animate = () => { sendRegions(); if (performance.now() < until) frame = requestAnimationFrame(animate) }
    animate()
    const observer = new ResizeObserver(sendRegions)
    if (root.current) observer.observe(root.current)
    document.addEventListener('scroll', sendRegions, true)
    window.addEventListener('resize', sendRegions)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('scroll', sendRegions, true); window.removeEventListener('resize', sendRegions) }
  }, [state.collapsed, state.entries, listHeight, menuOpen, notice, state.monitorStatus, state.language])

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

  return <main className={`shelf ${isBrowserPreview ? 'browser-preview' : ''}`} ref={root} aria-label={t('紫璃文件夹', 'Violet Folders')}>
    <Glass className="header-glass">
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
          <Glass className={`folder-glass ${entry.isPinned ? 'is-pinned' : ''}`}>
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
      <div className="menu-title"><span>{t('紫璃文件夹', 'Violet Folders')}</span><span>1.1</span></div>
      <button role="menuitemcheckbox" aria-checked={state.launchAtLogin} onClick={async () => { try { const result = await bridge.setLaunchAtLogin(!state.launchAtLogin); if (!result.ok) setNotice(errorText(result.error)) } catch { setNotice(errorText()) } }}><Power size={16}/><span>{t('开机启动', 'Launch at login')}</span><span className={`toggle ${state.launchAtLogin ? 'on' : ''}`}><i/></span></button>
      <button role="menuitem" onClick={() => bridge.setLanguage(en ? 'zh-CN' : 'en')}><Languages size={17}/><span>{en ? '简体中文' : 'English'}</span><Check size={14} className="language-check"/></button>
      <button role="menuitem" onClick={() => { bridge.resetPosition(); setMenuOpen(false) }}><ArrowUpLeft size={17}/><span>{t('回到屏幕左上角', 'Move to top left')}</span></button>
      <div className="menu-divider"/>
      <p>{t('打开文件夹自动出现，固定后常驻。', 'Open a folder to add it. Pin it to keep it.')}</p>
      <div className="menu-shortcut"><span>{t('全部折叠', 'Fold everything')}</span><kbd>Ctrl Alt F</kbd></div>
      <div className="menu-divider"/>
      <button role="menuitem" onClick={() => bridge.quit()}><X size={17}/><span>{t('退出紫璃', 'Quit Violet Folders')}</span></button>
    </section>}
    <span className="sr-only" role="status">{state.monitorStatus === 'starting' ? t('正在连接资源管理器', 'Connecting to Explorer') : ''}</span>
  </main>
}

export default App

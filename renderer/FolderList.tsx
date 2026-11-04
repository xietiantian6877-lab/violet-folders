import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Folder, Pin } from 'lucide-react'
import Glass from './Glass'
import { bridge } from './bridge'
import type { FolderEntry, GlassSettings } from './types'
import type { DesktopOptics } from './useDesktopStream'

/** Row pitch: 52px glass + 8px gap. Must match .folder-entrance in style.css. */
export const ROW_PITCH = 60
const LONG_PRESS_MS = 320
const PRESS_SLOP = 6
const EDGE_SCROLL_ZONE = 40

/** Lets every glass surface re-sample the desktop while rows move. */
export const announceMotion = () => window.dispatchEvent(new Event('violet:motion'))

interface Props {
  entries: FolderEntry[]
  collapsed: boolean
  height: number
  openHeight: number
  settings: GlassSettings
  optics: DesktopOptics
  opening: string | null
  t: (zh: string, en: string) => string
  onOpen(entry: FolderEntry): void
  onTogglePin(entry: FolderEntry): void
  onReorder(paths: string[]): void
}

interface DragState {
  path: string
  from: number
  target: number
  pointerId: number
  startY: number
  startScroll: number
  lastY: number
  row: HTMLElement
  scrollFrame: number
}

export default function FolderList({ entries, collapsed, height, openHeight, settings, optics, opening, t, onOpen, onTogglePin, onReorder }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const lastTops = useRef(new Map<string, number>())
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; pointerId: number; x: number; y: number; path: string; row: HTMLElement } | null>(null)
  const drag = useRef<DragState | null>(null)
  const suppressClickUntil = useRef(0)
  // Optimistic order after a drop, until the shelf state confirms it.
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  // Stagger delays apply only while folding or unfolding.
  // Derived during render so the stagger class lands in the same commit as
  // the fold itself; a later effect would miss the transitions' start.
  const [folding, setFolding] = useState(false)
  const [foldSeen, setFoldSeen] = useState(collapsed)
  if (foldSeen !== collapsed) { setFoldSeen(collapsed); setFolding(true) }

  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  const shown = order && order.length === entries.length && order.every(path => byPath.has(path))
    ? order.map(path => byPath.get(path)!) : entries

  useEffect(() => {
    if (order && entries.map(entry => entry.path).join('\n') === order.join('\n')) setOrder(null)
  }, [entries, order])

  // FLIP: rows that changed position glide from where they were.
  useLayoutEffect(() => {
    const moved: HTMLElement[] = []
    for (const [path, row] of rows.current) {
      const top = row.offsetTop
      const before = lastTops.current.get(path)
      lastTops.current.set(path, top)
      if (before === undefined || before === top || drag.current) continue
      row.style.transition = 'none'
      row.style.transform = `translateY(${before - top}px)`
      moved.push(row)
    }
    for (const path of lastTops.current.keys()) if (!rows.current.has(path)) lastTops.current.delete(path)
    if (!moved.length) return
    void list.current?.offsetHeight
    requestAnimationFrame(() => {
      for (const row of moved) { row.style.transition = ''; row.style.transform = '' }
      announceMotion()
    })
  })

  useEffect(() => {
    announceMotion()
    if (!folding) return
    const timer = setTimeout(() => setFolding(false), 620)
    return () => clearTimeout(timer)
  }, [collapsed, folding])

  // Edge fades replace a visible scrollbar.
  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const update = () => {
      const top = element.scrollTop > 2
      const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 2
      element.dataset.fade = `${top ? 'top' : ''} ${bottom ? 'bottom' : ''}`.trim()
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => { element.removeEventListener('scroll', update); observer.disconnect() }
  }, [shown.length, openHeight])

  const placeRows = (state: DragState) => {
    const element = list.current
    if (!element) return
    const offset = state.lastY - state.startY + (element.scrollTop - state.startScroll)
    const count = shown.length
    const target = Math.max(0, Math.min(count - 1, Math.round(state.from + offset / ROW_PITCH)))
    state.target = target
    state.row.style.transform = `translateY(${offset}px) scale(1.025)`
    shown.forEach((entry, index) => {
      if (entry.path === state.path) return
      const row = rows.current.get(entry.path)
      if (!row) return
      const shift = state.from < target && index > state.from && index <= target ? -ROW_PITCH
        : state.from > target && index >= target && index < state.from ? ROW_PITCH : 0
      row.style.transform = shift ? `translateY(${shift}px)` : ''
    })
    announceMotion()
  }

  const edgeScroll = () => {
    const state = drag.current
    const element = list.current
    if (!state || !element) return
    const bounds = element.getBoundingClientRect()
    const above = bounds.top + EDGE_SCROLL_ZONE - state.lastY
    const below = state.lastY - (bounds.bottom - EDGE_SCROLL_ZONE)
    const speed = above > 0 ? -Math.min(14, above / 3) : below > 0 ? Math.min(14, below / 3) : 0
    if (speed) {
      const before = element.scrollTop
      element.scrollTop += speed
      if (element.scrollTop !== before) placeRows(state)
    }
    state.scrollFrame = requestAnimationFrame(edgeScroll)
  }

  const beginDrag = (path: string, row: HTMLElement, pointerId: number, y: number) => {
    const from = shown.findIndex(entry => entry.path === path)
    if (from < 0 || !list.current) return
    try { row.setPointerCapture(pointerId) } catch { /* The pointer was already released. */ }
    bridge.holdPointer(true)
    drag.current = { path, from, target: from, pointerId, startY: y, startScroll: list.current.scrollTop, lastY: y, row, scrollFrame: 0 }
    suppressClickUntil.current = Number.POSITIVE_INFINITY
    setDragging(path)
    placeRows(drag.current)
    drag.current.scrollFrame = requestAnimationFrame(edgeScroll)
  }

  const finishDrag = () => {
    const state = drag.current
    if (!state) return
    cancelAnimationFrame(state.scrollFrame)
    drag.current = null
    bridge.holdPointer(false)
    suppressClickUntil.current = performance.now() + 250
    const next = shown.map(entry => entry.path)
    next.splice(state.target, 0, ...next.splice(state.from, 1))
    // Glide the lifted row into its slot, then commit the order. The commit
    // and the transform reset land in one layout pass, so nothing jumps.
    state.row.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)'
    state.row.style.transform = `translateY(${(state.target - state.from) * ROW_PITCH}px)`
    const commit = (event?: TransitionEvent) => {
      if (event && (event.target !== state.row || event.propertyName !== 'transform')) return
      state.row.removeEventListener('transitionend', commit)
      clearTimeout(fallback)
      for (const row of rows.current.values()) { row.style.transition = 'none'; row.style.transform = '' }
      lastTops.current.clear()
      setDragging(null)
      if (state.target !== state.from) { setOrder(next); onReorder(next) }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const row of rows.current.values()) row.style.transition = ''
        for (const [path, row] of rows.current) lastTops.current.set(path, row.offsetTop)
      }))
      announceMotion()
    }
    const fallback = setTimeout(() => commit(), 300)
    state.row.addEventListener('transitionend', commit)
  }

  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null } }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, path: string) => {
    if (event.button !== 0 || collapsed || drag.current || (event.target as HTMLElement).closest('.pin-button')) return
    cancelPress()
    const row = event.currentTarget
    const { pointerId, clientX, clientY } = event
    press.current = { pointerId, x: clientX, y: clientY, path, row, timer: setTimeout(() => {
      const pending = press.current
      press.current = null
      if (pending) beginDrag(pending.path, pending.row, pending.pointerId, pending.y)
    }, LONG_PRESS_MS) }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pending = press.current
    if (pending && pending.pointerId === event.pointerId && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > PRESS_SLOP) cancelPress()
    const state = drag.current
    if (state && state.pointerId === event.pointerId) { state.lastY = event.clientY; placeRows(state) }
  }

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === event.pointerId) cancelPress()
    if (drag.current?.pointerId === event.pointerId) finishDrag()
  }

  useEffect(() => () => {
    cancelPress()
    if (drag.current) { cancelAnimationFrame(drag.current.scrollFrame); bridge.holdPointer(false) }
  }, [])

  return <div className={`folder-viewport ${collapsed ? 'folded' : ''} ${folding ? 'fold-motion' : ''} ${dragging ? 'is-sorting' : ''}`} style={{ height }} aria-hidden={collapsed}>
    <div className="folder-list" ref={list} inert={collapsed} style={{ height: openHeight }}>
      {shown.map((entry, index) => <div
        className={`folder-entrance ${dragging === entry.path ? 'is-dragging' : ''}`}
        key={entry.path}
        ref={element => { if (element) rows.current.set(entry.path, element); else rows.current.delete(entry.path) }}
        style={{ '--i': Math.min(index, 8), '--n': Math.min(shown.length - 1 - index, 8) } as React.CSSProperties}
        onPointerDown={event => onPointerDown(event, entry.path)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onContextMenu={event => event.preventDefault()}>
        <Glass settings={settings} optics={optics} className={`folder-glass ${entry.isPinned ? 'is-pinned' : ''}`}>
          <article className="folder-row">
            <button className="open-folder" onClick={() => { if (performance.now() >= suppressClickUntil.current) onOpen(entry) }} disabled={opening === entry.path} title={`${entry.path}\n${t('长按拖动排序', 'Press and hold to reorder')}`} aria-label={`${t('打开文件夹', 'Open folder')} ${entry.path}`}>
              <span className={`folder-symbol ${entry.isOpen ? 'is-open' : ''}`}><Folder size={16} strokeWidth={1.8}/><i/></span>
              <span className="path-text"><strong>{entry.name}</strong><span className="parent-path">{entry.parentPath || t('磁盘根目录', 'Drive root')}</span></span>
            </button>
            <button className={`pin-button ${entry.isPinned ? 'active' : ''}`} onClick={() => onTogglePin(entry)} aria-pressed={entry.isPinned} title={entry.isPinned ? t('取消常驻', 'Unpin folder') : t('常驻：关闭后仍保留', 'Pin: keep after closing')} aria-label={`${entry.isPinned ? t('取消常驻', 'Unpin') : t('常驻', 'Pin')} ${entry.name}`}>
              {entry.isPinned ? <Pin size={15} fill="currentColor" strokeWidth={1.4}/> : <Pin size={15} strokeWidth={1.6}/>}
              <span>{entry.isPinned ? t('常驻', 'Kept') : t('固定', 'Pin')}</span>
            </button>
          </article>
        </Glass>
      </div>)}
    </div>
  </div>
}


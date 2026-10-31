import type { DesktopFrameSource, DesktopGeometry, DesktopSourceResult } from './types'

export interface DesktopOptics {
  stream: MediaStream | null
  source: DesktopFrameSource | null
  geometry: DesktopGeometry | null
  status: 'starting' | 'ready' | 'unavailable' | 'preview'
}

interface DesktopStreamOptions {
  getSource(options?: { refresh?: boolean }): Promise<DesktopSourceResult>
  stopSource(): Promise<unknown>
  onGeometry(callback: (geometry: DesktopGeometry | null) => void): () => void
  onFrame(callback: (frame: VideoFrame, geometry: DesktopGeometry) => void): () => void
  update(optics: DesktopOptics): void
}

// GPU frames are consumed synchronously. React only observes source/lifecycle
// changes; a new desktop frame never triggers a component render.
export function startDesktopStream({ getSource, stopSource, onGeometry, onFrame, update }: DesktopStreamOptions): () => void {
  const consumers = new Set<(frame: VideoFrame, geometry: DesktopGeometry) => void>()
  const source: DesktopFrameSource = { subscribe(callback) {
    if (disposed) return () => {}
    consumers.add(callback)
    if (status === 'ready' && cachedFrame && geometry) {
      try { callback(cachedFrame, geometry) } catch { /* A newly mounted surface cannot interrupt capture. */ }
    }
    return () => { consumers.delete(callback) }
  } }
  let disposed = false
  let revision = 0
  let geometryRevision = 0
  let connecting = false
  let connected = false
  let geometryUnavailable = false
  let displayId: string | null = null
  let geometry: DesktopGeometry | null = null
  let status: DesktopOptics['status'] = 'starting'
  let retry: ReturnType<typeof setTimeout> | undefined
  let firstFrame: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let cachedFrame: VideoFrame | null = null

  const clearCachedFrame = () => { cachedFrame?.close(); cachedFrame = null }

  const publish = (nextStatus: DesktopOptics['status']) => {
    status = nextStatus
    if (status !== 'ready') clearCachedFrame()
    update({ stream: null, source: status === 'ready' ? source : null, geometry, status })
  }
  const clearTimers = () => { clearTimeout(retry); retry = undefined; clearTimeout(firstFrame); firstFrame = undefined }
  const retryConnection = (delay = Math.min(500 * 2 ** Math.min(failures, 4), 8000)) => {
    clearTimers()
    if (disposed || geometryUnavailable) return
    failures += 1
    retry = setTimeout(() => { retry = undefined; void connect(true) }, delay)
  }
  const connect = async (refresh = false) => {
    if (disposed || geometryUnavailable) return
    const request = ++revision
    const sourceGeometryRevision = geometryRevision
    connecting = true
    connected = false
    clearTimers()
    publish('starting')
    try {
      const result = await getSource(refresh ? { refresh: true } : undefined)
      if (disposed || request !== revision) return
      if (!result.ok || !result.geometry) {
        if (result.error === 'desktop-capture-disabled') {
          geometryUnavailable = true
          geometry = null
          publish('unavailable')
          return
        }
        if (result.error === 'desktop-source-changed') { retryConnection(200); return }
        throw new Error('Desktop source unavailable')
      }
      if (sourceGeometryRevision !== geometryRevision && geometry && geometry.display.id !== result.geometry.display.id) {
        void connect(true)
        return
      }
      displayId = result.geometry.display.id
      if (sourceGeometryRevision === geometryRevision) geometry = result.geometry
      connected = true
      firstFrame = setTimeout(() => {
        if (disposed || request !== revision) return
        connected = false
        publish('unavailable')
        retryConnection()
      }, 2500)
    } catch {
      if (!disposed && request === revision) { publish('unavailable'); retryConnection() }
    } finally {
      if (request === revision) connecting = false
    }
  }
  const unsubscribeGeometry = onGeometry(next => {
    if (disposed) return
    geometryRevision += 1
    geometry = next
    if (!next) {
      geometryUnavailable = true
      ++revision
      connecting = false
      connected = false
      displayId = null
      clearTimers()
      publish('unavailable')
      return
    }
    const restored = geometryUnavailable
    geometryUnavailable = false
    const changedDisplay = displayId !== null && displayId !== next.display.id
    if (restored || changedDisplay || (!connected && !connecting && !retry)) {
      displayId = next.display.id
      void connect(true)
      return
    }
    publish(status)
  })
  const unsubscribeFrames = onFrame((frame, frameGeometry) => {
    if (disposed || !connected || geometryUnavailable || frameGeometry.display.id !== displayId) return
    const retained = frame.clone()
    clearCachedFrame()
    cachedFrame = retained
    clearTimeout(firstFrame)
    firstFrame = undefined
    failures = 0
    if (status !== 'ready') publish('ready')
    const currentGeometry = geometry || frameGeometry
    for (const callback of consumers) {
      try { callback(frame, currentGeometry) } catch { /* One surface cannot interrupt delivery to the others. */ }
    }
  })
  if (!connecting && !geometryUnavailable) void connect()
  return () => {
    disposed = true
    ++revision
    connected = false
    clearTimers()
    clearCachedFrame()
    unsubscribeGeometry()
    unsubscribeFrames()
    consumers.clear()
    void stopSource().catch(() => {})
  }
}

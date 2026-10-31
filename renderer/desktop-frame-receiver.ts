import type { DesktopGeometry } from './types'

const listeners = new Set<(frame: VideoFrame, geometry: DesktopGeometry) => void>()

// Keep receiving during teardown so late GPU frames are always released.
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.type !== 'violet-desktop-frame') return
  const { frame, geometry } = event.data
  if (!(frame instanceof VideoFrame)) return
  try {
    if (!geometry?.display || !geometry?.windowBounds) return
    for (const listener of listeners) {
      try { listener(frame, geometry) } catch { /* Every frame must still be released. */ }
    }
  } finally { frame.close() }
})

export function subscribeDesktopFrames(callback: (frame: VideoFrame, geometry: DesktopGeometry) => void): () => void {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

import { useEffect, useState } from 'react'
import { bridge, isBrowserPreview } from './bridge'
import { startDesktopStream, type DesktopOptics } from './desktop-stream-controller'
import { subscribeDesktopFrames } from './desktop-frame-receiver'
export type { DesktopOptics } from './desktop-stream-controller'

// One native capture supplies GPU VideoFrames to every glass surface. React
// observes lifecycle and geometry; frame delivery stays outside component state.
export function useDesktopStream(enabled: boolean): DesktopOptics {
  const [optics, setOptics] = useState<DesktopOptics>({ stream: null, source: null, geometry: null, status: isBrowserPreview ? 'preview' : 'starting' })
  useEffect(() => {
    if (isBrowserPreview) return
    if (!enabled) { setOptics({ stream: null, source: null, geometry: null, status: 'starting' }); return }
    return startDesktopStream({
      getSource: options => bridge.getDesktopSource(options),
      stopSource: () => bridge.stopDesktopCapture(),
      onGeometry: callback => bridge.onDesktopGeometry(callback),
      onFrame: subscribeDesktopFrames,
      update: setOptics,
    })
  }, [enabled])
  return optics
}

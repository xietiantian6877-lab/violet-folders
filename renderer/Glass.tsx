import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import LiquidGlass from 'liquid-glass-react'
import { isBrowserPreview } from './bridge'
import { chooseGlassInk, getOpticalCrop } from './optical-geometry'
import type { DesktopGeometry, GlassSettings } from './types'
import type { DesktopOptics } from './useDesktopStream'

export function PreviewScene({ style }: { style?: React.CSSProperties }) {
  return <div className="preview-scene" style={style} aria-hidden="true"><div className="preview-orb"/><span className="preview-word">Liquid<br/>Glass.</span><div className="preview-grid"/></div>
}

const linear = (channel: number) => {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export default function Glass({ children, settings, optics, className = '' }: { children: React.ReactNode; settings: GlassSettings; optics: DesktopOptics; className?: string }) {
  const container = useRef<HTMLDivElement>(null)
  const crop = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const geometryNow = useRef(optics.geometry)
  geometryNow.current = optics.geometry
  const requestDraw = useRef<() => void>(() => {})
  const [warp, setWarp] = useState<HTMLElement | null>(null)
  const [lightInk, setLightInk] = useState(true)
  const header = className.includes('header-glass')
  const radius = Math.min(settings.cornerRadius, header ? 23 : 36)
  const blur = (settings.overLight ? 12 : 4) + settings.blurAmount * 32
  // Include every RGB displacement and the blur kernel in the local source.
  // Sampling only the pill itself makes the refracted edges go transparent.
  const displacement = Math.abs(settings.displacementScale) * (settings.overLight ? 0.5 : 1)
  const aberration = settings.aberrationIntensity * 0.1
  const channelScale = settings.mode === 'shader' ? Math.max(1, Math.abs(1 - aberration)) : 1 + aberration
  const overscan = Math.ceil(blur * 3 + displacement * channelScale * 0.5 + 3)
  const hasSource = isBrowserPreview || Boolean(optics.source && optics.status === 'ready')

  useLayoutEffect(() => {
    const target = container.current?.querySelector<HTMLElement>('.glass__warp')
    if (target) setWarp(target)
    // The library composites complementary edge/center masks with "over",
    // yielding alpha 1-m+m². Add them instead so an opaque desktop frame stays
    // opaque and cannot reveal a second, unfiltered desktop through the glass.
    const composite = container.current?.querySelector('filter')?.lastElementChild
    if (composite?.localName === 'feComposite') {
      for (const [key, value] of Object.entries({ operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0' })) composite.setAttribute(key, value)
    }
  }, [])

  useLayoutEffect(() => {
    const filter = container.current?.querySelector('filter')
    if (!warp || !filter) return
    const update = () => {
      const css = getComputedStyle(warp)
      const width = parseFloat(css.width) || 1
      const height = parseFloat(css.height) || 1
      const x = Math.max(35, overscan / width * 100)
      const y = Math.max(35, overscan / height * 100)
      filter.setAttribute('x', `${-x}%`)
      filter.setAttribute('y', `${-y}%`)
      filter.setAttribute('width', `${100 + 2 * x}%`)
      filter.setAttribute('height', `${100 + 2 * y}%`)
      // Keep the displacement map on the pill while primitive inputs expand.
      const map = filter.querySelector('feImage')
      map?.setAttribute('width', String(width))
      map?.setAttribute('height', String(height))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(warp)
    return () => observer.disconnect()
  }, [warp, overscan])

  useEffect(() => {
    if (isBrowserPreview || !optics.source || !warp || !hasSource || !canvas.current || !crop.current) return
    const output = canvas.current
    const context = output.getContext('2d', { alpha: false })
    if (!context) return
    const meter = document.createElement('canvas')
    meter.width = 5
    meter.height = 3
    const meterContext = meter.getContext('2d', { willReadFrequently: true })
    let nextMeter = 0
    let previousLight: boolean | undefined
    let latestFrame: VideoFrame | null = null
    let latestGeometry: DesktopGeometry | null = null
    let animation = 0
    let until = 0
    const scrollport = container.current?.closest('.folder-viewport')

    const draw = (frame: VideoFrame, geometry: DesktopGeometry) => {
      const local = crop.current
      if (!local || document.hidden) return
      const surfaceRect = warp.getBoundingClientRect()
      if (surfaceRect.right <= 0 || surfaceRect.bottom <= 0 || surfaceRect.left >= innerWidth || surfaceRect.top >= innerHeight) return
      if (scrollport) {
        const visible = scrollport.getBoundingClientRect()
        if (surfaceRect.bottom <= visible.top || surfaceRect.top >= visible.bottom || visible.height < 1) return
      }
      const cropRect = local.getBoundingClientRect()
      const css = getComputedStyle(local)
      const width = parseFloat(css.width)
      const height = parseFloat(css.height)
      if (!(width > 0 && height > 0)) return
      // Keep canvas resolution at the captured pixel density. Elastic scaling
      // affects the sampled rectangle, never the desktop coordinate origin.
      const density = Math.max(geometry.display.width > 0 ? frame.displayWidth / geometry.display.width : devicePixelRatio, 1)
      const pixelWidth = Math.max(1, Math.round(width * density))
      const pixelHeight = Math.max(1, Math.round(height * density))
      if (output.width !== pixelWidth || output.height !== pixelHeight) {
        output.width = pixelWidth
        output.height = pixelHeight
      }
      const args = {
        display: geometry.display, windowBounds: geometry.windowBounds,
        frame: { width: frame.displayWidth, height: frame.displayHeight },
      }
      const region = getOpticalCrop({ ...args, crop: cropRect, output: { width: pixelWidth, height: pixelHeight } })
      context.fillStyle = '#211b38'
      context.fillRect(0, 0, pixelWidth, pixelHeight)
      if (!region) return
      const { source, dest } = region
      context.drawImage(frame, source.x, source.y, source.width, source.height, dest.x, dest.y, dest.width, dest.height)

      // Read only fifteen pixels four times per second; frames never enter
      // React state or make a full-screen CPU readback.
      if (meterContext && performance.now() >= nextMeter) {
        nextMeter = performance.now() + 250
        const sample = getOpticalCrop({ ...args, crop: surfaceRect, output: { width: 5, height: 3 } })
        if (!sample) return
        meterContext.fillStyle = '#211b38'
        meterContext.fillRect(0, 0, 5, 3)
        meterContext.filter = `saturate(${settings.saturation}%)`
        const { source: s, dest: d } = sample
        meterContext.drawImage(frame, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height)
        const pixels = meterContext.getImageData(0, 0, 5, 3).data
        let luminance = 0
        for (let i = 0; i < pixels.length; i += 4) luminance += .2126 * linear(pixels[i]) + .7152 * linear(pixels[i + 1]) + .0722 * linear(pixels[i + 2])
        const next = chooseGlassInk(luminance / 15, settings.tintOpacity, settings.overLight, previousLight)
        if (next !== previousLight) { previousLight = next; setLightInk(next) }
      }
    }
    const render = () => {
      animation = 0
      const geometry = geometryNow.current || latestGeometry
      if (latestFrame && geometry && geometry.display.id === latestGeometry?.display.id) draw(latestFrame, geometry)
      if (performance.now() < until) animation = requestAnimationFrame(render)
    }
    const queue = () => { if (!animation) animation = requestAnimationFrame(render) }
    const schedule = () => { until = performance.now() + 450; queue() }
    requestDraw.current = schedule
    const unsubscribe = optics.source.subscribe((frame, geometry) => {
      // Desktop capture may pause on a static desktop. Retain one GPU frame so
      // elastic motion, window movement and scrolling can still re-sample it.
      latestFrame?.close()
      latestFrame = frame.clone()
      latestGeometry = geometry
      queue()
    })
    const surface = container.current?.querySelector<HTMLElement>('.liquid-surface')
    const mutations = new MutationObserver(schedule)
    if (surface) mutations.observe(surface, { attributes: true, attributeFilter: ['style'] })
    const resize = new ResizeObserver(schedule)
    resize.observe(warp)
    if (scrollport) resize.observe(scrollport)
    const visibility = () => { if (!document.hidden) schedule() }
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('resize', schedule)
    return () => {
      unsubscribe()
      cancelAnimationFrame(animation)
      latestFrame?.close()
      requestDraw.current = () => {}
      mutations.disconnect()
      resize.disconnect()
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('resize', schedule)
    }
  }, [optics.source, warp, hasSource, settings.tintOpacity, settings.overLight, settings.saturation])

  useLayoutEffect(() => { requestDraw.current() }, [optics.geometry, overscan])

  useLayoutEffect(() => {
    if (!isBrowserPreview || !warp || !hasSource) return
    const surface = container.current?.querySelector<HTMLElement>('.liquid-surface')
    if (!surface) return
    let animation = 0
    let until = 0
    const measure = () => {
      const local = crop.current
      const source = preview.current
      if (local && source) {
        const rect = local.getBoundingClientRect()
        const css = getComputedStyle(local)
        const scaleX = rect.width / parseFloat(css.width) || 1
        const scaleY = rect.height / parseFloat(css.height) || 1
        Object.assign(source.style, { left: `${-rect.x / scaleX}px`, top: `${-rect.y / scaleY}px`, width: `${innerWidth / scaleX}px`, height: `${innerHeight / scaleY}px` })
      }
      animation = performance.now() < until ? requestAnimationFrame(measure) : 0
    }
    const schedule = () => { until = performance.now() + 450; if (!animation) animation = requestAnimationFrame(measure) }
    const observer = new MutationObserver(schedule)
    observer.observe(surface, { attributes: true, attributeFilter: ['style'] })
    const resize = new ResizeObserver(schedule)
    resize.observe(warp)
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    schedule()
    return () => { cancelAnimationFrame(animation); observer.disconnect(); resize.disconnect(); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
  }, [warp, hasSource, overscan])

  return <div ref={container} className={`glass-frame ${hasSource ? 'has-optical-source' : ''} ${hasSource && !lightInk ? 'is-light-background' : ''} ${className}`} data-interactive style={{ borderRadius: radius, '--glass-tint': settings.tintOpacity, '--glass-shade': hasSource ? (settings.overLight ? .38 : 0) : .52 } as React.CSSProperties}>
    <LiquidGlass className="liquid-surface" cornerRadius={radius} displacementScale={settings.displacementScale} blurAmount={settings.blurAmount} saturation={settings.saturation} aberrationIntensity={settings.aberrationIntensity} elasticity={settings.elasticity} overLight={settings.overLight} padding="0" mode={settings.mode} style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' }}>
      {children}
    </LiquidGlass>
    {warp && hasSource && createPortal(<div ref={crop} className="optical-crop" aria-hidden="true" style={{ inset: -overscan, filter: `blur(${blur}px) saturate(${settings.saturation}%)` }}>
      {isBrowserPreview ? <div ref={preview} className="optical-preview"><PreviewScene style={{ position: 'absolute' }}/></div> : <canvas ref={canvas} className="optical-source"/>}
    </div>, warp)}
  </div>
}

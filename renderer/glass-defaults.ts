import type { GlassSettings } from './types'

export const defaultGlass: GlassSettings = {
  mode: 'standard', displacementScale: 100, blurAmount: 0.0625,
  saturation: 140, aberrationIntensity: 2, elasticity: 0.15,
  cornerRadius: 36, tintOpacity: 0.12, overLight: false, desktopRefraction: true,
}

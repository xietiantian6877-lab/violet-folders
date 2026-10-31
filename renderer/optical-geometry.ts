export interface OpticalSize { width: number; height: number }
export interface OpticalRect extends OpticalSize { x: number; y: number }

export interface OpticalCropInput {
  /** Screen and window bounds use Electron's screen DIP coordinates. */
  display: OpticalRect
  windowBounds: OpticalRect
  /** The transformed surface bounds in window/client DIP coordinates. */
  crop: OpticalRect
  /** Actual decoded video dimensions, independent of devicePixelRatio. */
  frame: OpticalSize
  /** Destination canvas backing dimensions, in pixels. */
  output: OpticalSize
}

export interface OpticalCrop { source: OpticalRect; dest: OpticalRect }

const finiteOrigin = (rect: OpticalRect) => Number.isFinite(rect.x) && Number.isFinite(rect.y)
const positiveSize = (size: OpticalSize) => Number.isFinite(size.width) && size.width > 0
  && Number.isFinite(size.height) && size.height > 0

/**
 * Maps one transformed glass surface into its selected display's video frame.
 * Cropping in screen DIPs before converting to pixels handles mixed display DPI
 * and negative monitor origins without applying devicePixelRatio a second time.
 * Uncovered parts of the output are intentionally left for the caller to clear.
 */
export function getOpticalCrop({ display, windowBounds, crop, frame, output }: OpticalCropInput): OpticalCrop | null {
  if (!finiteOrigin(display) || !positiveSize(display) || !finiteOrigin(windowBounds) || !positiveSize(windowBounds)
    || !finiteOrigin(crop) || !positiveSize(crop) || !positiveSize(frame) || !positiveSize(output)) return null

  const cropLeft = windowBounds.x + crop.x - display.x
  const cropTop = windowBounds.y + crop.y - display.y
  const left = Math.max(0, cropLeft)
  const top = Math.max(0, cropTop)
  const right = Math.min(display.width, cropLeft + crop.width)
  const bottom = Math.min(display.height, cropTop + crop.height)
  if (right <= left || bottom <= top) return null

  const result = {
    source: {
      x: left / display.width * frame.width,
      y: top / display.height * frame.height,
      width: (right - left) / display.width * frame.width,
      height: (bottom - top) / display.height * frame.height,
    },
    dest: {
      x: (left - cropLeft) / crop.width * output.width,
      y: (top - cropTop) / crop.height * output.height,
      width: (right - left) / crop.width * output.width,
      height: (bottom - top) / crop.height * output.height,
    },
  }
  return finiteOrigin(result.source) && positiveSize(result.source)
    && finiteOrigin(result.dest) && positiveSize(result.dest) ? result : null
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, value))
const toLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
const toSrgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055

/**
 * Returns true for light ink. Input luminance is linear relative luminance.
 * With no RGB sample available, an equal-luminance gray estimates CSS sRGB
 * compositing against the rgb(77 37 111) tint and the 38% overLight black veil.
 * The 0.17–0.25 hysteresis band prevents tiny sample changes toggling the ink.
 */
export function chooseGlassInk(luminance: number, tintOpacity: number, overLight: boolean, previousLight?: boolean): boolean {
  if (!Number.isFinite(luminance)) return previousLight ?? true
  const gray = toSrgb(clampUnit(luminance))
  const tint = Number.isFinite(tintOpacity) ? clampUnit(tintOpacity) : 0
  const veil = overLight ? 0.62 : 1
  const channels = [77, 37, 111].map(channel => toLinear((gray * (1 - tint) + channel / 255 * tint) * veil))
  const effectiveLuminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  if (previousLight === true) return effectiveLuminance <= 0.25
  if (previousLight === false) return effectiveLuminance < 0.17
  return effectiveLuminance <= 0.21
}

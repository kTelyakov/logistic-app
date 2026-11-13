import type { Point } from '@dispatch/contract'
import { worldToScreen, type Bounds, type Viewport } from './viewport'

export interface PointMarker {
  id: string
  name: string
  x: number
  y: number
  mode: Point['mode']
}

const NICE_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2000]

/** Шаг сетки в метрах: самый мелкий «круглый», при котором линии не ближе `minPx` друг к другу. */
export function niceGridStep(scale: number, minPx = 64): number {
  for (const step of NICE_STEPS) if (step * scale >= minPx) return step
  return NICE_STEPS[NICE_STEPS.length - 1] as number
}

const COLORS = {
  bg: '#10161d',
  site: '#17202a',
  grid: 'rgba(138, 156, 178, 0.10)',
  gridStrong: 'rgba(138, 156, 178, 0.20)',
  boundary: 'rgba(138, 156, 178, 0.45)',
  text: '#c9d3df',
  muted: '#8493a4',
  point: '#5aa9ff',
  manual: '#f0b429',
  selected: '#ffffff',
}

function setup(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, vp.width, vp.height)
}

/** Подложка: участок и сетка. Строится кодом, внешних ресурсов нет. */
export function drawBackground(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, bounds: Bounds): void {
  setup(ctx, vp, dpr)
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, vp.width, vp.height)

  const [x0, y1] = worldToScreen(vp, bounds.minX, bounds.minY)
  const [x1, y0] = worldToScreen(vp, bounds.maxX, bounds.maxY)
  ctx.fillStyle = COLORS.site
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)

  const step = niceGridStep(vp.scale)
  ctx.lineWidth = 1
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'top'
  for (let gx = Math.ceil(bounds.minX / step) * step; gx <= bounds.maxX; gx += step) {
    const [sx] = worldToScreen(vp, gx, 0)
    if (sx < -1 || sx > vp.width + 1) continue
    ctx.strokeStyle = gx % (step * 5) === 0 ? COLORS.gridStrong : COLORS.grid
    ctx.beginPath()
    ctx.moveTo(Math.round(sx) + 0.5, Math.max(0, y0))
    ctx.lineTo(Math.round(sx) + 0.5, Math.min(vp.height, y1))
    ctx.stroke()
  }
  for (let gy = Math.ceil(bounds.minY / step) * step; gy <= bounds.maxY; gy += step) {
    const [, sy] = worldToScreen(vp, 0, gy)
    if (sy < -1 || sy > vp.height + 1) continue
    ctx.strokeStyle = gy % (step * 5) === 0 ? COLORS.gridStrong : COLORS.grid
    ctx.beginPath()
    ctx.moveTo(Math.max(0, x0), Math.round(sy) + 0.5)
    ctx.lineTo(Math.min(vp.width, x1), Math.round(sy) + 0.5)
    ctx.stroke()
  }

  // подписи шкалы по верхнему краю: километры или метры
  ctx.fillStyle = COLORS.muted
  const label = (value: number) => (value >= 1000 ? `${value / 1000} км` : `${value} м`)
  for (let gx = Math.ceil(bounds.minX / step) * step; gx <= bounds.maxX; gx += step * 2) {
    const [sx] = worldToScreen(vp, gx, 0)
    if (sx > 2 && sx < vp.width - 30) ctx.fillText(label(gx), sx + 3, 4)
  }

  ctx.strokeStyle = COLORS.boundary
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0)
}

export interface OverlayLabel {
  text: string
  x: number
  y: number
}

/** Верхний слой: пункты (поверх машин, чтобы подписи читались), подписи видимых машин и рамка выбранной. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  dpr: number,
  points: readonly PointMarker[],
  labels: readonly OverlayLabel[],
  selected: { x: number; y: number } | undefined,
): void {
  setup(ctx, vp, dpr)

  ctx.textBaseline = 'middle'
  ctx.font = '10.5px system-ui, sans-serif'
  ctx.fillStyle = COLORS.text
  for (const l of labels) {
    const [sx, sy] = worldToScreen(vp, l.x, l.y)
    ctx.fillText(l.text, sx + 9, sy)
  }

  ctx.font = '600 12px system-ui, sans-serif'
  for (const p of points) {
    const [sx, sy] = worldToScreen(vp, p.x, p.y)
    if (sx < -40 || sx > vp.width + 40 || sy < -40 || sy > vp.height + 40) continue
    const color = p.mode === 'manual' ? COLORS.manual : COLORS.point
    ctx.beginPath()
    ctx.arc(sx, sy, 9, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(16, 22, 29, 0.92)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.fillStyle = color
    ctx.fillRect(sx - 3, sy - 3, 6, 6)
    // подпись на тёмной подложке: читается поверх машин
    const text = p.mode === 'manual' ? `${p.name} · ручной` : p.name
    const width = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(16, 22, 29, 0.82)'
    ctx.fillRect(sx + 12, sy - 9, width + 8, 18)
    ctx.fillStyle = COLORS.text
    ctx.fillText(text, sx + 16, sy)
  }

  if (selected) {
    const [sx, sy] = worldToScreen(vp, selected.x, selected.y)
    ctx.lineWidth = 2
    ctx.strokeStyle = COLORS.selected
    ctx.beginPath()
    ctx.arc(sx, sy, 12, 0, Math.PI * 2)
    ctx.stroke()
  }
}

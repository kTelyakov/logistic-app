import { describe, expect, it } from 'vitest'
import { clampViewport, fitViewport, MAX_SCALE, minScale, panBy, resizeViewport, screenToWorld, SITE_BOUNDS, visibleRect, worldToScreen, zoomAt, type Viewport } from './viewport'

const fit = (): Viewport => fitViewport(1200, 800)

describe('viewport', () => {
  it('мир и экран переводятся туда и обратно', () => {
    const vp: Viewport = { scale: 0.17, centerX: 3000, centerY: 2000, width: 1200, height: 800 }
    for (const [x, y] of [[0, 0], [6000, 4000], [2410.5, 1180], [3000, 2000]] as const) {
      const [sx, sy] = worldToScreen(vp, x, y)
      const [rx, ry] = screenToWorld(vp, sx, sy)
      expect(rx).toBeCloseTo(x, 6)
      expect(ry).toBeCloseTo(y, 6)
    }
  })

  it('центр вида лежит в центре области, север сверху', () => {
    const vp = fit()
    expect(worldToScreen(vp, 3000, 2000)).toEqual([600, 400])
    const north = worldToScreen(vp, 3000, 3000)[1]
    const south = worldToScreen(vp, 3000, 1000)[1]
    expect(north).toBeLessThan(south)
  })

  it('fit: участок целиком помещается с отступом, ограничивает меньшая сторона', () => {
    const vp = fitViewport(1200, 800)
    const [x0, y0] = worldToScreen(vp, 0, 0)
    const [x1, y1] = worldToScreen(vp, 6000, 4000)
    expect(x0).toBeGreaterThanOrEqual(28 - 1e-6)
    expect(x1).toBeLessThanOrEqual(1200 - 28 + 1e-6)
    expect(y1).toBeGreaterThanOrEqual(28 - 1e-6)
    expect(y0).toBeLessThanOrEqual(800 - 28 + 1e-6)
    // для 6:4 и области 1200:800 по ширине (1144/6000) тесней, чем по высоте (744/4000)
    expect(vp.scale).toBeCloseTo(Math.min(1144 / 6000, 744 / 4000), 9)
  })

  it('fit на очень маленькой области не ломается', () => {
    const vp = fitViewport(10, 10)
    expect(vp.scale).toBeGreaterThan(0)
    expect(Number.isFinite(vp.scale)).toBe(true)
  })

  it('zoom вокруг курсора: мировая точка под курсором остаётся на месте', () => {
    const vp = fit()
    for (const [sx, sy] of [[100, 100], [600, 400], [1100, 700]] as const) {
      const before = screenToWorld(vp, sx, sy)
      const zoomed = zoomAt(vp, sx, sy, 2)
      expect(zoomed.scale).toBeGreaterThan(vp.scale)
      const after = screenToWorld(zoomed, sx, sy)
      // точка внутри участка, поэтому ограничение центра не вмешивается
      expect(after[0]).toBeCloseTo(before[0], 3)
      expect(after[1]).toBeCloseTo(before[1], 3)
    }
  })

  it('масштаб ограничен сверху и снизу', () => {
    let vp = fit()
    for (let i = 0; i < 50; i++) vp = zoomAt(vp, 600, 400, 2)
    expect(vp.scale).toBe(MAX_SCALE)
    for (let i = 0; i < 80; i++) vp = zoomAt(vp, 600, 400, 0.5)
    expect(vp.scale).toBeCloseTo(minScale(vp), 9)
    expect(vp.scale).toBeLessThan(fit().scale)
  })

  it('pan сдвигает содержимое вместе с курсором', () => {
    const vp = { ...fit(), scale: 0.5, centerX: 3000, centerY: 2000 }
    const before = worldToScreen(vp, 3000, 2000)
    const panned = panBy(vp, 100, 50)
    const after = worldToScreen(panned, 3000, 2000)
    expect(after[0] - before[0]).toBeCloseTo(100, 6)
    expect(after[1] - before[1]).toBeCloseTo(50, 6)
  })

  it('центр не уходит за пределы участка', () => {
    // содержимое тянем влево и вниз: центр в мире уходит вправо и вниз; ось Y смотрит на север
    const vp = panBy({ ...fit(), scale: 1, centerX: 5900, centerY: 3900 }, -100_000, -100_000)
    expect(vp.centerX).toBe(SITE_BOUNDS.maxX)
    expect(vp.centerY).toBe(SITE_BOUNDS.minY)
    expect(clampViewport({ ...fit(), centerX: -5, centerY: 9999 })).toMatchObject({ centerX: 0, centerY: 4000 })
  })

  it('видимый прямоугольник согласован с областью', () => {
    const vp = fit()
    const rect = visibleRect(vp)
    expect(rect.maxX - rect.minX).toBeCloseTo(1200 / vp.scale, 6)
    expect(rect.maxY - rect.minY).toBeCloseTo(800 / vp.scale, 6)
    const zoomed = zoomAt(vp, 600, 400, 4)
    expect(visibleRect(zoomed).maxX - visibleRect(zoomed).minX).toBeLessThan(rect.maxX - rect.minX)
  })

  it('изменение размера сохраняет центр и масштаб', () => {
    const vp = { ...fit(), scale: 0.4, centerX: 1234, centerY: 567 }
    expect(resizeViewport(vp, 640, 480)).toEqual({ ...vp, width: 640, height: 480 })
  })
})

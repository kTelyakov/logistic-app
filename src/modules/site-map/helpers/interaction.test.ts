import type { Vehicle } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { VehicleArena, type VehicleView } from '@/modules/vehicles'
import { hitTestVehicle, LABEL_MIN_SCALE, MAX_LABELS, pickLabelSlots } from './interaction'
import { fitViewport, worldToScreen, type Viewport } from './viewport'

const vehicle = (n: number, x: number, y: number): Vehicle => ({
  vehicle_id: `v-${n}`, name: `Т-${n}`, x_m: x, y_m: y, heading_deg: 0, speed_kmh: 0, state: 'idle', point_id: 'p-1', last_seen: '2026-10-01T04:00:00Z',
})

function viewOf(vehicles: Vehicle[]): VehicleView {
  const arena = new VehicleArena()
  arena.upsertMany(vehicles)
  const frame = arena.createFrame()
  return { count: frame.count, columns: frame.columns, tables: { ids: arena.ids, names: arena.names, points: arena.points } }
}

const zoomed = (scale: number, cx = 3000, cy = 2000): Viewport => ({ scale, centerX: cx, centerY: cy, width: 1000, height: 700 })

describe('hitTestVehicle', () => {
  const view = viewOf([vehicle(1, 3000, 2000), vehicle(2, 3010, 2000), vehicle(3, 5000, 3000)])

  it('щелчок рядом с машиной выбирает её', () => {
    const vp = fitViewport(1000, 700)
    const [sx, sy] = worldToScreen(vp, 5000, 3000)
    expect(hitTestVehicle(view, vp, sx + 4, sy - 3)).toBe(2)
  })

  it('щелчок далеко от всех машин ничего не выбирает', () => {
    const vp = fitViewport(1000, 700)
    const [sx, sy] = worldToScreen(vp, 500, 500)
    expect(hitTestVehicle(view, vp, sx, sy)).toBe(-1)
  })

  it('из двух близких выбирается ближайшая', () => {
    const vp = zoomed(2)
    const [sx, sy] = worldToScreen(vp, 3009, 2000)
    expect(hitTestVehicle(view, vp, sx, sy)).toBe(1)
  })

  it('радиус задан в пикселях: при приближении он покрывает меньше метров', () => {
    const near = zoomed(3)
    const far = zoomed(0.1)
    const [nx, ny] = worldToScreen(near, 3010, 2000)
    // 10 м при масштабе 3 это 30 пикселей: дальше радиуса 12
    expect(hitTestVehicle(view, near, nx + 30, ny)).toBe(-1)
    const [fx, fy] = worldToScreen(far, 3000, 2000)
    // 10 м при масштабе 0.1 это 1 пиксель: попадаем
    expect(hitTestVehicle(view, far, fx + 9, fy)).not.toBe(-1)
  })
})

describe('pickLabelSlots', () => {
  const grid = Array.from({ length: 400 }, (_, i) => vehicle(i, 3000 + (i % 20) * 10, 2000 + Math.floor(i / 20) * 10))
  const view = viewOf(grid)

  it('при малом масштабе подписей нет', () => {
    expect(pickLabelSlots(view, zoomed(LABEL_MIN_SCALE - 0.01))).toEqual([])
  })

  it('при приближении подписываются видимые машины', () => {
    const vp = zoomed(3, 3000, 2000) // видно примерно 333 × 233 м: часть сетки
    const slots = pickLabelSlots(view, vp)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.length).toBeLessThanOrEqual(MAX_LABELS)
  })

  it('слишком много видимых машин: подписей нет вовсе, а не часть случайных', () => {
    expect(pickLabelSlots(view, zoomed(1), MAX_LABELS)).toHaveLength(0)
  })

  it('машины вне видимой области не подписываются', () => {
    const far = viewOf([vehicle(1, 100, 100), vehicle(2, 3000, 2000)])
    expect(pickLabelSlots(far, zoomed(1))).toEqual([1])
  })
})

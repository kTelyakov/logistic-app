import { findInRect, findNearest, type VehicleView } from '@/modules/vehicles'
import { screenToWorld, visibleRect, type Viewport } from './viewport'

/** Подписи машин: при достаточном приближении и не более стольких, иначе схема превращается в кашу. */
export const MAX_LABELS = 250
export const LABEL_MIN_SCALE = 0.45

/** Слоты машин, которым нужна подпись: видимые, ограниченное число, только при приближении. */
export function pickLabelSlots(view: VehicleView, vp: Viewport, maxLabels = MAX_LABELS, minScale = LABEL_MIN_SCALE): number[] {
  if (vp.scale < minScale) return []
  const rect = visibleRect(vp)
  const slots = findInRect(view, rect.minX, rect.minY, rect.maxX, rect.maxY)
  return slots.length <= maxLabels ? slots : []
}

/** Радиус щелчка в пикселях: достаточно, чтобы попасть в маркер размером около 12 пикселей. */
export const HIT_RADIUS_PX = 12

/** Ближайшая к точке экрана машина в радиусе щелчка или -1. */
export function hitTestVehicle(view: VehicleView, vp: Viewport, sx: number, sy: number, radiusPx = HIT_RADIUS_PX): number {
  const [wx, wy] = screenToWorld(vp, sx, sy)
  return findNearest(view, wx, wy, radiusPx / vp.scale)
}

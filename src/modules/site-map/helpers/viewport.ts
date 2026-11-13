/**
 * Вид схемы: сколько пикселей в метре и какая мировая точка в центре.
 * Мировые координаты: метры, ось Y направлена вверх (на север); экранные: пиксели, ось Y вниз.
 */
export interface Viewport {
  /** Пикселей CSS в метре. */
  scale: number
  centerX: number
  centerY: number
  /** Размер области схемы в пикселях CSS. */
  width: number
  height: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Площадка примерно 6 × 4 км (часть 1 задания). */
export const SITE_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 6000, maxY: 4000 }

/** Максимальное приближение: пикселей в метре. */
export const MAX_SCALE = 3

export function worldToScreen(vp: Viewport, x: number, y: number): [number, number] {
  return [vp.width / 2 + (x - vp.centerX) * vp.scale, vp.height / 2 - (y - vp.centerY) * vp.scale]
}

export function screenToWorld(vp: Viewport, sx: number, sy: number): [number, number] {
  return [vp.centerX + (sx - vp.width / 2) / vp.scale, vp.centerY - (sy - vp.height / 2) / vp.scale]
}

/** Весь участок в области с отступом. */
export function fitViewport(width: number, height: number, bounds: Bounds = SITE_BOUNDS, paddingPx = 28): Viewport {
  const w = Math.max(1, width - 2 * paddingPx)
  const h = Math.max(1, height - 2 * paddingPx)
  const scale = Math.min(w / (bounds.maxX - bounds.minX), h / (bounds.maxY - bounds.minY))
  return { scale, centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2, width, height }
}

export function minScale(vp: Viewport, bounds: Bounds = SITE_BOUNDS): number {
  return fitViewport(vp.width, vp.height, bounds).scale * 0.6
}

/** Приближение вокруг точки под курсором: она остаётся на месте. */
export function zoomAt(vp: Viewport, sx: number, sy: number, factor: number, bounds: Bounds = SITE_BOUNDS): Viewport {
  const next = Math.min(MAX_SCALE, Math.max(minScale(vp, bounds), vp.scale * factor))
  const [wx, wy] = screenToWorld(vp, sx, sy)
  const moved: Viewport = { ...vp, scale: next }
  // сдвигаем центр так, чтобы (wx, wy) осталась под курсором
  moved.centerX = wx - (sx - vp.width / 2) / next
  moved.centerY = wy + (sy - vp.height / 2) / next
  return clampViewport(moved, bounds)
}

export function panBy(vp: Viewport, dxPx: number, dyPx: number, bounds: Bounds = SITE_BOUNDS): Viewport {
  return clampViewport({ ...vp, centerX: vp.centerX - dxPx / vp.scale, centerY: vp.centerY + dyPx / vp.scale }, bounds)
}

/** Центр не уходит за пределы участка: схему нельзя «потерять». */
export function clampViewport(vp: Viewport, bounds: Bounds = SITE_BOUNDS): Viewport {
  return {
    ...vp,
    centerX: Math.min(bounds.maxX, Math.max(bounds.minX, vp.centerX)),
    centerY: Math.min(bounds.maxY, Math.max(bounds.minY, vp.centerY)),
  }
}

/** Видимый прямоугольник в мировых координатах. */
export function visibleRect(vp: Viewport): Bounds {
  const [minX, maxY] = screenToWorld(vp, 0, 0)
  const [maxX, minY] = screenToWorld(vp, vp.width, vp.height)
  return { minX, minY, maxX, maxY }
}

/** Новый размер области: центр и масштаб сохраняются. */
export function resizeViewport(vp: Viewport, width: number, height: number): Viewport {
  return { ...vp, width, height }
}

import type { RendererDiagnostics } from './renderer/SiteRenderer'

/** Диагностика схемы для e2e и perf: только чтение (плюс имитация потери контекста для проверки восстановления). */
export interface MapDiagnostics {
  /** Схема работает на WebGL2 или он недоступен. */
  backend: 'webgl2' | 'unavailable'
  renderer: RendererDiagnostics | undefined
  viewport: { scale: number; centerX: number; centerY: number; width: number; height: number }
  /** Цвет пикселя схемы в центре маркера машины (RGBA, предумноженная альфа) или null, если машины нет на экране. */
  pixelAtVehicle(id: string): [number, number, number, number] | null
  /** Положение машины на экране (пиксели CSS) или null. */
  vehicleScreenPosition(id: string): [number, number] | null
  loseContext(): boolean
  restoreContext(): boolean
}

let provider: (() => MapDiagnostics) | undefined

export function setMapDiagnostics(next: (() => MapDiagnostics) | undefined): void {
  provider = next
}

export function readMapDiagnostics(): MapDiagnostics | undefined {
  return provider?.()
}

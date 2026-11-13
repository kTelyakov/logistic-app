import type { VehicleView } from '@/modules/vehicles'
import type { Viewport } from '../helpers/viewport'

export interface RendererDiagnostics {
  backend: 'webgl2'
  contextLost: boolean
  /** Сколько машин нарисовано последним вызовом отрисовки. */
  instances: number
  /** Сколько раз рисовали. */
  frames: number
  /** Сколько раз заливали данные в GPU. */
  uploads: number
  /** Сколько раз контекст восстанавливали после потери. */
  restores: number
  /** Длительность последней подготовки кадра на CPU (загрузка и вызов отрисовки), мс. */
  lastCpuMs: number
}

/**
 * Рисует машины. Интерфейс не знает о WebGL: рендерер можно заменить (например, на OffscreenCanvas в воркере),
 * не трогая компоненты.
 */
export interface SiteRenderer {
  readonly canvas: HTMLCanvasElement
  /** Новый кадр машин; данные заливаются в GPU при следующей отрисовке. */
  setVehicles(view: VehicleView): void
  /** Время сервера (мс): по нему шейдер решает, какие машины устарели. */
  setServerNow(ms: number): void
  setViewport(viewport: Viewport, devicePixelRatio: number): void
  /** Нужно ли рисовать: изменились данные, вид или время. */
  needsRender(): boolean
  render(): void
  /** Цвет пикселя схемы в экранной точке (для тестов): RGBA, цвета с предумноженной альфой. */
  readPixel(screenX: number, screenY: number): [number, number, number, number]
  diagnostics(): RendererDiagnostics
  /** Имитация потери и восстановления контекста (расширение WEBGL_lose_context). Только для тестов. */
  loseContext(): boolean
  restoreContext(): boolean
  dispose(): void
}

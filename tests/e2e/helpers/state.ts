import type { Page } from '@playwright/test'

/** Состояние, которое видит диспетчер: именно оно сверяется с /debug/state. */
export interface ScreenVehicle {
  vehicle_id: string
  state: string
  x_m: number
  y_m: number
  last_seen: string
}

export interface ScreenQueueItem {
  vehicle_id: string
  eta: string
  service_start: string
  wait_s: number
}

export interface ScreenPoint {
  point_id: string
  mode: string
  queue: ScreenQueueItem[]
}

export interface ScreenDecision {
  decision_id: string
  status: string
  version: number
}

export interface ScreenState {
  /** Последний применённый seq. */
  seq: number
  vehicles: ScreenVehicle[]
  points: ScreenPoint[]
  decisions: ScreenDecision[]
}

/** То, что отдаёт /debug/state (подмножество, нужное для сверки). */
export interface ServerState {
  seq: number
  vehicles: ScreenVehicle[]
  points: Array<{ point_id: string; mode: string; version?: number; queue: ScreenQueueItem[] }>
  decisions: ScreenDecision[]
}

/**
 * Читает состояние экрана по DOM-контракту (см. tests/e2e/README.md).
 * Машины и seq берутся из window.__dispatch: схема рисуется на canvas, машин в DOM нет.
 */
export async function readScreen(page: Page): Promise<ScreenState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __dispatch?: { seq(): number; vehicles(): ScreenVehicle[] } }).__dispatch
    if (!hook) throw new Error('На странице нет window.__dispatch: экран не соблюдает контракт для тестов')
    const attr = (el: Element, name: string) => el.getAttribute(name) ?? ''
    return {
      seq: hook.seq(),
      vehicles: hook.vehicles(),
      points: [...document.querySelectorAll('[data-testid="point"]')].map((p) => ({
        point_id: attr(p, 'data-point-id'),
        mode: attr(p, 'data-mode'),
        queue: [...p.querySelectorAll('[data-testid="queue-item"]')].map((q) => ({
          vehicle_id: attr(q, 'data-vehicle-id'),
          eta: attr(q, 'data-eta'),
          service_start: attr(q, 'data-service-start'),
          wait_s: Number(attr(q, 'data-wait-s')),
        })),
      })),
      decisions: [...document.querySelectorAll('[data-testid="decision"]')].map((d) => ({
        decision_id: attr(d, 'data-decision-id'),
        status: attr(d, 'data-status'),
        version: Number(attr(d, 'data-version')),
      })),
    }
  })
}

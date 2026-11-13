import type { ScreenState, ServerState } from './state'

export interface Diff {
  /** Где расхождение, например `decision d-3381 status` или `point p-2 queue[3]`. */
  where: string
  screen: unknown
  server: unknown
}

const ms = (iso: string) => Date.parse(iso)

/**
 * Сравнивает состояние экрана с серверным на одном seq. Пустой список: совпадают.
 * Время сравнивается как момент, а не как строка: формат отображения не важен.
 */
export function diffStates(screen: ScreenState, server: ServerState): Diff[] {
  const diffs: Diff[] = []
  const push = (where: string, s: unknown, v: unknown) => diffs.push({ where, screen: s, server: v })

  if (screen.seq !== server.seq) push('seq', screen.seq, server.seq)

  // машины
  const screenVehicles = new Map(screen.vehicles.map((v) => [v.vehicle_id, v]))
  const serverVehicles = new Map(server.vehicles.map((v) => [v.vehicle_id, v]))
  if (screenVehicles.size !== screen.vehicles.length) push('vehicles duplicates', screen.vehicles.length, screenVehicles.size)
  for (const [id, expected] of serverVehicles) {
    const actual = screenVehicles.get(id)
    if (!actual) {
      push(`vehicle ${id}`, undefined, 'есть на сервере')
      continue
    }
    if (actual.state !== expected.state) push(`vehicle ${id} state`, actual.state, expected.state)
    if (actual.x_m !== expected.x_m) push(`vehicle ${id} x_m`, actual.x_m, expected.x_m)
    if (actual.y_m !== expected.y_m) push(`vehicle ${id} y_m`, actual.y_m, expected.y_m)
    if (ms(actual.last_seen) !== ms(expected.last_seen)) push(`vehicle ${id} last_seen`, actual.last_seen, expected.last_seen)
  }
  for (const id of screenVehicles.keys()) {
    if (!serverVehicles.has(id)) push(`vehicle ${id}`, 'есть на экране', undefined)
  }

  // пункты и очереди
  const screenPoints = new Map(screen.points.map((p) => [p.point_id, p]))
  const serverPoints = new Map(server.points.map((p) => [p.point_id, p]))
  for (const [id, expected] of serverPoints) {
    const actual = screenPoints.get(id)
    if (!actual) {
      push(`point ${id}`, undefined, 'есть на сервере')
      continue
    }
    if (actual.mode !== expected.mode) push(`point ${id} mode`, actual.mode, expected.mode)
    if (actual.queue.length !== expected.queue.length) {
      push(`point ${id} queue length`, actual.queue.length, expected.queue.length)
    }
    const common = Math.min(actual.queue.length, expected.queue.length)
    for (let i = 0; i < common; i++) {
      const a = actual.queue[i]
      const e = expected.queue[i]
      if (!a || !e) continue
      const where = `point ${id} queue[${i}]`
      if (a.vehicle_id !== e.vehicle_id) push(`${where} vehicle_id`, a.vehicle_id, e.vehicle_id)
      if (ms(a.eta) !== ms(e.eta)) push(`${where} eta`, a.eta, e.eta)
      if (ms(a.service_start) !== ms(e.service_start)) push(`${where} service_start`, a.service_start, e.service_start)
      if (a.wait_s !== e.wait_s) push(`${where} wait_s`, a.wait_s, e.wait_s)
    }
  }
  for (const id of screenPoints.keys()) {
    if (!serverPoints.has(id)) push(`point ${id}`, 'есть на экране', undefined)
  }

  // решения
  const screenDecisions = new Map(screen.decisions.map((d) => [d.decision_id, d]))
  const serverDecisions = new Map(server.decisions.map((d) => [d.decision_id, d]))
  if (screenDecisions.size !== screen.decisions.length) {
    push('decisions duplicates', screen.decisions.length, screenDecisions.size)
  }
  for (const [id, expected] of serverDecisions) {
    const actual = screenDecisions.get(id)
    if (!actual) {
      push(`decision ${id}`, undefined, 'есть на сервере')
      continue
    }
    if (actual.status !== expected.status) push(`decision ${id} status`, actual.status, expected.status)
    if (actual.version !== expected.version) push(`decision ${id} version`, actual.version, expected.version)
  }
  for (const id of screenDecisions.keys()) {
    if (!serverDecisions.has(id)) push(`decision ${id}`, 'есть на экране', undefined)
  }

  return diffs
}

export function formatDiffs(diffs: Diff[], limit = 12): string {
  const lines = diffs.slice(0, limit).map((d) => `  ${d.where}: экран=${JSON.stringify(d.screen)} сервер=${JSON.stringify(d.server)}`)
  if (diffs.length > limit) lines.push(`  … и ещё ${diffs.length - limit}`)
  return `Экран расходится с /debug/state (${diffs.length}):\n${lines.join('\n')}`
}

import { describe, expect, it } from 'vitest'
import { diffStates, formatDiffs } from './diff'
import type { ScreenState, ServerState } from './state'

function server(): ServerState {
  return {
    seq: 100,
    vehicles: [
      { vehicle_id: 'v-01', state: 'service', x_m: 10.5, y_m: 20, last_seen: '2026-10-01T04:00:00.000Z' },
      { vehicle_id: 'v-02', state: 'queued', x_m: 11, y_m: 21, last_seen: '2026-10-01T04:00:01.000Z' },
    ],
    points: [
      {
        point_id: 'p-1',
        mode: 'auto',
        queue: [
          { vehicle_id: 'v-02', eta: '2026-10-01T04:01:00.000Z', service_start: '2026-10-01T04:01:30.000Z', wait_s: 30 },
          { vehicle_id: 'v-03', eta: '2026-10-01T04:02:00.000Z', service_start: '2026-10-01T04:02:00.000Z', wait_s: 0 },
        ],
      },
    ],
    decisions: [{ decision_id: 'd-1', status: 'pending', version: 1 }],
  }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const screenOf = (s: ServerState): ScreenState => clone(s)

describe('diffStates', () => {
  it('одинаковые состояния не дают расхождений', () => {
    expect(diffStates(screenOf(server()), server())).toEqual([])
  })

  it('время сравнивается как момент, а не как строка', () => {
    const screen = screenOf(server())
    screen.vehicles[0]!.last_seen = '2026-10-01T04:00:00Z'
    screen.points[0]!.queue[0]!.eta = '2026-10-01T11:01:00+07:00'
    expect(diffStates(screen, server())).toEqual([])
  })

  const cases: Array<[string, (s: ScreenState) => void, string]> = [
    ['другой seq', (s) => (s.seq = 99), 'seq'],
    ['состояние машины', (s) => (s.vehicles[0]!.state = 'idle'), 'vehicle v-01 state'],
    ['координата x', (s) => (s.vehicles[0]!.x_m = 10.6), 'vehicle v-01 x_m'],
    ['координата y', (s) => (s.vehicles[1]!.y_m = 0), 'vehicle v-02 y_m'],
    ['last_seen машины', (s) => (s.vehicles[0]!.last_seen = '2026-10-01T04:00:05.000Z'), 'vehicle v-01 last_seen'],
    ['пропавшая машина', (s) => s.vehicles.pop(), 'vehicle v-02'],
    ['лишняя машина', (s) => s.vehicles.push({ vehicle_id: 'v-99', state: 'idle', x_m: 0, y_m: 0, last_seen: '2026-10-01T04:00:00Z' }), 'vehicle v-99'],
    ['дубль машины', (s) => s.vehicles.push(structuredClone(s.vehicles[0]!)), 'vehicles duplicates'],
    ['режим пункта', (s) => (s.points[0]!.mode = 'manual'), 'point p-1 mode'],
    ['длина очереди', (s) => s.points[0]!.queue.pop(), 'point p-1 queue length'],
    ['машина в очереди', (s) => (s.points[0]!.queue[0]!.vehicle_id = 'v-77'), 'point p-1 queue[0] vehicle_id'],
    ['eta в очереди', (s) => (s.points[0]!.queue[1]!.eta = '2026-10-01T04:09:00Z'), 'point p-1 queue[1] eta'],
    ['service_start в очереди', (s) => (s.points[0]!.queue[0]!.service_start = '2026-10-01T04:09:00Z'), 'point p-1 queue[0] service_start'],
    ['ожидание в очереди', (s) => (s.points[0]!.queue[0]!.wait_s = 31), 'point p-1 queue[0] wait_s'],
    ['пропавший пункт', (s) => s.points.pop(), 'point p-1'],
    ['статус решения', (s) => (s.decisions[0]!.status = 'executed'), 'decision d-1 status'],
    ['версия решения', (s) => (s.decisions[0]!.version = 2), 'decision d-1 version'],
    ['пропавшее решение', (s) => s.decisions.pop(), 'decision d-1'],
    ['лишнее решение', (s) => s.decisions.push({ decision_id: 'd-9', status: 'pending', version: 1 }), 'decision d-9'],
    ['дубль решения', (s) => s.decisions.push({ ...s.decisions[0]! }), 'decisions duplicates'],
  ]

  for (const [name, mutate, where] of cases) {
    it(`ловит: ${name}`, () => {
      const screen = screenOf(server())
      mutate(screen)
      const diffs = diffStates(screen, server())
      expect(diffs.map((d) => d.where)).toContain(where)
    })
  }

  it('сообщение называет расходящееся поле и значения', () => {
    const screen = screenOf(server())
    screen.decisions[0]!.status = 'executed'
    const text = formatDiffs(diffStates(screen, server()))
    expect(text).toContain('decision d-1 status')
    expect(text).toContain('"executed"')
    expect(text).toContain('"pending"')
  })

  it('длинный список обрезается', () => {
    const screen = screenOf(server())
    for (const v of screen.vehicles) v.state = 'idle'
    screen.points[0]!.mode = 'manual'
    const text = formatDiffs(diffStates(screen, server()), 1)
    expect(text).toContain('и ещё')
  })
})

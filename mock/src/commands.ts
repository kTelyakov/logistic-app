import type {
  CancelDecisionResponse,
  Decision,
  ForbiddenBody,
  Point,
  PointMode,
  Role,
  SetPointModeResponse,
} from '@dispatch/contract'
import type { Simulation } from './sim'
import type { Clock } from './time'
import type { World } from './world'

export interface CommandInput {
  /** Значение заголовка Idempotency-Key. */
  key: string | undefined
  /** Значение заголовка If-Match (версия сущности). */
  ifMatch: string | undefined
}

type Stored = { status: number; body: unknown }

export interface CommandRecord {
  command: 'cancel_decision' | 'set_point_mode'
  target: string
  /** Сколько раз команда реально выполнена на сервере. */
  executions: number
  /** Сколько раз вернули сохранённый ответ на повтор. */
  replays: number
  status: number
}

const FORBIDDEN: ForbiddenBody = { message: 'Недостаточно прав: наблюдатель не может выполнять команды' }

function parseVersion(raw: string): number | undefined {
  const cleaned = raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!/^\d+$/.test(cleaned)) return undefined
  return Number(cleaned)
}

/**
 * Выполнение команд. Один Idempotency-Key выполняется на сервере не более одного раза,
 * повтор возвращает тот же ответ.
 */
export class CommandService {
  private readonly stored = new Map<string, Stored>()
  private readonly records = new Map<string, CommandRecord>()

  constructor(
    private readonly world: World,
    private readonly sim: Simulation,
    private readonly role: Role,
    private readonly clock: Clock,
  ) {}

  /** Выполнения по Idempotency-Key для /debug/state. */
  executionsByKey(): Record<string, CommandRecord> {
    return Object.fromEntries(this.records)
  }

  cancelDecision(id: string, input: CommandInput): Stored {
    return this.run('cancel_decision', id, input, () => {
      this.sim.processDecisions(this.clock())
      const decision = this.world.decisions.get(id)
      if (!decision) return { executed: false, response: { status: 404, body: { message: `Решение ${id} не найдено` } } }
      const version = parseVersion(input.ifMatch ?? '')
      if (decision.status !== 'pending' || version !== decision.version) {
        const response: CancelDecisionResponse = { status: 409, body: decision }
        return { executed: false, response }
      }
      const cancelled: Decision = this.sim.cancelDecision(decision)
      const response: CancelDecisionResponse = { status: 200, body: cancelled }
      return { executed: true, response }
    })
  }

  setPointMode(id: string, mode: PointMode, input: CommandInput): Stored {
    return this.run('set_point_mode', id, input, () => {
      const point = this.world.points.get(id)
      if (!point) return { executed: false, response: { status: 404, body: { message: `Пункт ${id} не найден` } } }
      const version = parseVersion(input.ifMatch ?? '')
      if (version !== point.version) {
        const response: SetPointModeResponse = { status: 409, body: point }
        return { executed: false, response }
      }
      const updated: Point = this.sim.setPointMode(id, mode) ?? point
      const response: SetPointModeResponse = { status: 200, body: updated }
      return { executed: true, response }
    })
  }

  private run(
    command: CommandRecord['command'],
    target: string,
    input: CommandInput,
    execute: () => { executed: boolean; response: Stored },
  ): Stored {
    if (this.role === 'observer') return { status: 403, body: FORBIDDEN }
    if (!input.key) return { status: 400, body: { message: 'Не указан заголовок Idempotency-Key' } }
    if (!input.ifMatch) return { status: 400, body: { message: 'Не указан заголовок If-Match' } }

    const previous = this.stored.get(input.key)
    if (previous) {
      const record = this.records.get(input.key)
      if (record) record.replays += 1
      return previous
    }

    const { executed, response } = execute()
    // Ответы 4xx кроме 409 (нет сущности и т.п.) не сохраняются: повтор может дойти до успеха
    if (response.status === 404) return response
    this.stored.set(input.key, response)
    this.records.set(input.key, {
      command,
      target,
      executions: executed ? 1 : 0,
      replays: 0,
      status: response.status,
    })
    return response
  }
}

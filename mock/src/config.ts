import {
  ENV,
  FAULTS,
  HEARTBEAT_INTERVAL_MS,
  ROLES,
  type Fault,
  type Role,
} from '@dispatch/contract'

export interface MockConfig {
  port: number
  /** Число машин. Каждая обновляется раз в секунду. */
  load: number
  faults: ReadonlySet<Fault>
  role: Role
  /** Seed решений об отказах: одинаковый seed даёт одинаковые отказы для одного и того же seq. */
  seed: number
  /** Доля сообщений, затронутых каждым из drop/dup/reorder. */
  faultRate: number
  tickMs: number
  heartbeatMs: number
  resetIntervalMs: number
  slowDelayMs: number
  decisionMinMs: number
  decisionMaxMs: number
  executeAfterMs: number
  staleSilentMs: number
  staleActiveMs: number
  serviceMinMs: number
  serviceMaxMs: number
  queueRecomputeMs: number
  journalSize: number
  /** Ускорение движения машин (для тестов: состояния меняются за секунды). */
  speedScale: number
  /** Сдвиг часов сервера относительно часов машины, мс (проверка: экран живёт по времени сервера). */
  clockOffsetMs: number
  /** Сколько завершённых решений за последний час создать на старте (состояние середины смены). */
  prefillDecisions: number
}

const DEFAULT_LOAD = 150

function int(env: Record<string, string | undefined>, name: string, fallback: number, min: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name}: ожидается целое число не меньше ${min}, получено "${raw}"`)
  }
  return value
}

function signedInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`${name}: ожидается целое число, получено "${raw}"`)
  return value
}

function num(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name}: ожидается число от 0 до 1, получено "${raw}"`)
  }
  return value
}

export function parseFaults(raw: string | undefined): Set<Fault> {
  const result = new Set<Fault>()
  if (!raw) return result
  const known = Object.values(FAULTS) as string[]
  for (const part of raw.split(',')) {
    const name = part.trim()
    if (name === '') continue
    if (!known.includes(name)) {
      throw new Error(`${ENV.faults}: неизвестный режим "${name}", допустимо: ${known.join(', ')}`)
    }
    result.add(name as Fault)
  }
  return result
}

export function parseConfig(
  env: Record<string, string | undefined>,
  overrides: Partial<MockConfig> = {},
): MockConfig {
  const role = env[ENV.role] ?? ROLES.dispatcher
  if (role !== ROLES.dispatcher && role !== ROLES.observer) {
    throw new Error(`${ENV.role}: допустимо ${ROLES.dispatcher} или ${ROLES.observer}, получено "${role}"`)
  }
  const load = int(env, ENV.load, DEFAULT_LOAD, 1)
  return {
    port: int(env, 'PORT', 8787, 0),
    load,
    faults: parseFaults(env[ENV.faults]),
    role,
    seed: int(env, ENV.faultSeed, 1, 0),
    faultRate: num(env, 'FAULT_RATE', 0.01),
    tickMs: int(env, 'TICK_MS', 100, 10),
    heartbeatMs: int(env, 'HEARTBEAT_MS', HEARTBEAT_INTERVAL_MS, 10),
    resetIntervalMs: int(env, 'RESET_INTERVAL_MS', 120_000, 10),
    slowDelayMs: int(env, 'SLOW_DELAY_MS', 3_000, 0),
    decisionMinMs: int(env, 'DECISION_MIN_MS', 5_000, 1),
    decisionMaxMs: int(env, 'DECISION_MAX_MS', 15_000, 1),
    executeAfterMs: int(env, 'EXECUTE_AFTER_MS', 60_000, 1),
    staleSilentMs: int(env, 'STALE_SILENT_MS', 45_000, 1),
    staleActiveMs: int(env, 'STALE_ACTIVE_MS', 30_000, 1),
    serviceMinMs: int(env, 'SERVICE_MIN_MS', 10_000, 1),
    serviceMaxMs: int(env, 'SERVICE_MAX_MS', 25_000, 1),
    queueRecomputeMs: int(env, 'QUEUE_RECOMPUTE_MS', 500, 0),
    journalSize: int(env, 'JOURNAL_SIZE', Math.max(50_000, load * 10), 10),
    speedScale: int(env, 'SPEED_SCALE', 1, 1),
    clockOffsetMs: signedInt(env, 'CLOCK_OFFSET_MS', 0),
    prefillDecisions: int(env, 'PREFILL_DECISIONS', 0, 0),
    ...overrides,
  }
}

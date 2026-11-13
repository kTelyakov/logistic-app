/** Шаблоны путей. Параметр :id подставляет вызывающий код. */
export const PATHS = {
  me: '/api/me',
  snapshot: '/api/snapshot',
  decisionCancel: '/api/decisions/:id/cancel',
  pointMode: '/api/points/:id/mode',
  ws: '/ws',
  debugState: '/debug/state',
  debugPause: '/debug/pause',
  debugResume: '/debug/resume',
} as const

export const HEADERS = {
  idempotencyKey: 'Idempotency-Key',
  ifMatch: 'If-Match',
} as const

/** Режимы отказов заглушки (переменная окружения FAULTS, через запятую). */
export const FAULTS = {
  drop: 'drop',
  dup: 'dup',
  reorder: 'reorder',
  reset: 'reset',
  slow: 'slow',
  stale: 'stale',
} as const

export type Fault = (typeof FAULTS)[keyof typeof FAULTS]

export const ROLES = {
  dispatcher: 'dispatcher',
  observer: 'observer',
} as const

/** Имена переменных окружения заглушки. */
export const ENV = {
  load: 'LOAD',
  faults: 'FAULTS',
  role: 'ROLE',
  faultSeed: 'FAULT_SEED',
} as const

/** Период heartbeat, мс. */
export const HEARTBEAT_INTERVAL_MS = 5_000

/** Машина без данных дольше этого срока (по времени сервера) считается устаревшей, мс. */
export const STALE_AFTER_MS = 30_000

// Проверка типов контракта: файл не запускается, его проверяет `vue-tsc --noEmit` (make check).
// Лишний @ts-expect-error сам является ошибкой, поэтому негативные случаи не могут «молча» перестать работать.
import {
  ENV,
  FAULTS,
  HEADERS,
  PATHS,
  type CancelDecisionResponse,
  type Decision,
  type Fault,
  type Me,
  type Point,
  type SetPointModeResponse,
  type Snapshot,
  type Vehicle,
  type WsMessage,
} from '@dispatch/contract'

// --- Фикстуры: примеры из Frontend.md, часть 1 ---

export const vehicle: Vehicle = {
  vehicle_id: 'v-17',
  name: 'Т-17',
  x_m: 2410.5,
  y_m: 1180.0,
  heading_deg: 72,
  speed_kmh: 24.5,
  state: 'moving_empty',
  point_id: 'p-2',
  last_seen: '2026-10-01T04:12:09Z',
}

export const point: Point = {
  point_id: 'p-2',
  name: 'Пункт 2',
  x_m: 3120,
  y_m: 900,
  mode: 'auto',
  version: 14,
  queue: [
    {
      vehicle_id: 'v-09',
      eta: '2026-10-01T04:13:40Z',
      service_start: '2026-10-01T04:15:10Z',
      wait_s: 90,
    },
  ],
}

export const decision: Decision = {
  decision_id: 'd-3381',
  vehicle_id: 'v-17',
  from_point: 'p-2',
  to_point: 'p-4',
  gain_s: 140,
  reason: 'Очередь на Пункт 2 — 4 машины, Пункт 4 свободен',
  status: 'pending',
  created_at: '2026-10-01T04:12:05Z',
  execute_at: '2026-10-01T04:13:05Z',
  version: 1,
}

export const me: Me = {
  user_id: 'u-7',
  name: 'Иванова А. С.',
  role: 'dispatcher',
  site: { name: 'Площадка 3', tz: 'Asia/Krasnoyarsk' },
}

export const snapshot: Snapshot = {
  seq: 50412,
  at: '2026-10-01T04:12:10Z',
  vehicles: [vehicle],
  points: [point],
  decisions: [decision],
}

// --- Негативные случаи: значения вне перечислений ---

export const badVehicleState: Vehicle = {
  ...vehicle,
  // @ts-expect-error состояние вне moving_loaded/moving_empty/queued/service/idle/offline
  state: 'flying',
}

export const badDecisionStatus: Decision = {
  ...decision,
  // @ts-expect-error статус вне pending/executed/cancelled/expired
  status: 'done',
}

export const badRole: Me = {
  ...me,
  // @ts-expect-error роль вне dispatcher/observer
  role: 'admin',
}

// --- Сообщения WS: исчерпывающая обработка ---

export function describeMessage(message: WsMessage): string {
  switch (message.type) {
    case 'vehicle':
      return message.data.vehicle_id
    case 'point':
      return message.data.point_id
    case 'decision':
      return message.data.decision_id
    case 'reset':
      return 'reset'
    case 'heartbeat':
      return String(message.seq)
    default: {
      const unreachable: never = message
      return unreachable
    }
  }
}

export function incompleteSwitch(message: WsMessage): string {
  switch (message.type) {
    case 'vehicle':
      return message.data.vehicle_id
    case 'point':
      return message.data.point_id
    case 'decision':
      return message.data.decision_id
    case 'reset':
      return 'reset'
    default: {
      // @ts-expect-error heartbeat не обработан, поэтому never недостижим
      const unreachable: never = message
      return unreachable
    }
  }
}

// --- Ответы команд: 200, 409, 403 ---

export const cancelOk: CancelDecisionResponse = {
  status: 200,
  body: { ...decision, status: 'cancelled', version: 2 },
}

export const cancelConflict: CancelDecisionResponse = {
  status: 409,
  body: { ...decision, status: 'executed', version: 3 },
}

export const cancelForbidden: CancelDecisionResponse = {
  status: 403,
  body: { message: 'Нет прав на выполнение команды' },
}

export const modeConflict: SetPointModeResponse = {
  status: 409,
  body: { ...point, mode: 'manual', version: 15 },
}

// 409 несёт актуальную сущность: из тела читается статус решения
export function conflictStatus(response: CancelDecisionResponse): Decision['status'] | null {
  return response.status === 409 ? response.body.status : null
}

// 403 не несёт сущность
// @ts-expect-error в теле 403 нет решения, только сообщение
export const badForbidden: CancelDecisionResponse = {
  status: 403,
  body: decision,
}

// --- Константы ---

export const idempotencyHeader: 'Idempotency-Key' = HEADERS.idempotencyKey
export const ifMatchHeader: 'If-Match' = HEADERS.ifMatch
export const cancelPath: '/api/decisions/:id/cancel' = PATHS.decisionCancel
export const loadEnvName: 'LOAD' = ENV.load
export const knownFault: Fault = FAULTS.slow
// @ts-expect-error неизвестный режим отказа
export const unknownFault: Fault = 'explode'

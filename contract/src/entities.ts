/** Время в ISO 8601, UTC. Например "2026-10-01T04:12:09Z". */
export type IsoTimestamp = string

export type VehicleState =
  | 'moving_loaded'
  | 'moving_empty'
  | 'queued'
  | 'service'
  | 'idle'
  | 'offline'

export type DecisionStatus = 'pending' | 'executed' | 'cancelled' | 'expired'

export type PointMode = 'auto' | 'manual'

export type Role = 'dispatcher' | 'observer'

/** Координаты в метрах в локальной системе площадки (около 6 x 4 км). */
export interface Vehicle {
  vehicle_id: string
  name: string
  x_m: number
  y_m: number
  heading_deg: number
  speed_kmh: number
  state: VehicleState
  point_id: string
  /** Последние данные от машины. */
  last_seen: IsoTimestamp
}

export interface QueueItem {
  vehicle_id: string
  eta: IsoTimestamp
  service_start: IsoTimestamp
  wait_s: number
}

export interface Point {
  point_id: string
  name: string
  x_m: number
  y_m: number
  mode: PointMode
  /** Растёт при каждом изменении, передаётся в If-Match. */
  version: number
  queue: QueueItem[]
}

export interface Decision {
  decision_id: string
  vehicle_id: string
  from_point: string
  to_point: string
  gain_s: number
  /** Текст для человека, может содержать любые символы. Выводить только как текст. */
  reason: string
  status: DecisionStatus
  created_at: IsoTimestamp
  execute_at: IsoTimestamp
  /** Растёт при каждом изменении, передаётся в If-Match. */
  version: number
}

export interface Site {
  name: string
  /** IANA-пояс площадки, например "Asia/Krasnoyarsk". */
  tz: string
}

export interface Me {
  user_id: string
  name: string
  role: Role
  site: Site
}

/** Состояние на момент seq. Решения за последний час. */
export interface Snapshot {
  seq: number
  at: IsoTimestamp
  vehicles: Vehicle[]
  points: Point[]
  decisions: Decision[]
}

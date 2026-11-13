import type { Decision, IsoTimestamp, Point, Vehicle } from './entities'

/** В data полный объект после изменения. seq растёт на 1. */
export interface VehicleMessage {
  seq: number
  at: IsoTimestamp
  type: 'vehicle'
  data: Vehicle
}

export interface PointMessage {
  seq: number
  at: IsoTimestamp
  type: 'point'
  data: Point
}

export interface DecisionMessage {
  seq: number
  at: IsoTimestamp
  type: 'decision'
  data: Decision
}

/** Сообщений после since уже нет: клиент заново запрашивает снимок. */
export interface ResetMessage {
  type: 'reset'
}

/** Раз в 5 секунд. at это время сервера. */
export interface HeartbeatMessage {
  seq: number
  at: IsoTimestamp
  type: 'heartbeat'
}

export type DataMessage = VehicleMessage | PointMessage | DecisionMessage

export type WsMessage = DataMessage | ResetMessage | HeartbeatMessage

import type { Decision, DecisionMessage, Point, PointMessage } from '@dispatch/contract'
import type { VehicleColumns, VehicleFrame, VehicleTables } from '@/modules/vehicles'
import type { SyncConfig, SyncPhase, SyncStats } from './core'

/** Пакет изменений для основного потока. Один postMessage на пакет. */
export interface BatchOutput {
  type: 'batch'
  /** Последний применённый seq: пакет содержит ровно те изменения, которые к нему привели. */
  seq: number
  vehicles?: {
    frame: VehicleFrame
    /** Справочники строк. Передаются только при изменении набора машин. */
    tables?: VehicleTables
  }
  entities?: {
    /** Полная замена пунктов и решений (после снимка). */
    replace?: { points: Point[]; decisions: Decision[] }
    /** Изменения после замены; на один id остаётся последнее. */
    messages: Array<PointMessage | DecisionMessage>
  }
}

export interface StatusOutput {
  type: 'status'
  phase: SyncPhase
  seq: number
  /** Сдвиг времени сервера относительно браузера, мс. */
  offsetMs: number
  synced: boolean
  /** Сколько миллисекунд от сервера не было ни сообщений, ни heartbeat. */
  idleMs: number
  snapshots: number
  stats: SyncStats
}

export type EngineOutput = BatchOutput | StatusOutput

/** Сообщения основного потока воркеру. */
export type WorkerInput =
  | { type: 'start'; baseUrl: string; config?: Partial<SyncConfig> }
  | { type: 'recycle'; columns: VehicleColumns }
  | { type: 'stop' }

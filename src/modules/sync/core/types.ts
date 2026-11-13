import type { DataMessage, Snapshot, WsMessage } from '@dispatch/contract'

/**
 * loading: первого снимка ещё нет.
 * live: состояние применено, поток идёт.
 * reconnecting: состояние актуально на lastSeq, но соединение потеряно.
 * resyncing: ждём новый снимок; прежнее состояние остаётся на экране, входящее копится в буфере.
 */
export type SyncPhase = 'idle' | 'loading' | 'live' | 'reconnecting' | 'resyncing'

export type ResyncReason = 'gap' | 'tail' | 'reset' | 'overflow'

export interface SyncStats {
  /** Применено сообщений данных. */
  applied: number
  /** Проигнорировано повторов. */
  duplicates: number
  /** Сколько сообщений пришло раньше времени и дождалось недостающих. */
  reordered: number
  /** Сколько раз запрашивался новый снимок после первого. */
  resyncs: number
  overflows: number
  lastResyncReason: ResyncReason | null
}

export interface SyncState {
  phase: SyncPhase
  /** Есть применённый снимок: экран может показывать данные. */
  hasState: boolean
  /** Последний применённый seq. */
  lastSeq: number
  /** Сообщения, опередившие lastSeq, по seq. */
  buffer: Map<number, DataMessage>
  /** Когда в буфере появилось опережающее сообщение (монотонные мс). */
  gapSince: number | null
  /** Наибольший seq, о котором знаем по сообщениям и heartbeat. */
  knownSeq: number
  /** Когда впервые заметили, что heartbeat опережает lastSeq. */
  tailSince: number | null
  fetching: boolean
  fetchRetryAt: number | null
  fetchFailures: number
  socketFailures: number
  lastFetchAt: number | null
  snapshotsLoaded: number
  stats: SyncStats
}

export type SyncEvent =
  | { type: 'start'; now: number }
  | { type: 'snapshot'; snapshot: Snapshot; now: number }
  | { type: 'snapshotFailed'; now: number }
  | { type: 'messages'; messages: readonly WsMessage[]; now: number }
  | { type: 'socketClosed'; now: number }
  | { type: 'tick'; now: number }

export type SyncEffect =
  | { type: 'fetchSnapshot' }
  /** Закрыть прежнее соединение (если есть) и открыть новое через delayMs. */
  | { type: 'openSocket'; since: number; delayMs: number }
  | { type: 'replace'; snapshot: Snapshot }
  | { type: 'apply'; messages: DataMessage[] }

export interface SyncConfig {
  /** Сколько ждём недостающее сообщение, прежде чем считать его потерянным. */
  reorderWindowMs: number
  maxBuffer: number
  retryBaseMs: number
  retryMaxMs: number
  /** Минимальный интервал между запросами снимка. */
  resyncCooldownMs: number
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  reorderWindowMs: 500,
  maxBuffer: 200_000,
  retryBaseMs: 500,
  retryMaxMs: 10_000,
  resyncCooldownMs: 1_000,
}

import { HEARTBEAT_INTERVAL_MS } from '@dispatch/contract'
import type { SyncPhase } from '../core'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'stale'

/** Данные считаются устаревшими, если от сервера нет ни сообщений, ни heartbeat дольше трёх интервалов heartbeat. */
export const STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 3

export interface ConnectionStatus {
  state: ConnectionState
  label: string
}

const LABELS: Record<ConnectionState, string> = {
  connecting: 'Подключение',
  connected: 'Подключено',
  reconnecting: 'Переподключение',
  stale: 'Данные устарели',
}

/**
 * Статус связи для диспетчера. Время без сообщений = измеренное воркером + возраст самого статуса:
 * если зависнет воркер, статусы перестанут приходить и «данные устарели» появится всё равно.
 */
export function describeConnection(input: { phase: SyncPhase; idleMs: number; statusAgeMs: number }): ConnectionStatus {
  const { phase, idleMs, statusAgeMs } = input
  let state: ConnectionState
  if (phase === 'idle' || phase === 'loading') state = 'connecting'
  else if (phase === 'reconnecting' || phase === 'resyncing') state = 'reconnecting'
  else state = idleMs + statusAgeMs > STALE_AFTER_MS ? 'stale' : 'connected'
  return { state, label: LABELS[state] }
}

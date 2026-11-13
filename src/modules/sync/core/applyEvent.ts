import type { DataMessage } from '@dispatch/contract'
import {
  DEFAULT_SYNC_CONFIG,
  type ResyncReason,
  type SyncConfig,
  type SyncEffect,
  type SyncEvent,
  type SyncState,
} from './types'

export function createSyncState(): SyncState {
  return {
    phase: 'idle',
    hasState: false,
    lastSeq: 0,
    buffer: new Map(),
    gapSince: null,
    knownSeq: 0,
    tailSince: null,
    fetching: false,
    fetchRetryAt: null,
    fetchFailures: 0,
    socketFailures: 0,
    lastFetchAt: null,
    snapshotsLoaded: 0,
    stats: { applied: 0, duplicates: 0, reordered: 0, resyncs: 0, overflows: 0, lastResyncReason: null },
  }
}

const NONE: SyncEffect[] = []

function backoff(failures: number, config: SyncConfig): number {
  return Math.min(config.retryMaxMs, config.retryBaseMs * 2 ** Math.max(0, failures - 1))
}

function requestSnapshot(state: SyncState, now: number): SyncEffect[] {
  if (state.fetching) return NONE
  state.fetching = true
  state.fetchRetryAt = null
  state.lastFetchAt = now
  return [{ type: 'fetchSnapshot' }]
}

/** Новый снимок нужен; сообщения до его прихода копятся в буфере, а не применяются. */
function beginResync(state: SyncState, now: number, reason: ResyncReason, config: SyncConfig): SyncEffect[] {
  state.stats.resyncs += 1
  state.stats.lastResyncReason = reason
  state.phase = 'resyncing'
  state.gapSince = null
  state.tailSince = null
  if (state.fetching) return NONE
  if (state.lastFetchAt !== null && now - state.lastFetchAt < config.resyncCooldownMs) {
    state.fetchRetryAt = state.lastFetchAt + config.resyncCooldownMs
    return NONE
  }
  return requestSnapshot(state, now)
}

/** Применяет подряд идущие сообщения из буфера, начиная со следующего за lastSeq. */
function drain(state: SyncState, applied: DataMessage[]): void {
  for (;;) {
    const next = state.buffer.get(state.lastSeq + 1)
    if (!next) return
    state.buffer.delete(state.lastSeq + 1)
    state.lastSeq += 1
    state.stats.applied += 1
    state.stats.reordered += 1
    applied.push(next)
  }
}

function maxBuffered(state: SyncState): number {
  let max = 0
  for (const seq of state.buffer.keys()) if (seq > max) max = seq
  return max
}

/** После изменений пересчитывает, измерять ли дыру в буфере и хвосте. */
function refreshGaps(state: SyncState, now: number): void {
  if (state.buffer.size > 0) state.gapSince ??= now
  else state.gapSince = null
  if (state.knownSeq > state.lastSeq && state.buffer.size === 0) state.tailSince ??= now
  else if (state.knownSeq <= state.lastSeq) state.tailSince = null
}

function onSnapshot(state: SyncState, event: Extract<SyncEvent, { type: 'snapshot' }>): SyncEffect[] {
  if (!state.fetching) return NONE
  const { snapshot, now } = event
  state.fetching = false
  state.fetchFailures = 0
  state.fetchRetryAt = null

  // Снимок заменяет состояние целиком, в том числе когда его seq меньше (сервер перезапущен)
  state.lastSeq = snapshot.seq
  state.hasState = true
  state.snapshotsLoaded += 1
  for (const seq of [...state.buffer.keys()]) if (seq <= snapshot.seq) state.buffer.delete(seq)

  const applied: DataMessage[] = []
  drain(state, applied)
  state.phase = 'live'
  state.knownSeq = Math.max(state.lastSeq, maxBuffered(state))
  state.gapSince = null
  state.tailSince = null
  refreshGaps(state, now)

  const effects: SyncEffect[] = [{ type: 'replace', snapshot }]
  if (applied.length > 0) effects.push({ type: 'apply', messages: applied })
  effects.push({ type: 'openSocket', since: state.lastSeq, delayMs: 0 })
  return effects
}

function onMessages(
  state: SyncState,
  event: Extract<SyncEvent, { type: 'messages' }>,
  config: SyncConfig,
): SyncEffect[] {
  const { now } = event
  const effects: SyncEffect[] = []
  let applied: DataMessage[] = []
  const flush = () => {
    if (applied.length > 0) effects.push({ type: 'apply', messages: applied })
    applied = []
  }

  for (const message of event.messages) {
    if (message.type === 'reset') {
      flush()
      state.buffer.clear()
      effects.push(...beginResync(state, now, 'reset', config))
      continue
    }

    state.socketFailures = 0
    if (state.phase === 'reconnecting') state.phase = 'live'

    if (message.type === 'heartbeat') {
      if (message.seq > state.knownSeq) state.knownSeq = message.seq
      if (state.phase === 'live') refreshGaps(state, now)
      continue
    }

    if (message.seq > state.knownSeq) state.knownSeq = message.seq

    // Снимка ещё нет или он загружается: копим, применим после замены состояния
    if (state.phase !== 'live') {
      if (message.seq > state.lastSeq || !state.hasState) {
        if (state.buffer.size >= config.maxBuffer) {
          state.buffer.clear()
          state.stats.overflows += 1
        }
        state.buffer.set(message.seq, message)
      }
      continue
    }

    if (message.seq <= state.lastSeq) {
      state.stats.duplicates += 1
      continue
    }
    if (message.seq === state.lastSeq + 1) {
      state.lastSeq = message.seq
      state.stats.applied += 1
      applied.push(message)
      drain(state, applied)
      // Прогресс: дыра, которую мы ждали, закрыта. Если в буфере осталось следующее опережающее
      // сообщение, это новая дыра, и ждать её окно нужно заново, а не от старого момента
      state.gapSince = null
      state.tailSince = null
      refreshGaps(state, now)
      continue
    }

    // Опередило недостающее: ждём окно перестановки
    if (state.buffer.has(message.seq)) {
      state.stats.duplicates += 1
      continue
    }
    if (state.buffer.size >= config.maxBuffer) {
      flush()
      state.buffer.clear()
      state.stats.overflows += 1
      effects.push(...beginResync(state, now, 'overflow', config))
      continue
    }
    state.buffer.set(message.seq, message)
    refreshGaps(state, now)
  }
  flush()
  return effects
}

function onTick(state: SyncState, now: number, config: SyncConfig): SyncEffect[] {
  const effects: SyncEffect[] = []
  if (state.fetchRetryAt !== null && now >= state.fetchRetryAt && !state.fetching) {
    effects.push(...requestSnapshot(state, now))
  }
  if (state.phase === 'live') {
    const gap = state.gapSince !== null && now - state.gapSince >= config.reorderWindowMs
    const tail = state.tailSince !== null && now - state.tailSince >= config.reorderWindowMs
    if (gap || tail) effects.push(...beginResync(state, now, gap ? 'gap' : 'tail', config))
  }
  return effects.length > 0 ? effects : NONE
}

/**
 * Единственный вход ядра: изменяет `state` и возвращает эффекты для оболочки.
 * Ядро не обращается к сети, таймерам и часам: время приходит в событиях (`now`, монотонные мс).
 */
export function applyEvent(
  state: SyncState,
  event: SyncEvent,
  config: SyncConfig = DEFAULT_SYNC_CONFIG,
): SyncEffect[] {
  switch (event.type) {
    case 'start':
      state.phase = 'loading'
      return requestSnapshot(state, event.now)
    case 'snapshot':
      return onSnapshot(state, event)
    case 'snapshotFailed':
      state.fetching = false
      state.fetchFailures += 1
      state.fetchRetryAt = event.now + backoff(state.fetchFailures, config)
      return NONE
    case 'messages':
      return onMessages(state, event, config)
    case 'socketClosed': {
      if (!state.hasState || state.phase === 'resyncing' || state.phase === 'loading') return NONE
      state.phase = 'reconnecting'
      state.socketFailures += 1
      return [{ type: 'openSocket', since: state.lastSeq, delayMs: backoff(state.socketFailures, config) }]
    }
    case 'tick':
      return onTick(state, event.now, config)
  }
}

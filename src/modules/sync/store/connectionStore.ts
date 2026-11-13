import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SyncPhase, SyncStats } from '../core'
import type { StatusOutput } from '../protocol'

const EMPTY_STATS: SyncStats = { applied: 0, duplicates: 0, reordered: 0, resyncs: 0, overflows: 0, lastResyncReason: null }

/** Состояние связи с сервером: общее и долгоживущее, поэтому в Pinia. Машины сюда не попадают. */
export const useConnectionStore = defineStore('connection', () => {
  const phase = ref<SyncPhase>('idle')
  /** Последний seq, показанный на экране (применённый пакет). */
  const appliedSeq = ref(0)
  const serverSeq = ref(0)
  const offsetMs = ref(0)
  const synced = ref(false)
  const idleMs = ref(0)
  /** Когда пришёл последний статус (performance.now основного потока). */
  const statusAt = ref(0)
  const snapshots = ref(0)
  const stats = ref<SyncStats>({ ...EMPTY_STATS })

  function applyStatusMutator(status: StatusOutput, receivedAt: number): void {
    phase.value = status.phase
    serverSeq.value = status.seq
    offsetMs.value = status.offsetMs
    synced.value = status.synced
    idleMs.value = status.idleMs
    statusAt.value = receivedAt
    snapshots.value = status.snapshots
    stats.value = status.stats
  }

  function setAppliedSeqMutator(seq: number): void {
    appliedSeq.value = seq
  }

  /** Текущее время сервера (мс). Часы браузера не используются напрямую: только через сдвиг. */
  function serverNow(): number {
    return Date.now() + offsetMs.value
  }

  return { phase, appliedSeq, serverSeq, offsetMs, synced, idleMs, statusAt, snapshots, stats, applyStatusMutator, setAppliedSeqMutator, serverNow }
})

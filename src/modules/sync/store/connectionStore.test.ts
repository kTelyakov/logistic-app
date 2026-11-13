import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusOutput } from '../protocol'
import { useConnectionStore } from './connectionStore'

const status = (patch: Partial<StatusOutput> = {}): StatusOutput => ({
  type: 'status', phase: 'live', seq: 42, offsetMs: 7_200_000, synced: true, idleMs: 120, snapshots: 2,
  stats: { applied: 10, duplicates: 1, reordered: 2, resyncs: 1, overflows: 0, lastResyncReason: 'gap' },
  ...patch,
})

describe('connectionStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('начальное состояние: связи ещё нет', () => {
    const store = useConnectionStore()
    expect(store.phase).toBe('idle')
    expect(store.synced).toBe(false)
    expect(store.appliedSeq).toBe(0)
  })

  it('статус воркера переносится в состояние', () => {
    const store = useConnectionStore()
    store.applyStatusMutator(status(), 1234)
    expect(store).toMatchObject({ phase: 'live', serverSeq: 42, offsetMs: 7_200_000, synced: true, idleMs: 120, statusAt: 1234, snapshots: 2 })
    expect(store.stats.lastResyncReason).toBe('gap')
  })

  it('serverNow: время браузера плюс сдвиг, а не часы браузера как есть', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-01T02:00:00Z')) // часы браузера отстают на 2 часа
    const store = useConnectionStore()
    store.applyStatusMutator(status(), 0)
    expect(store.serverNow()).toBe(Date.parse('2026-10-01T04:00:00Z'))
    vi.useRealTimers()
  })

  it('показанный seq меняется отдельно от статуса', () => {
    const store = useConnectionStore()
    store.setAppliedSeqMutator(77)
    expect(store.appliedSeq).toBe(77)
    expect(store.serverSeq).toBe(0)
  })
})

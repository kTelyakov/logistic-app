// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { StatusOutput } from '../protocol'
import { useConnectionStore } from '../store/connectionStore'
import { useServerNow } from './useServerNow'

const status = (offsetMs: number): StatusOutput => ({
  type: 'status', phase: 'live', seq: 1, offsetMs, synced: true, idleMs: 0, snapshots: 1,
  stats: { applied: 0, duplicates: 0, reordered: 0, resyncs: 0, overflows: 0, lastResyncReason: null },
})

describe('useServerNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.useRealTimers())

  it('время сервера идёт вместе со временем браузера и учитывает сдвиг', async () => {
    vi.setSystemTime(Date.parse('2026-10-01T02:00:00Z')) // браузер отстаёт на 2 часа
    useConnectionStore().applyStatusMutator(status(7_200_000), 0)
    let seen = 0
    const Probe = defineComponent({
      setup() {
        const now = useServerNow(500)
        return () => {
          seen = now.value
          return h('span')
        }
      },
    })
    const wrapper = mount(Probe)
    expect(seen).toBe(Date.parse('2026-10-01T04:00:00Z'))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(seen).toBe(Date.parse('2026-10-01T04:00:03Z'))
    wrapper.unmount()
  })

  it('после размонтирования таймер остановлен', async () => {
    useConnectionStore().applyStatusMutator(status(0), 0)
    const Probe = defineComponent({ setup() { useServerNow(500); return () => h('span') } })
    const wrapper = mount(Probe)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('смена сдвига подхватывается при следующем обновлении', async () => {
    vi.setSystemTime(Date.parse('2026-10-01T04:00:00Z'))
    const store = useConnectionStore()
    store.applyStatusMutator(status(0), 0)
    let seen = 0
    const Probe = defineComponent({ setup() { const now = useServerNow(500); return () => { seen = now.value; return h('span') } } })
    mount(Probe)
    store.applyStatusMutator(status(60_000), 0)
    await vi.advanceTimersByTimeAsync(500) // значение снимается в момент тика
    expect(seen - Date.now()).toBe(60_000)
  })
})

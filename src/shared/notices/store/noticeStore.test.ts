import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNoticeStore } from './noticeStore'

describe('noticeStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.useRealTimers())

  it('сообщение появляется и исчезает через ttl', () => {
    const store = useNoticeStore()
    store.pushNoticeMutator('info', 'готово', 1_000)
    expect(store.notices).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(store.notices).toHaveLength(1)
    vi.advanceTimersByTime(2)
    expect(store.notices).toHaveLength(0)
  })

  it('закрытие вручную снимает таймер', () => {
    const store = useNoticeStore()
    const id = store.pushNoticeMutator('error', 'сбой', 5_000)
    store.dismissNoticeMutator(id)
    expect(store.notices).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('в стеке не больше пяти сообщений, вытесненные не оставляют таймеров', () => {
    const store = useNoticeStore()
    for (let i = 0; i < 8; i++) store.pushNoticeMutator('conflict', `№${i}`, 60_000)
    expect(store.notices.map((n) => n.message)).toEqual(['№3', '№4', '№5', '№6', '№7'])
    expect(vi.getTimerCount()).toBe(5)
  })

  it('ttl=0: сообщение остаётся до закрытия', () => {
    const store = useNoticeStore()
    store.pushNoticeMutator('unknown', 'нет ответа', 0)
    vi.advanceTimersByTime(10 * 60_000)
    expect(store.notices).toHaveLength(1)
  })

  it('идентификаторы уникальны', () => {
    const store = useNoticeStore()
    const a = store.pushNoticeMutator('info', 'a', 0)
    const b = store.pushNoticeMutator('info', 'b', 0)
    expect(a).not.toBe(b)
  })
})

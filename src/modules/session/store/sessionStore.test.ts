import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionStore } from './sessionStore'

const me = (role: 'dispatcher' | 'observer') => ({ user_id: 'u-7', name: 'Иванова А. С.', role, site: { name: 'Площадка 3', tz: 'Asia/Krasnoyarsk' } })

describe('sessionStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('до загрузки: пояс UTC, действий нет', () => {
    const store = useSessionStore()
    expect(store.siteTz).toBe('UTC')
    expect(store.mayCommand).toBe(false)
  })

  it('диспетчер: пояс площадки и право на действия', () => {
    const store = useSessionStore()
    store.setMeMutator(me('dispatcher'))
    expect(store.siteTz).toBe('Asia/Krasnoyarsk')
    expect(store.siteName).toBe('Площадка 3')
    expect(store.mayCommand).toBe(true)
  })

  it('наблюдатель: действий нет', () => {
    const store = useSessionStore()
    store.setMeMutator(me('observer'))
    expect(store.mayCommand).toBe(false)
  })

  it('ошибка сбрасывается при успешной загрузке', () => {
    const store = useSessionStore()
    store.setErrorMutator('сеть')
    expect(store.error).toBe('сеть')
    store.setMeMutator(me('dispatcher'))
    expect(store.error).toBeUndefined()
  })
})

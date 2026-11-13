import { describe, expect, it, vi } from 'vitest'
import { HttpNetworkError, HttpTimeoutError } from '@/shared/http'
import { createCommandKey } from './commandKey'
import { CommandOutcomeUnknownError, DEFAULT_ATTEMPTS, sendIdempotent, type AttemptInfo } from './sendIdempotent'

const ok = <T,>(body: T, status = 200) => ({ status, body })
const noSleep = () => Promise.resolve()

describe('createCommandKey', () => {
  it('каждый раз новый, формат UUID версии 4', () => {
    const keys = new Set(Array.from({ length: 200 }, () => createCommandKey()))
    expect(keys.size).toBe(200)
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('без crypto.randomUUID (небезопасный контекст) ключ всё равно создаётся', () => {
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const a = createCommandKey()
      const b = createCommandKey()
      expect(a).toMatch(/^[0-9a-f-]{36}$/)
      expect(a).not.toBe(b)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})

describe('sendIdempotent', () => {
  it('успех с первой попытки: один запрос', async () => {
    const send = vi.fn(async () => ok({ id: 1 }))
    const result = await sendIdempotent(send, { sleep: noSleep })
    expect(result).toMatchObject({ response: { status: 200, body: { id: 1 } }, attempts: 1 })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('таймаут: повтор с тем же ключом и бóльшим таймаутом', async () => {
    const seen: AttemptInfo[] = []
    const send = async (info: AttemptInfo) => {
      seen.push(info)
      if (info.attempt === 1) throw new HttpTimeoutError('/x', info.timeoutMs)
      return ok({ done: true })
    }
    const result = await sendIdempotent(send, { sleep: noSleep })
    expect(result.attempts).toBe(2)
    expect(seen).toHaveLength(2)
    expect(seen[1]?.key).toBe(seen[0]?.key)
    expect(result.key).toBe(seen[0]?.key)
    expect(seen[1]?.timeoutMs).toBeGreaterThan(seen[0]?.timeoutMs ?? 0)
  })

  it('сетевая ошибка и ответ 5xx тоже повторяются, ключ неизменный', async () => {
    const keys: string[] = []
    const send = async (info: AttemptInfo) => {
      keys.push(info.key)
      if (info.attempt === 1) throw new HttpNetworkError('сеть', '/x')
      if (info.attempt === 2) return ok({}, 503)
      return ok({ fine: true })
    }
    const result = await sendIdempotent(send, { sleep: noSleep })
    expect(result.attempts).toBe(3)
    expect(new Set(keys).size).toBe(1)
  })

  it('409, 403, 404 и 400 возвращаются сразу, без повтора', async () => {
    for (const status of [409, 403, 404, 400]) {
      const send = vi.fn(async () => ok({ status }, status))
      const result = await sendIdempotent(send, { sleep: noSleep })
      expect(result.response.status).toBe(status)
      expect(send).toHaveBeenCalledTimes(1)
    }
  })

  it('все попытки без ответа: исход неизвестен, ключ в ошибке', async () => {
    const send = vi.fn(async (info: AttemptInfo) => {
      throw new HttpTimeoutError('/x', info.timeoutMs)
    })
    const error = await sendIdempotent(send, { sleep: noSleep }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CommandOutcomeUnknownError)
    expect((error as CommandOutcomeUnknownError).attempts).toBe(DEFAULT_ATTEMPTS.length)
    expect((error as CommandOutcomeUnknownError).key).toMatch(/^[0-9a-f-]{36}$/)
    expect(send).toHaveBeenCalledTimes(DEFAULT_ATTEMPTS.length)
  })

  it('постоянный 5xx тоже даёт неизвестный исход', async () => {
    const send = vi.fn(async () => ok({}, 500))
    await expect(sendIdempotent(send, { sleep: noSleep })).rejects.toBeInstanceOf(CommandOutcomeUnknownError)
  })

  it('непредвиденная ошибка (не сеть) не повторяется и пробрасывается', async () => {
    const send = vi.fn(async () => {
      throw new TypeError('ошибка в коде')
    })
    await expect(sendIdempotent(send, { sleep: noSleep })).rejects.toBeInstanceOf(TypeError)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('паузы между попытками соблюдаются', async () => {
    const sleeps: number[] = []
    const send = async (info: AttemptInfo) => {
      if (info.attempt < 3) throw new HttpTimeoutError('/x', info.timeoutMs)
      return ok({})
    }
    await sendIdempotent(send, { sleep: async (ms) => void sleeps.push(ms) })
    expect(sleeps).toEqual([300, 1_000])
  })

  it('слабый сервер: задержка 3 с при таймауте 2 с даёт успех на второй попытке', async () => {
    // Сервер отвечает через 3 с: короткая попытка обрывается, длинная доходит
    const send = async (info: AttemptInfo) => {
      if (3_000 > info.timeoutMs) throw new HttpTimeoutError('/x', info.timeoutMs)
      return ok({ stored: true })
    }
    const result = await sendIdempotent(send, { sleep: noSleep })
    expect(result.attempts).toBe(2)
  })

  it('свой ключ используется как есть', async () => {
    const result = await sendIdempotent(async (info) => ok({ key: info.key }), { key: 'k-fixed', sleep: noSleep })
    expect(result.key).toBe('k-fixed')
  })
})

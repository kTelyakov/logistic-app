import type { Decision } from '@dispatch/contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpTimeoutError } from '@/shared/http'
import { useNoticeStore } from '@/shared/notices'
import type { AttemptInfo } from '@/shared/utils'
import { cancelDecision } from '../api/cancelDecision'
import { useDecisionsStore } from '../store/decisionsStore'
import { useDecisionCommands } from './useDecisionCommands'

vi.mock('../api/cancelDecision', () => ({ cancelDecision: vi.fn() }))
const request = vi.mocked(cancelDecision)

const decision = (patch: Partial<Decision> = {}): Decision => ({
  decision_id: 'd-1', vehicle_id: 'v-17', from_point: 'p-2', to_point: 'p-4', gain_s: 100, reason: '',
  status: 'pending', created_at: '2026-10-01T04:00:00Z', execute_at: '2026-10-01T04:01:00Z', version: 1, ...patch,
})
const noSleep = () => Promise.resolve()

function setup(seed: Decision = decision()) {
  setActivePinia(createPinia())
  const decisions = useDecisionsStore()
  decisions.replaceDecisionsMutator([seed])
  const notices = useNoticeStore()
  const commands = useDecisionCommands({ send: { sleep: noSleep }, vehicleName: () => 'Т-17' })
  return { decisions, notices, commands }
}

/** Запрос, который завершается по команде теста: позволяет проверить состояние «в пути». */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('отмена решения', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('нет оптимистичного обновления: до ответа статус прежний, кнопка занята', async () => {
    const { decisions, commands } = setup()
    const pending = deferred<{ status: number; body: Decision }>()
    request.mockReturnValueOnce(pending.promise)

    const run = commands.cancel('d-1')
    await Promise.resolve()
    expect(commands.isBusy('d-1')).toBe(true)
    expect(decisions.get('d-1')?.status).toBe('pending')

    pending.resolve({ status: 200, body: decision({ status: 'cancelled', version: 2 }) })
    await run
    expect(decisions.get('d-1')).toMatchObject({ status: 'cancelled', version: 2 })
    expect(commands.isBusy('d-1')).toBe(false)
  })

  it('отправляет версию, которую видел диспетчер, и ключ идемпотентности', async () => {
    const { commands } = setup(decision({ version: 7 }))
    request.mockResolvedValueOnce({ status: 200, body: decision({ status: 'cancelled', version: 8 }) })
    await commands.cancel('d-1')
    expect(request).toHaveBeenCalledTimes(1)
    const [id, version, info] = request.mock.calls[0] as [string, number, AttemptInfo]
    expect([id, version]).toEqual(['d-1', 7])
    expect(info.key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('двойное нажатие: команда отправляется один раз', async () => {
    const { commands } = setup()
    const pending = deferred<{ status: number; body: Decision }>()
    request.mockReturnValue(pending.promise)
    const first = commands.cancel('d-1')
    const second = commands.cancel('d-1')
    const third = commands.cancel('d-1')
    pending.resolve({ status: 200, body: decision({ status: 'cancelled', version: 2 }) })
    await Promise.all([first, second, third])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('таймаут и повтор: тот же ключ, растущий таймаут, одно итоговое применение', async () => {
    const { decisions, commands } = setup()
    request
      .mockRejectedValueOnce(new HttpTimeoutError('/x', 2_000))
      .mockResolvedValueOnce({ status: 200, body: decision({ status: 'cancelled', version: 2 }) })
    await commands.cancel('d-1')
    expect(request).toHaveBeenCalledTimes(2)
    const [a, b] = request.mock.calls.map((c) => c[2] as AttemptInfo) as [AttemptInfo, AttemptInfo]
    expect(b.key).toBe(a.key)
    expect(b.timeoutMs).toBeGreaterThan(a.timeoutMs)
    expect(decisions.get('d-1')?.status).toBe('cancelled')
  })

  it('409: сообщение о причине и актуальное состояние из ответа', async () => {
    const { decisions, notices, commands } = setup()
    request.mockResolvedValueOnce({ status: 409, body: decision({ status: 'executed', version: 2 }) })
    await commands.cancel('d-1')
    expect(decisions.get('d-1')).toMatchObject({ status: 'executed', version: 2 })
    expect(notices.notices).toHaveLength(1)
    expect(notices.notices[0]).toMatchObject({ kind: 'conflict', message: 'Решение для Т-17 уже исполнено: отменить нельзя.' })
  })

  it('409 с версией, которая старее известной (опоздавший ответ), не откатывает состояние', async () => {
    const { decisions, commands } = setup(decision({ status: 'executed', version: 5 }))
    request.mockResolvedValueOnce({ status: 409, body: decision({ status: 'pending', version: 1 }) })
    await commands.cancel('d-1')
    expect(decisions.get('d-1')).toMatchObject({ status: 'executed', version: 5 })
  })

  it('403: сообщение об отказе, состояние не меняется', async () => {
    const { decisions, notices, commands } = setup()
    request.mockResolvedValueOnce({ status: 403, body: { message: 'наблюдатель не может выполнять команды' } })
    await commands.cancel('d-1')
    expect(decisions.get('d-1')?.status).toBe('pending')
    expect(notices.notices[0]).toMatchObject({ kind: 'forbidden', message: expect.stringContaining('наблюдатель') })
  })

  it('404 и 400: сообщение об ошибке', async () => {
    const { notices, commands } = setup()
    request.mockResolvedValueOnce({ status: 404, body: { message: 'нет' } })
    await commands.cancel('d-1')
    expect(notices.notices.at(-1)).toMatchObject({ kind: 'error', message: 'Решение не найдено на сервере.' })
  })

  it('неизвестный исход: сообщение, управление возвращается, новое нажатие создаёт новый ключ', async () => {
    const { decisions, notices, commands } = setup()
    request.mockRejectedValue(new HttpTimeoutError('/x', 2_000))
    await commands.cancel('d-1')
    expect(request).toHaveBeenCalledTimes(3)
    expect(notices.notices[0]).toMatchObject({ kind: 'unknown', message: expect.stringContaining('Команда могла быть выполнена') })
    expect(decisions.get('d-1')?.status).toBe('pending')
    expect(commands.isBusy('d-1')).toBe(false)

    const firstKey = (request.mock.calls[0]?.[2] as AttemptInfo).key
    request.mockReset()
    request.mockResolvedValueOnce({ status: 200, body: decision({ status: 'cancelled', version: 2 }) })
    await commands.cancel('d-1')
    expect((request.mock.calls[0]?.[2] as AttemptInfo).key).not.toBe(firstKey)
  })

  it('неизвестное решение: ничего не отправляется', async () => {
    const { commands } = setup()
    await commands.cancel('d-404')
    expect(request).not.toHaveBeenCalled()
  })

  it('разные решения отменяются независимо', async () => {
    const { decisions, commands } = setup()
    decisions.replaceDecisionsMutator([decision(), decision({ decision_id: 'd-2' })])
    const slow = deferred<{ status: number; body: Decision }>()
    request.mockReturnValueOnce(slow.promise)
    request.mockResolvedValueOnce({ status: 200, body: decision({ decision_id: 'd-2', status: 'cancelled', version: 2 }) })
    const a = commands.cancel('d-1')
    await commands.cancel('d-2')
    expect(commands.isBusy('d-1')).toBe(true)
    expect(commands.isBusy('d-2')).toBe(false)
    slow.resolve({ status: 200, body: decision({ status: 'cancelled', version: 2 }) })
    await a
  })
})

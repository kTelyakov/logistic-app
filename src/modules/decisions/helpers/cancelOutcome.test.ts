import type { Decision } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { conflictMessage, interpretCancelResponse } from './cancelOutcome'

const decision = (patch: Partial<Decision> = {}): Decision => ({
  decision_id: 'd-1', vehicle_id: 'v-17', from_point: 'p-2', to_point: 'p-4', gain_s: 100, reason: '',
  status: 'cancelled', created_at: '2026-10-01T04:00:00Z', execute_at: '2026-10-01T04:01:00Z', version: 2, ...patch,
})

describe('interpretCancelResponse', () => {
  it('200: отмена выполнена, состояние из ответа', () => {
    const outcome = interpretCancelResponse({ status: 200, body: decision() }, 'Т-17')
    expect(outcome).toEqual({ kind: 'cancelled', decision: decision() })
  })

  it('409: исполнено, истекло, уже отменено, версия устарела: разные понятные сообщения', () => {
    const msg = (status: Decision['status']) => interpretCancelResponse({ status: 409, body: decision({ status }) }, 'Т-17')
    expect(msg('executed')).toMatchObject({ kind: 'conflict', message: 'Решение для Т-17 уже исполнено: отменить нельзя.' })
    expect(msg('expired')).toMatchObject({ message: 'Срок решения для Т-17 истёк: отменить нельзя.' })
    expect(msg('cancelled')).toMatchObject({ message: 'Решение для Т-17 уже отменено.' })
    expect(msg('pending')).toMatchObject({ message: expect.stringContaining('изменилось на сервере') })
  })

  it('409 несёт актуальное решение из тела ответа', () => {
    const actual = decision({ status: 'executed', version: 3 })
    expect(interpretCancelResponse({ status: 409, body: actual }, 'Т-17')).toMatchObject({ decision: actual })
  })

  it('403: сообщение сервера включено в текст', () => {
    expect(interpretCancelResponse({ status: 403, body: { message: 'наблюдатель не может выполнять команды' } }, 'Т-17')).toEqual({
      kind: 'forbidden',
      message: 'Команда отклонена: наблюдатель не может выполнять команды',
    })
  })

  it('403 без сообщения не падает', () => {
    expect(interpretCancelResponse({ status: 403, body: undefined as never }, 'Т-17')).toMatchObject({ kind: 'forbidden' })
  })

  it('404 и прочие коды', () => {
    expect(interpretCancelResponse({ status: 404, body: { message: 'x' } }, 'Т-17')).toMatchObject({ kind: 'not_found' })
    expect(interpretCancelResponse({ status: 400, body: { message: 'x' } }, 'Т-17')).toEqual({ kind: 'rejected', message: 'Сервер отклонил команду (ответ 400).' })
  })

  it('conflictMessage используется отдельно', () => {
    expect(conflictMessage(decision({ status: 'executed' }), 'Т-1')).toContain('Т-1')
  })
})

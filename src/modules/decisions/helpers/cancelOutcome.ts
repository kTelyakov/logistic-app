import type { Decision } from '@dispatch/contract'
import type { HttpResponse } from '@/shared/http'
import type { CancelResponseBody } from '../api/cancelDecision'

export type CancelOutcome =
  /** Сервер выполнил отмену. */
  | { kind: 'cancelled'; decision: Decision }
  /** Конфликт: решение уже изменилось; в теле актуальное состояние. */
  | { kind: 'conflict'; decision: Decision; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'rejected'; message: string }

const asDecision = (body: CancelResponseBody): Decision => body as Decision
const messageOf = (body: CancelResponseBody, fallback: string): string => (body as { message?: string } | undefined)?.message ?? fallback

/** Объясняет конфликт человеческим языком по актуальному статусу решения. */
export function conflictMessage(decision: Decision, vehicleName: string): string {
  switch (decision.status) {
    case 'executed':
      return `Решение для ${vehicleName} уже исполнено: отменить нельзя.`
    case 'expired':
      return `Срок решения для ${vehicleName} истёк: отменить нельзя.`
    case 'cancelled':
      return `Решение для ${vehicleName} уже отменено.`
    case 'pending':
      return `Решение для ${vehicleName} изменилось на сервере. Показано актуальное состояние, повторите действие при необходимости.`
  }
}

/** Трактует ответ сервера на отмену. Состояние на экране берётся из ответа, не из ожиданий клиента. */
export function interpretCancelResponse(response: HttpResponse<CancelResponseBody>, vehicleName: string): CancelOutcome {
  switch (response.status) {
    case 200:
      return { kind: 'cancelled', decision: asDecision(response.body) }
    case 409: {
      const decision = asDecision(response.body)
      return { kind: 'conflict', decision, message: conflictMessage(decision, vehicleName) }
    }
    case 403:
      return { kind: 'forbidden', message: `Команда отклонена: ${messageOf(response.body, 'недостаточно прав')}` }
    case 404:
      return { kind: 'not_found', message: 'Решение не найдено на сервере.' }
    default:
      return { kind: 'rejected', message: `Сервер отклонил команду (ответ ${response.status}).` }
  }
}

export const UNKNOWN_OUTCOME_MESSAGE = 'Нет ответа от сервера. Команда могла быть выполнена: проверьте статус решения.'

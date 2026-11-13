import { HEADERS, PATHS, type CancelDecisionResponse } from '@dispatch/contract'
import { http, type HttpResponse } from '@/shared/http'
import type { AttemptInfo } from '@/shared/utils'

/** Тело ответа на отмену: решение (200, 409) или сообщение (403, 400, 404). */
export type CancelResponseBody = Extract<CancelDecisionResponse, { status: 200 | 409 }>['body'] | { message: string }

/** Один HTTP-запрос отмены. Ключ и таймаут задаёт вызывающий: повтор идёт с тем же ключом. */
export function cancelDecision(id: string, version: number, info: AttemptInfo): Promise<HttpResponse<CancelResponseBody>> {
  const path = PATHS.decisionCancel.replace(':id', encodeURIComponent(id))
  return http().post<CancelResponseBody>(path, undefined, {
    headers: { [HEADERS.idempotencyKey]: info.key, [HEADERS.ifMatch]: String(version) },
    timeoutMs: info.timeoutMs,
  })
}

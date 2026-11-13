import { HEADERS, PATHS, type Point, type PointMode } from '@dispatch/contract'
import { http, type HttpResponse } from '@/shared/http'
import type { AttemptInfo } from '@/shared/utils'

export type SetModeResponseBody = Point | { message: string }

/** Один HTTP-запрос смены режима. Ключ и таймаут задаёт вызывающий: повтор идёт с тем же ключом. */
export function setPointMode(id: string, mode: PointMode, version: number, info: AttemptInfo): Promise<HttpResponse<SetModeResponseBody>> {
  const path = PATHS.pointMode.replace(':id', encodeURIComponent(id))
  return http().post<SetModeResponseBody>(path, { mode }, {
    headers: { [HEADERS.idempotencyKey]: info.key, [HEADERS.ifMatch]: String(version) },
    timeoutMs: info.timeoutMs,
  })
}

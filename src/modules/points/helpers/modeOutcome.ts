import type { Point, PointMode } from '@dispatch/contract'
import type { HttpResponse } from '@/shared/http'
import type { SetModeResponseBody } from '../api/setPointMode'

export type ModeOutcome =
  | { kind: 'changed'; point: Point }
  | { kind: 'conflict'; point: Point; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'rejected'; message: string }

const MODE_LABELS: Record<PointMode, string> = { auto: 'авто', manual: 'ручной' }

export function modeLabel(mode: PointMode): string {
  return MODE_LABELS[mode]
}

const asPoint = (body: SetModeResponseBody): Point => body as Point

/** Трактует ответ сервера на смену режима. Состояние на экране берётся из ответа. */
export function interpretModeResponse(response: HttpResponse<SetModeResponseBody>, requested: PointMode, pointName: string): ModeOutcome {
  switch (response.status) {
    case 200:
      return { kind: 'changed', point: asPoint(response.body) }
    case 409: {
      const point = asPoint(response.body)
      return {
        kind: 'conflict',
        point,
        message: `${pointName}: режим уже изменился на сервере (сейчас «${modeLabel(point.mode)}», запрошен «${modeLabel(requested)}»). Показано актуальное состояние.`,
      }
    }
    case 403: {
      const text = (response.body as { message?: string } | undefined)?.message ?? 'недостаточно прав'
      return { kind: 'forbidden', message: `Команда отклонена: ${text}` }
    }
    case 404:
      return { kind: 'not_found', message: `${pointName}: пункт не найден на сервере.` }
    default:
      return { kind: 'rejected', message: `Сервер отклонил команду (ответ ${response.status}).` }
  }
}

export const MODE_UNKNOWN_OUTCOME_MESSAGE = 'Нет ответа от сервера. Команда могла быть выполнена: проверьте режим пункта.'

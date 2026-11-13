import type { Decision, PointMode, Point } from './entities'

/** Тело POST /api/points/{id}/mode. Отмена решения тела не имеет. */
export interface SetPointModeBody {
  mode: PointMode
}

/**
 * Тело ответа 403. Сообщение об отказе: в задании форма не описана,
 * поэтому фиксируем минимум, на который опираются заглушка и экран.
 */
export interface ForbiddenBody {
  message: string
}

/**
 * Ответ на команду. 200: сущность с новым состоянием.
 * 409: уже исполнено, истекло или версия устарела; в теле актуальная сущность.
 * 403: нет прав.
 */
export type CommandResponse<T> =
  | { status: 200; body: T }
  | { status: 409; body: T }
  | { status: 403; body: ForbiddenBody }

export type CancelDecisionResponse = CommandResponse<Decision>
export type SetPointModeResponse = CommandResponse<Point>

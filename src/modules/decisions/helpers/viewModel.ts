import type { Decision, DecisionStatus } from '@dispatch/contract'
import { formatSiteDateTime } from '@/modules/session'
import { formatCountdown, formatDuration } from '@/shared/utils/duration'

export interface DecisionView {
  id: string
  status: DecisionStatus
  statusLabel: string
  version: number
  vehicleName: string
  route: string
  /** Выигрыш как сообщил сервер. */
  gain: string
  reason: string
  createdAt: string
  /** Обратный отсчёт до execute_at; только у ожидающих. */
  countdown: string | null
  pending: boolean
}

const STATUS_LABELS: Record<DecisionStatus, string> = {
  pending: 'Ожидает',
  executed: 'Исполнено',
  cancelled: 'Отменено',
  expired: 'Истекло',
}

export interface ViewContext {
  tz: string
  /** Время сервера, мс. */
  serverNowMs: number
  vehicleName(id: string): string
  pointName(id: string): string
}

/** Модель представления решения: значения сервера, отформатированные; отсчёт по времени сервера. */
export function toDecisionView(decision: Decision, ctx: ViewContext): DecisionView {
  const pending = decision.status === 'pending'
  return {
    id: decision.decision_id,
    status: decision.status,
    statusLabel: STATUS_LABELS[decision.status],
    version: decision.version,
    vehicleName: ctx.vehicleName(decision.vehicle_id),
    route: `${ctx.pointName(decision.from_point)} → ${ctx.pointName(decision.to_point)}`,
    gain: formatDuration(decision.gain_s),
    reason: decision.reason,
    createdAt: formatSiteDateTime(decision.created_at, ctx.tz),
    countdown: pending ? formatCountdown(Date.parse(decision.execute_at) - ctx.serverNowMs) : null,
    pending,
  }
}

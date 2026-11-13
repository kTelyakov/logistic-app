import type { Point } from '@dispatch/contract'
import { formatSiteTime } from '@/modules/session'
import { formatDuration } from '@/shared/utils/duration'

export interface QueueRowView {
  key: string
  vehicleId: string
  vehicleName: string
  /** Расчётный приезд, время площадки. */
  eta: string
  etaIso: string
  serviceStart: string
  serviceStartIso: string
  waitS: number
  wait: string
}

export interface PointView {
  id: string
  name: string
  mode: Point['mode']
  modeLabel: string
  queue: QueueRowView[]
}

const MODE_LABELS: Record<Point['mode'], string> = { auto: 'Авто', manual: 'Ручной' }

/** Модель представления для панели очередей: значения сервера, только отформатированные. */
export function toPointViews(points: readonly Point[], tz: string, nameOf: (vehicleId: string) => string): PointView[] {
  return points.map((point) => ({
    id: point.point_id,
    name: point.name,
    mode: point.mode,
    modeLabel: MODE_LABELS[point.mode],
    queue: point.queue.map((item) => ({
      key: `${point.point_id}:${item.vehicle_id}`,
      vehicleId: item.vehicle_id,
      vehicleName: nameOf(item.vehicle_id),
      eta: formatSiteTime(item.eta, tz),
      etaIso: item.eta,
      serviceStart: formatSiteTime(item.service_start, tz),
      serviceStartIso: item.service_start,
      waitS: item.wait_s,
      wait: formatDuration(item.wait_s),
    })),
  }))
}

import type { Decision, DecisionMessage, Point, PointMessage, Vehicle } from '@dispatch/contract'
import { EMPTY_VIEW, vehicleAt, type VehicleView } from '@/modules/vehicles'
import type { BatchTarget } from '../client/applyBatch'

/** Состояние экрана в памяти: то, что в приложении лежит в хранилищах. Для тестов. */
export class Mirror implements BatchTarget {
  view: VehicleView = EMPTY_VIEW
  points = new Map<string, Point>()
  decisions = new Map<string, Decision>()
  seq = 0
  batches = 0

  setVehicleView(view: VehicleView): void {
    this.view = view
  }

  replaceEntities(points: Point[], decisions: Decision[]): void {
    this.points = new Map(points.map((p) => [p.point_id, p]))
    this.decisions = new Map(decisions.map((d) => [d.decision_id, d]))
  }

  applyEntityMessages(messages: Array<PointMessage | DecisionMessage>): void {
    for (const message of messages) {
      if (message.type === 'point') this.points.set(message.data.point_id, message.data)
      else this.decisions.set(message.data.decision_id, message.data)
    }
  }

  setAppliedSeq(seq: number): void {
    this.seq = seq
    this.batches += 1
  }

  vehicles(): Vehicle[] {
    const result: Vehicle[] = []
    for (let slot = 0; slot < this.view.count; slot++) {
      const v = vehicleAt(this.view, slot)
      if (v) result.push(v)
    }
    return result
  }
}

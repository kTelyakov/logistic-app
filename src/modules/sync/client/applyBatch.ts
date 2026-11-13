import type { Decision, DecisionMessage, Point, PointMessage } from '@dispatch/contract'
import { EMPTY_VIEW, type VehicleColumns, type VehicleTables, type VehicleView } from '@/modules/vehicles'
import type { BatchOutput } from '../protocol'

/** Куда применяется пакет: хранилища приложения или зеркало в тестах. */
export interface BatchTarget {
  setVehicleView(view: VehicleView): void
  replaceEntities(points: Point[], decisions: Decision[]): void
  applyEntityMessages(messages: Array<PointMessage | DecisionMessage>): void
  setAppliedSeq(seq: number): void
}

/**
 * Применяет пакет воркера к целевым хранилищам. Помнит справочники строк машин между пакетами
 * и возвращает буферы прежнего кадра, которые нужно вернуть воркеру.
 */
export class BatchApplier {
  private view: VehicleView = EMPTY_VIEW
  private tables: VehicleTables = EMPTY_VIEW.tables

  constructor(private readonly target: BatchTarget) {}

  apply(batch: BatchOutput): VehicleColumns | undefined {
    let released: VehicleColumns | undefined

    if (batch.vehicles) {
      if (batch.vehicles.tables) this.tables = batch.vehicles.tables
      if (this.view !== EMPTY_VIEW) released = this.view.columns
      this.view = { count: batch.vehicles.frame.count, columns: batch.vehicles.frame.columns, tables: this.tables }
      this.target.setVehicleView(this.view)
    }

    if (batch.entities) {
      if (batch.entities.replace) this.target.replaceEntities(batch.entities.replace.points, batch.entities.replace.decisions)
      if (batch.entities.messages.length > 0) this.target.applyEntityMessages(batch.entities.messages)
    }

    this.target.setAppliedSeq(batch.seq)
    return released
  }
}

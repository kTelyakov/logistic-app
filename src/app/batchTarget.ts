import type { DecisionMessage, PointMessage } from '@dispatch/contract'
import { useDecisionsStore } from '@/modules/decisions'
import { usePointsStore } from '@/modules/points'
import { useConnectionStore, type BatchTarget } from '@/modules/sync'
import { vehicleViewStore } from '@/modules/vehicles'

/** Применяет пакеты воркера к хранилищам модулей: единственное место, где сходятся модули синхронизации и данных. */
export function createBatchTarget(): BatchTarget {
  const points = usePointsStore()
  const decisions = useDecisionsStore()
  const connection = useConnectionStore()

  return {
    setVehicleView: (view) => vehicleViewStore.setViewMutator(view),
    replaceEntities(newPoints, newDecisions) {
      points.replacePointsMutator(newPoints)
      decisions.replaceDecisionsMutator(newDecisions)
    },
    applyEntityMessages(messages) {
      const pointMessages: PointMessage[] = []
      const decisionMessages: DecisionMessage[] = []
      for (const message of messages) {
        if (message.type === 'point') pointMessages.push(message)
        else decisionMessages.push(message)
      }
      if (pointMessages.length > 0) points.applyPointMessagesMutator(pointMessages)
      if (decisionMessages.length > 0) decisions.applyDecisionMessagesMutator(decisionMessages)
    },
    // Последним: seq объявляется только после того, как всё содержимое пакета применено
    setAppliedSeq: (seq) => connection.setAppliedSeqMutator(seq),
  }
}

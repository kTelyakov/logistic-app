import { shallowReactive } from 'vue'
import { useNoticeStore } from '@/shared/notices'
import { CommandOutcomeUnknownError, sendIdempotent, type SendOptions } from '@/shared/utils'
import { cancelDecision } from '../api/cancelDecision'
import { interpretCancelResponse, UNKNOWN_OUTCOME_MESSAGE } from '../helpers/cancelOutcome'
import { useDecisionsStore } from '../store/decisionsStore'

/**
 * Команды над решениями: состояние «в пути» и сообщения. Живёт в контейнере: это запросы и ошибки.
 * Без оптимистичных обновлений: экран меняется только по ответу сервера.
 */
export function useDecisionCommands(options: { send?: SendOptions; vehicleName?: (vehicleId: string) => string } = {}) {
  const decisions = useDecisionsStore()
  const notices = useNoticeStore()
  const inFlight = shallowReactive(new Set<string>())

  function isBusy(decisionId: string): boolean {
    return inFlight.has(decisionId)
  }

  async function cancel(decisionId: string): Promise<void> {
    if (inFlight.has(decisionId)) return // двойное нажатие: команда уже в пути
    const decision = decisions.get(decisionId)
    if (!decision) return
    const name = options.vehicleName?.(decision.vehicle_id) ?? decision.vehicle_id

    inFlight.add(decisionId)
    try {
      const { response } = await sendIdempotent((info) => cancelDecision(decisionId, decision.version, info), options.send)
      const outcome = interpretCancelResponse(response, name)
      switch (outcome.kind) {
        case 'cancelled':
          decisions.applyServerDecisionMutator(outcome.decision)
          break
        case 'conflict':
          decisions.applyServerDecisionMutator(outcome.decision)
          notices.pushNoticeMutator('conflict', outcome.message)
          break
        case 'forbidden':
          notices.pushNoticeMutator('forbidden', outcome.message)
          break
        default:
          notices.pushNoticeMutator('error', outcome.message)
      }
    } catch (error) {
      if (error instanceof CommandOutcomeUnknownError) notices.pushNoticeMutator('unknown', UNKNOWN_OUTCOME_MESSAGE, 15_000)
      else notices.pushNoticeMutator('error', `Не удалось отправить команду: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      inFlight.delete(decisionId)
    }
  }

  return { isBusy, cancel }
}

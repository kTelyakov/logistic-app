import type { PointMode } from '@dispatch/contract'
import { shallowReactive } from 'vue'
import { useNoticeStore } from '@/shared/notices'
import { CommandOutcomeUnknownError, sendIdempotent, type SendOptions } from '@/shared/utils'
import { setPointMode } from '../api/setPointMode'
import { interpretModeResponse, MODE_UNKNOWN_OUTCOME_MESSAGE } from '../helpers/modeOutcome'
import { usePointsStore } from '../store/pointsStore'

/** Команды над пунктами: состояние «в пути» и сообщения. Без оптимистичных обновлений. */
export function usePointCommands(options: { send?: SendOptions } = {}) {
  const points = usePointsStore()
  const notices = useNoticeStore()
  const inFlight = shallowReactive(new Set<string>())

  function isBusy(pointId: string): boolean {
    return inFlight.has(pointId)
  }

  async function setMode(pointId: string, mode: PointMode): Promise<void> {
    if (inFlight.has(pointId)) return
    const point = points.get(pointId)
    if (!point || point.mode === mode) return

    inFlight.add(pointId)
    try {
      const { response } = await sendIdempotent((info) => setPointMode(pointId, mode, point.version, info), options.send)
      const outcome = interpretModeResponse(response, mode, point.name)
      switch (outcome.kind) {
        case 'changed':
          points.applyServerPointMutator(outcome.point)
          break
        case 'conflict':
          points.applyServerPointMutator(outcome.point)
          notices.pushNoticeMutator('conflict', outcome.message)
          break
        case 'forbidden':
          notices.pushNoticeMutator('forbidden', outcome.message)
          break
        default:
          notices.pushNoticeMutator('error', outcome.message)
      }
    } catch (error) {
      if (error instanceof CommandOutcomeUnknownError) notices.pushNoticeMutator('unknown', MODE_UNKNOWN_OUTCOME_MESSAGE, 15_000)
      else notices.pushNoticeMutator('error', `Не удалось отправить команду: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      inFlight.delete(pointId)
    }
  }

  return { isBusy, setMode }
}

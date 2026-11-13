import type { Point } from '@dispatch/contract'
import { describe, expect, it } from 'vitest'
import { interpretModeResponse } from './modeOutcome'

const point = (patch: Partial<Point> = {}): Point => ({ point_id: 'p-2', name: 'Пункт 2', x_m: 0, y_m: 0, mode: 'manual', version: 15, queue: [], ...patch })

describe('interpretModeResponse', () => {
  it('200: режим сменён, состояние из ответа', () => {
    expect(interpretModeResponse({ status: 200, body: point() }, 'manual', 'Пункт 2')).toEqual({ kind: 'changed', point: point() })
  })

  it('409: актуальный пункт из ответа и объяснение с запрошенным и текущим режимом', () => {
    const outcome = interpretModeResponse({ status: 409, body: point({ mode: 'auto', version: 20 }) }, 'manual', 'Пункт 2')
    expect(outcome).toMatchObject({ kind: 'conflict', point: { mode: 'auto', version: 20 } })
    expect((outcome as { message: string }).message).toContain('сейчас «авто»')
    expect((outcome as { message: string }).message).toContain('запрошен «ручной»')
  })

  it('403, 404 и прочие', () => {
    expect(interpretModeResponse({ status: 403, body: { message: 'нет прав' } }, 'manual', 'П')).toEqual({ kind: 'forbidden', message: 'Команда отклонена: нет прав' })
    expect(interpretModeResponse({ status: 404, body: { message: '' } }, 'manual', 'Пункт 9')).toMatchObject({ kind: 'not_found' })
    expect(interpretModeResponse({ status: 400, body: { message: '' } }, 'manual', 'П')).toMatchObject({ kind: 'rejected' })
  })
})

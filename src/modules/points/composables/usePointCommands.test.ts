import type { Point } from '@dispatch/contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpTimeoutError } from '@/shared/http'
import { useNoticeStore } from '@/shared/notices'
import type { AttemptInfo } from '@/shared/utils'
import { setPointMode } from '../api/setPointMode'
import { usePointsStore } from '../store/pointsStore'
import { usePointCommands } from './usePointCommands'

vi.mock('../api/setPointMode', () => ({ setPointMode: vi.fn() }))
const request = vi.mocked(setPointMode)

const point = (patch: Partial<Point> = {}): Point => ({ point_id: 'p-2', name: 'Пункт 2', x_m: 0, y_m: 0, mode: 'auto', version: 14, queue: [], ...patch })
const noSleep = () => Promise.resolve()

function setup(seed: Point = point()) {
  setActivePinia(createPinia())
  const points = usePointsStore()
  points.replacePointsMutator([seed])
  return { points, notices: useNoticeStore(), commands: usePointCommands({ send: { sleep: noSleep } }) }
}

describe('режим пункта', () => {
  beforeEach(() => {
    request.mockReset()
  })

  it('отправляет режим, версию пункта и ключ; до ответа режим прежний', async () => {
    const { points, commands } = setup()
    let finish!: (v: { status: number; body: Point }) => void
    request.mockReturnValueOnce(new Promise((r) => (finish = r)))
    const run = commands.setMode('p-2', 'manual')
    await Promise.resolve()
    expect(commands.isBusy('p-2')).toBe(true)
    expect(points.get('p-2')?.mode).toBe('auto') // без оптимистичного обновления
    finish({ status: 200, body: point({ mode: 'manual', version: 15 }) })
    await run
    expect(points.get('p-2')).toMatchObject({ mode: 'manual', version: 15 })
    const [id, mode, version, info] = request.mock.calls[0] as [string, string, number, AttemptInfo]
    expect([id, mode, version]).toEqual(['p-2', 'manual', 14])
    expect(info.key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('409: актуальный режим из ответа и сообщение', async () => {
    const { points, notices, commands } = setup()
    request.mockResolvedValueOnce({ status: 409, body: point({ mode: 'manual', version: 20 }) })
    await commands.setMode('p-2', 'manual')
    expect(points.get('p-2')).toMatchObject({ mode: 'manual', version: 20 })
    expect(notices.notices[0]).toMatchObject({ kind: 'conflict' })
  })

  it('403: сообщение об отказе, режим не меняется', async () => {
    const { points, notices, commands } = setup()
    request.mockResolvedValueOnce({ status: 403, body: { message: 'наблюдатель' } })
    await commands.setMode('p-2', 'manual')
    expect(points.get('p-2')?.mode).toBe('auto')
    expect(notices.notices[0]).toMatchObject({ kind: 'forbidden' })
  })

  it('таймаут и повтор с тем же ключом: одно применение', async () => {
    const { points, commands } = setup()
    request.mockRejectedValueOnce(new HttpTimeoutError('/x', 2_000)).mockResolvedValueOnce({ status: 200, body: point({ mode: 'manual', version: 15 }) })
    await commands.setMode('p-2', 'manual')
    expect(request).toHaveBeenCalledTimes(2)
    expect((request.mock.calls[1]?.[3] as AttemptInfo).key).toBe((request.mock.calls[0]?.[3] as AttemptInfo).key)
    expect(points.get('p-2')?.mode).toBe('manual')
  })

  it('неизвестный исход после повторов: сообщение, управление возвращается', async () => {
    const { notices, commands } = setup()
    request.mockRejectedValue(new HttpTimeoutError('/x', 2_000))
    await commands.setMode('p-2', 'manual')
    expect(request).toHaveBeenCalledTimes(3)
    expect(notices.notices[0]).toMatchObject({ kind: 'unknown' })
    expect(commands.isBusy('p-2')).toBe(false)
  })

  it('двойное нажатие и запрос текущего режима не отправляют команду повторно', async () => {
    const { commands } = setup()
    await commands.setMode('p-2', 'auto') // режим уже авто
    expect(request).not.toHaveBeenCalled()
    let finish!: (v: { status: number; body: Point }) => void
    request.mockReturnValue(new Promise((r) => (finish = r)))
    const a = commands.setMode('p-2', 'manual')
    const b = commands.setMode('p-2', 'manual')
    finish({ status: 200, body: point({ mode: 'manual', version: 15 }) })
    await Promise.all([a, b])
    expect(request).toHaveBeenCalledTimes(1)
  })
})

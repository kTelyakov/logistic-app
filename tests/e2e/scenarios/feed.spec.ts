// Основные функции экрана: лента решений, очереди, отсчёт, исполнение.
import { expect, test } from '../fixtures'
import { waitForData } from '../helpers/app'
import { expectScreenMatchesServer } from '../helpers/expectScreenMatchesServer'

test.describe('B16: лента решений', () => {
  test.use({ mockEnv: { DECISION_MIN_MS: '700', DECISION_MAX_MS: '1100', EXECUTE_AFTER_MS: '6000' } })

  test('новые сверху, у ожидающих отсчёт, после исполнения отсчёта и кнопки нет', async ({ app, mock }) => {
    test.setTimeout(60_000)
    await waitForData(app)
    await expect.poll(() => app.getByTestId('decision').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(4)

    // Порядок: по времени создания по убыванию
    await mock.pause()
    const server = (await mock.debugState()).decisions as unknown as Array<{ decision_id: string; created_at: string }>
    const expected = [...server].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.decision_id.localeCompare(a.decision_id, 'ru', { numeric: true })).map((d) => d.decision_id)
    await expect.poll(async () => app.locator('[data-testid="decision"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-decision-id'))), { timeout: 10_000 }).toEqual(expected)
    await mock.resume()

    // Отсчёт идёт вниз по времени сервера
    const pending = app.locator('[data-testid="decision"][data-status="pending"]').last()
    const id = (await pending.getAttribute('data-decision-id')) as string
    const decision = app.locator(`[data-testid="decision"][data-decision-id="${id}"]`)
    const seconds = async () => {
      const text = await decision.getByTestId('decision-countdown').innerText().catch(() => null)
      return text ? Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5)) : null
    }
    const first = await seconds()
    if (first !== null && first > 2) {
      await app.waitForTimeout(1_500)
      const second = await seconds()
      expect(second === null || second < first).toBe(true)
    }

    // Исполнение: отсчёт и кнопка исчезают, статус из потока
    await expect(decision).not.toHaveAttribute('data-status', 'pending', { timeout: 15_000 })
    await expect(decision.getByTestId('decision-countdown')).toHaveCount(0)
    await expect(decision.getByTestId('cancel-decision')).toHaveCount(0)
    await expect(decision.getByTestId('decision-status')).toHaveText(/Исполнено|Истекло/)
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
  })
})

test.describe('B17: очереди', () => {
  test('значения очереди совпадают с сервером: экран ничего не считает', async ({ app, mock }) => {
    await waitForData(app, { decisions: false })
    await mock.pause()
    const server = (await mock.debugState()).points
    await expect.poll(() => app.getByTestId('queue-item').count(), { timeout: 10_000 }).toBe(server.reduce((n, p) => n + p.queue.length, 0))
    for (const point of server) {
      const rows = app.locator(`[data-testid="point"][data-point-id="${point.point_id}"] [data-testid="queue-item"]`)
      await expect(rows).toHaveCount(point.queue.length)
      for (let i = 0; i < point.queue.length; i++) {
        const row = rows.nth(i)
        const q = point.queue[i]
        await expect(row).toHaveAttribute('data-vehicle-id', q?.vehicle_id as string)
        await expect(row).toHaveAttribute('data-wait-s', String(q?.wait_s))
        expect(Date.parse((await row.getAttribute('data-eta')) as string)).toBe(Date.parse(q?.eta as string))
        expect(Date.parse((await row.getAttribute('data-service-start')) as string)).toBe(Date.parse(q?.service_start as string))
      }
    }
    await mock.resume()
  })
})

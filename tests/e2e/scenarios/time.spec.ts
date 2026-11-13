// Требования 6 и 7: устаревание и отсчёты по времени сервера, время в поясе площадки.
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { waitForData } from '../helpers/app'
import { expectScreenMatchesServer } from '../helpers/expectScreenMatchesServer'

const HOUR = 3_600_000

/** Щёлкает по машине на схеме и ждёт панель выбранной машины. */
async function selectVehicle(app: Page, id: string): Promise<void> {
  const pos = await app.evaluate((vehicleId) => window.__dispatch?.map()?.vehicleScreenPosition(vehicleId) ?? null, id)
  const box = await app.getByTestId('map-overlay').boundingBox()
  if (!pos || !box) throw new Error(`машины ${id} нет на схеме`)
  await app.mouse.click(box.x + pos[0], box.y + pos[1])
  await expect(app.getByTestId('selected-vehicle')).toHaveAttribute('data-vehicle-id', id)
}

// Каждая пятая машина молчит: её last_seen остаётся на моменте старта сервера
const STALE_ENV = { LOAD: '40', FAULTS: 'stale', STALE_SILENT_MS: '600000', STALE_ACTIVE_MS: '1', DECISION_MIN_MS: '500', DECISION_MAX_MS: '900', EXECUTE_AFTER_MS: '60000' }

for (const offset of [2 * HOUR, -2 * HOUR]) {
  const label = offset > 0 ? 'часы сервера на 2 часа впереди' : 'часы сервера на 2 часа позади'

  test.describe(`B11, B12: ${label}`, () => {
    test.use({ mockEnv: { ...STALE_ENV, CLOCK_OFFSET_MS: String(offset) } })

    test('устаревание и отсчёт идут по времени сервера, а не браузера', async ({ app, mock }) => {
      test.setTimeout(90_000)
      await waitForData(app)
      await expect.poll(() => app.evaluate(() => window.__dispatch?.map()?.renderer?.instances ?? 0), { timeout: 15_000 }).toBeGreaterThanOrEqual(40)

      // Отсчёт: до исполнения не более минуты по часам сервера. По часам браузера было бы ±2 часа
      const countdown = app.getByTestId('decision-countdown').first()
      await expect(countdown).toBeVisible()
      await expect(countdown).toHaveText(/^(00:[0-5]\d|01:00)$/)

      // Первые секунды: молчащая v-01 ещё не устарела (если бы шли часы браузера, при −2 часа она была бы устаревшей сразу)
      await selectVehicle(app, 'v-01')
      await expect(app.getByTestId('selected-last-seen')).toContainText(/\d{2}:\d{2}:\d{2}/)
      await expect(app.getByTestId('selected-stale')).toHaveCount(0)
      const pixelAlpha = () => app.evaluate(() => window.__dispatch?.map()?.pixelAtVehicle('v-01')?.[3] ?? -1)
      expect(await pixelAlpha(), 'на схеме молчащая машина пока яркая').toBeGreaterThanOrEqual(250)

      // После 30 секунд по времени сервера: устарела в панели и на схеме (при +2 часа по часам браузера не устарела бы никогда)
      await expect(app.getByTestId('selected-stale')).toBeVisible({ timeout: 50_000 })
      await expect.poll(pixelAlpha, { timeout: 5_000 }).toBeLessThan(200)

      // Живая машина не устарела
      await selectVehicle(app, 'v-02')
      await expect(app.getByTestId('selected-stale')).toHaveCount(0)
      expect(await app.evaluate(() => window.__dispatch?.map()?.pixelAtVehicle('v-02')?.[3] ?? -1)).toBeGreaterThanOrEqual(250)

      await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
    })
  })
}

test.describe('B13: часовой пояс площадки', () => {
  // Пояс браузера задан в playwright.config.ts: America/Sao_Paulo; площадка в Asia/Krasnoyarsk (UTC+7)
  test.use({ mockEnv: { DECISION_MIN_MS: '300', DECISION_MAX_MS: '600', EXECUTE_AFTER_MS: '120000' } })

  test('время решений, очередей и выбранной машины показано в поясе площадки, не браузера', async ({ app, mock }) => {
    await waitForData(app)
    const browserZone = await app.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(browserZone).toBe('America/Sao_Paulo')

    const inSiteZone = (iso: string, withDate: boolean) =>
      new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Asia/Krasnoyarsk',
        ...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).format(new Date(iso))
    const inBrowserZone = (iso: string) =>
      new Intl.DateTimeFormat('ru-RU', { timeZone: browserZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

    // очередь: приезд и начало обслуживания
    const row = app.getByTestId('queue-item').first()
    const eta = (await row.getAttribute('data-eta')) as string
    const start = (await row.getAttribute('data-service-start')) as string
    const cells = await row.locator('td').allInnerTexts()
    expect(cells[1]).toBe(inSiteZone(eta, false))
    expect(cells[2]).toBe(inSiteZone(start, false))
    expect(cells[1], 'не пояс браузера').not.toBe(inBrowserZone(eta))

    // решение: время создания по данным сервера
    const decision = app.getByTestId('decision').first()
    const id = (await decision.getAttribute('data-decision-id')) as string
    const created = (await mock.debugState()).decisions.find((d) => d.decision_id === id) as unknown as { created_at: string }
    await expect(decision.locator('.decision__time')).toHaveText(inSiteZone(created.created_at, true))

    // выбранная машина: время последних данных
    await selectVehicle(app, 'v-02')
    const lastSeen = (await mock.debugState()).vehicles.find((v) => v.vehicle_id === 'v-02')?.last_seen as string
    const shown = await app.getByTestId('selected-last-seen').innerText()
    // last_seen обновляется раз в секунду: показанное время совпадает с одним из последних значений в поясе площадки
    const hours = (text: string) => text.slice(0, 2)
    expect(hours(shown)).toBe(hours(inSiteZone(lastSeen, false)))
  })
})

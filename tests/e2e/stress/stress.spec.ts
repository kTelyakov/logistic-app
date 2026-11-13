// C1-C3: устойчивость под нагрузкой. Отдельный набор: make e2e-stress.
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { waitForData } from '../helpers/app'
import { expectScreenMatchesServer } from '../helpers/expectScreenMatchesServer'

const instances = (app: Page) => app.evaluate(() => window.__dispatch?.map()?.renderer?.instances ?? 0)

/** Программный WebGL (SwiftShader) на 15 000 машин медленный по построению: цифры FPS там не показатель. */
async function isSoftwareRenderer(app: Page): Promise<boolean> {
  return app.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return /SwiftShader|llvmpipe|Software/i.test(ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'SwiftShader')
  })
}

test.describe('C1: потеря контекста WebGL под нагрузкой', () => {
  test.use({ mockEnv: { LOAD: '3000' } })

  test('3000 машин: контекст потерян и восстановлен без перезагрузки', async ({ app }) => {
    await expect.poll(() => instances(app), { timeout: 40_000 }).toBe(3000)
    expect(await app.evaluate(() => window.__dispatch?.map()?.loseContext())).toBe(true)
    await expect(app.getByTestId('map-context-lost')).toBeVisible({ timeout: 10_000 })
    expect(await app.evaluate(() => window.__dispatch?.map()?.restoreContext())).toBe(true)
    await expect(app.getByTestId('map-context-lost')).toBeHidden({ timeout: 20_000 })
    await expect.poll(() => app.evaluate(() => window.__dispatch?.map()?.renderer?.restores ?? 0), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => instances(app), { timeout: 20_000 }).toBe(3000)
  })
})

test.describe('C2: LOAD=15000', () => {
  test.use({ mockEnv: { LOAD: '15000', DECISION_MIN_MS: '500', DECISION_MAX_MS: '900', EXECUTE_AFTER_MS: '120000' } })

  test('15 000 машин: все на схеме, экран отзывчив, кнопка работает, сверка проходит', async ({ app, mock }) => {
    test.setTimeout(240_000)
    await expect.poll(() => instances(app), { timeout: 90_000 }).toBe(15_000)
    await waitForData(app)

    // Рисуется одним вызовом; подготовка кадра на CPU укладывается в доли кадра
    const cpu = await app.evaluate(() => window.__dispatch?.map()?.renderer?.lastCpuMs ?? 999)
    expect(cpu, `CPU на кадр ${cpu} мс`).toBeLessThan(10)

    // Частота кадров (только на настоящем GPU)
    const software = await isSoftwareRenderer(app)
    const fps = await app.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0
          const t0 = performance.now()
          const tick = (now: number) => {
            frames += 1
            if (now - t0 < 5_000) requestAnimationFrame(tick)
            else resolve((frames * 1000) / (now - t0))
          }
          requestAnimationFrame(tick)
        }),
    )
    test.info().annotations.push({ type: 'fps', description: `${fps.toFixed(1)} кадров/с (${software ? 'программный WebGL' : 'GPU'})` })
    if (!software) expect(fps).toBeGreaterThanOrEqual(30)

    // Отзывчивость: команда доходит до статуса на экране за разумное время
    const id = (await app.locator('[data-testid="decision"][data-status="pending"]').first().getAttribute('data-decision-id')) as string
    const decision = app.locator(`[data-testid="decision"][data-decision-id="${id}"]`)
    const started = Date.now()
    await decision.getByTestId('cancel-decision').click()
    await expect(decision).toHaveAttribute('data-status', 'cancelled', { timeout: 15_000 })
    test.info().annotations.push({ type: 'cancel', description: `отмена до статуса на экране: ${Date.now() - started} мс` })

    await expectScreenMatchesServer(app, mock, { timeoutMs: 60_000 })
  })
})

test.describe('C3: фоновая вкладка', () => {
  test.use({ mockEnv: { LOAD: '2000', DECISION_MIN_MS: '500', DECISION_MAX_MS: '900', EXECUTE_AFTER_MS: '8000' } })

  test('вкладка ушла в фон на 15 секунд и вернулась: данные догнались и совпадают с сервером', async ({ app, context, mock }) => {
    test.setTimeout(120_000)
    await expect.poll(() => instances(app), { timeout: 40_000 }).toBe(2000)
    await waitForData(app)

    const other = await context.newPage()
    await other.goto('about:blank')
    await other.bringToFront()
    await other.waitForTimeout(15_000)
    await app.bringToFront()

    await expect(app.getByTestId('connection')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 })
    await expectScreenMatchesServer(app, mock, { timeoutMs: 40_000 })
    expect(await instances(app)).toBe(2000)
    await other.close()
  })
})

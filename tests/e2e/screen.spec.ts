// Настоящий экран на заглушке: данные доходят, сверка с /debug/state проходит, внешних запросов нет.
// Сценарии по требованиям задания (отказы, команды, роли) лежат в tests/e2e/scenarios.
import type { MockEnv } from './fixtures/mockProcess'
import { expect, test } from './fixtures'
import { compareOnce, expectScreenMatchesServer } from './helpers/expectScreenMatchesServer'
import { readScreen } from './helpers/state'

const FAST_DECISIONS: MockEnv = { DECISION_MIN_MS: '200', DECISION_MAX_MS: '400', EXECUTE_AFTER_MS: '4000' }

async function waitForData(app: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(async () => {
      const screen = await readScreen(app)
      return screen.vehicles.length > 0 && screen.points.length > 0 && screen.decisions.length > 0
    }, { timeout: 15_000 })
    .toBe(true)
}

test.describe('без отказов', () => {
  test.use({ mockEnv: FAST_DECISIONS })

  test('экран показывает данные сервера и совпадает с /debug/state', async ({ app, mock }) => {
    await waitForData(app)
    await expect(app.getByTestId('connection')).toHaveAttribute('data-state', 'connected')
    await expect(app.getByTestId('site-name')).toHaveText('Площадка 3')
    await expect(app.getByTestId('role')).toHaveText('диспетчер')
    await expectScreenMatchesServer(app, mock)
    await app.waitForTimeout(2_000)
    await expectScreenMatchesServer(app, mock)
  })

  test('в DOM есть пункты, очереди и решения по контракту', async ({ app }) => {
    await waitForData(app)
    expect(await app.getByTestId('point').count()).toBe(6)
    expect(await app.getByTestId('queue-item').count()).toBeGreaterThan(0)
    const decision = app.getByTestId('decision').first()
    await expect(decision).toHaveAttribute('data-decision-id', /^d-\d+$/)
    await expect(decision).toHaveAttribute('data-status', /^(pending|executed|cancelled|expired)$/)
  })
})

test.describe('FAULTS=drop,dup,reorder', () => {
  test.use({ mockEnv: { ...FAST_DECISIONS, FAULTS: 'drop,dup,reorder', FAULT_RATE: '0.03', FAULT_SEED: '5' } })

  test('экран догоняет сервер через повторные снимки и совпадает с /debug/state', async ({ app, mock }) => {
    await waitForData(app)
    await app.waitForTimeout(5_000)
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
    expect((await compareOnce(app, mock)).length).toBe(0)
  })
})

test.describe('время и текст', () => {
  test.use({ mockEnv: FAST_DECISIONS })

  test('время показано в поясе площадки, хотя пояс браузера Сан-Паулу', async ({ app }) => {
    await waitForData(app)
    const createdAt = await app.getByTestId('decision').first().locator('.decision__time').innerText()
    const iso = await app.evaluate(() => document.querySelector('[data-testid="queue-item"]')?.getAttribute('data-eta') ?? '')
    const browserZone = await app.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(browserZone).toBe('America/Sao_Paulo')
    // Красноярск UTC+7: час в тексте строки очереди должен быть часом по Красноярску
    const expected = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Krasnoyarsk', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
    const first = await app.getByTestId('queue-item').first().locator('td').nth(1).innerText()
    expect(first).toBe(expected)
    expect(createdAt).toMatch(/^\d{2}\.\d{2}, \d{2}:\d{2}:\d{2}$/)
  })

  test('reason с разметкой выводится как текст', async ({ app }) => {
    await expect
      .poll(async () => app.getByTestId('decision-reason').filter({ hasText: '<img src=x onerror=alert(1)>' }).count(), { timeout: 20_000 })
      .toBeGreaterThan(0)
    expect(await app.locator('[data-testid="decision-reason"] img, [data-testid="decision-reason"] script').count()).toBe(0)
  })
})

// Требования 3-5: команда выполняется на сервере один раз, конфликт показывает актуальное состояние, роль наблюдателя.
import type { Page, Request } from '@playwright/test'
import type { MockEnv } from '../fixtures/mockProcess'
import { expect, test } from '../fixtures'
import { waitForData } from '../helpers/app'
import { expectScreenMatchesServer } from '../helpers/expectScreenMatchesServer'

/** Решения создаются быстро и долго остаются ожидающими. */
const PENDING_LONG: MockEnv = { DECISION_MIN_MS: '300', DECISION_MAX_MS: '600', EXECUTE_AFTER_MS: '120000' }

const pendingDecision = (app: Page) => app.locator('[data-testid="decision"][data-status="pending"]').first()
/** Решение по id: новые решения появляются сверху, поэтому «первое ожидающее» плавает. */
const decisionById = (app: Page, id: string) => app.locator(`[data-testid="decision"][data-decision-id="${id}"]`)

interface CommandRequest {
  url: string
  key: string | undefined
  ifMatch: string | undefined
}

function recordCommands(app: Page, pattern: RegExp): CommandRequest[] {
  const seen: CommandRequest[] = []
  app.on('request', (r: Request) => {
    if (r.method() === 'POST' && pattern.test(r.url())) seen.push({ url: r.url(), key: r.headers()['idempotency-key'], ifMatch: r.headers()['if-match'] })
  })
  return seen
}

test.describe('B4, B5: FAULTS=slow', () => {
  test.use({ mockEnv: { ...PENDING_LONG, FAULTS: 'slow' } })

  test('B4: отмена с таймаутом и повтором: один ключ, на сервере одно выполнение', async ({ app, mock }) => {
    test.setTimeout(60_000)
    await waitForData(app)
    const posts = recordCommands(app, /\/cancel$/)
    const id = (await pendingDecision(app).getAttribute('data-decision-id')) as string
    const decision = decisionById(app, id)

    const button = decision.getByTestId('cancel-decision')
    await button.click()
    // Инвариант: пока решение ещё ожидает, команда в пути и кнопка занята. Если сервер выполнил команду до задержки ответа
    // (ключ попал в такую половину), статус `cancelled` приходит по потоку раньше ответа, и кнопка уже снята
    for (let i = 0; i < 10; i++) {
      const status = await decision.getAttribute('data-status')
      if (status !== 'pending') break
      await expect(button).toBeDisabled()
      await app.waitForTimeout(120)
    }

    // Ответ придёт только после повтора с бóльшим таймаутом (задержка сервера 3 с, первая попытка 2 с)
    await expect(app.locator(`[data-decision-id="${id}"]`)).toHaveAttribute('data-status', 'cancelled', { timeout: 30_000 })

    // Повтор по таймауту случается через 2 с независимо от того, пришёл ли статус по потоку раньше ответа
    await expect.poll(() => posts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    expect(new Set(posts.map((p) => p.key)).size, 'все попытки с одним Idempotency-Key').toBe(1)
    expect(posts[0]?.key).toBeTruthy()

    // Сервер обработал повтор как повтор: вернул сохранённый ответ, а не выполнил команду второй раз
    await expect
      .poll(async () => (await mock.debugState()).commands[posts[0]?.key as string]?.replays, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    const state = await mock.debugState()
    const record = state.commands[posts[0]?.key as string]
    expect(record, 'команда известна серверу').toBeDefined()
    expect(record).toMatchObject({ command: 'cancel_decision', target: id, executions: 1 })
    expect(state.decisions.find((d) => d.decision_id === id)?.status).toBe('cancelled')
    expect(Object.values(state.commands).filter((c) => c.target === id).reduce((n, c) => n + c.executions, 0), 'всего одно выполнение').toBe(1)
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
  })

  test('B5: двойное нажатие отправляет команду один раз', async ({ app, mock }) => {
    test.setTimeout(60_000)
    await waitForData(app)
    const posts = recordCommands(app, /\/cancel$/)
    const id = (await pendingDecision(app).getAttribute('data-decision-id')) as string
    const decision = decisionById(app, id)

    await decision.getByTestId('cancel-decision').dblclick()
    await app.waitForTimeout(1_200) // до первого повтора по таймауту (2 с)
    expect(posts.length, 'за первую секунду ушёл один запрос').toBe(1)

    await expect(app.locator(`[data-decision-id="${id}"]`)).toHaveAttribute('data-status', 'cancelled', { timeout: 30_000 })
    const executions = Object.values((await mock.debugState()).commands).filter((c) => c.target === id).reduce((n, c) => n + c.executions, 0)
    expect(executions).toBe(1)
  })
})

test.describe('B6, B7: конфликты 409', () => {
  test.use({ mockEnv: { DECISION_MIN_MS: '300', DECISION_MAX_MS: '600', EXECUTE_AFTER_MS: '3000' } })

  test('B6: отмена решения, которое сервер уже исполнил: сообщение и статус из ответа', async ({ app, mock }) => {
    test.setTimeout(60_000)
    await waitForData(app)
    const id = (await pendingDecision(app).getAttribute('data-decision-id')) as string
    const decision = decisionById(app, id)
    await mock.mute() // экран перестаёт узнавать об изменениях

    // Сервер исполняет (или признаёт истёкшим) решение; экран продолжает показывать «ожидает»
    await expect
      .poll(async () => (await mock.debugState()).decisions.find((d) => d.decision_id === id)?.status, { timeout: 15_000 })
      .not.toBe('pending')
    const serverStatus = (await mock.debugState()).decisions.find((d) => d.decision_id === id)?.status as string
    await expect(app.locator(`[data-decision-id="${id}"]`)).toHaveAttribute('data-status', 'pending')

    await decision.getByTestId('cancel-decision').click()

    const notice = app.getByTestId('notice').filter({ hasText: /исполнено|истёк/ })
    await expect(notice).toBeVisible({ timeout: 10_000 })
    await expect(notice).toHaveAttribute('data-kind', 'conflict')
    // На экране актуальное состояние из ответа 409, хотя поток молчит
    await expect(app.locator(`[data-decision-id="${id}"]`)).toHaveAttribute('data-status', serverStatus)
    expect(['executed', 'expired']).toContain(serverStatus)
    const records = Object.values((await mock.debugState()).commands).filter((c) => c.target === id)
    expect(records[0]).toMatchObject({ status: 409, executions: 0 })

    await mock.unmute()
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
  })

  test('B7: переключение режима при устаревшей версии: сообщение и актуальный пункт из ответа', async ({ app, mock }) => {
    test.setTimeout(60_000)
    await waitForData(app)
    const point = app.locator('[data-testid="point"][data-point-id="p-1"]')
    await expect(point).toHaveAttribute('data-mode', 'auto')

    // Пока экран «глух», пункт на сервере переведён в ручной режим другим диспетчером
    await mock.mute()
    const current = (await mock.debugState()).points.find((p) => p.point_id === 'p-1')
    const other = await fetch(`${mock.url}/api/points/p-1/mode`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'other-dispatcher', 'If-Match': String(current?.version), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual' }),
    })
    expect(other.status).toBe(200)
    await expect(point).toHaveAttribute('data-mode', 'auto') // экран ещё не знает

    // Диспетчер жмёт «Ручной» по устаревшей версии: сервер отвечает 409 с актуальным пунктом
    await point.getByTestId('mode-manual').click()
    const notice = app.getByTestId('notice').filter({ hasText: /Пункт 1/ })
    await expect(notice).toBeVisible({ timeout: 10_000 })
    await expect(notice).toHaveAttribute('data-kind', 'conflict')
    await expect(notice).toContainText('режим уже «ручной»')
    await expect(point).toHaveAttribute('data-mode', 'manual') // состояние из ответа, поток молчит

    await mock.unmute()
    await expect(app.getByTestId('connection')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 })
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })

    // После конфликта команду можно выполнить с актуальной версией
    await point.getByTestId('mode-auto').click()
    await expect(point).toHaveAttribute('data-mode', 'auto', { timeout: 10_000 })
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
  })
})

test.describe('B9, B10: ROLE=observer', () => {
  test.use({ mockEnv: { ...PENDING_LONG, ROLE: 'observer' } })

  test('B9: кнопок действий нет ни в ленте, ни в очередях', async ({ app }) => {
    await waitForData(app)
    await expect(app.getByTestId('role')).toHaveText('наблюдатель')
    expect(await app.getByTestId('decision').count()).toBeGreaterThan(0)
    expect(await app.getByTestId('cancel-decision').count()).toBe(0)
    expect(await app.getByTestId('mode-auto').count()).toBe(0)
    expect(await app.getByTestId('mode-manual').count()).toBe(0)
  })

  test('B10: команда в обход интерфейса получает 403 с сообщением, состояние не меняется', async ({ app, mock }) => {
    await waitForData(app)
    const id = (await pendingDecision(app).getAttribute('data-decision-id')) as string
    const result = await app.evaluate(async ({ api, decisionId }) => {
      const res = await fetch(`${api}/api/decisions/${decisionId}/cancel`, { method: 'POST', headers: { 'Idempotency-Key': 'bypass-1', 'If-Match': '1' } })
      return { status: res.status, body: (await res.json()) as { message: string } }
    }, { api: mock.url, decisionId: id })
    expect(result.status).toBe(403)
    expect(result.body.message).toMatch(/наблюдател/)
    expect((await mock.debugState()).decisions.find((d) => d.decision_id === id)?.status).toBe('pending')
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
  })

  test('B10: если экран всё же показал кнопки, ответ 403 обработан сообщением об отказе', async ({ page, mock, appOrigin, externalGuard }) => {
    void externalGuard
    // Экран получает роль диспетчера, а сервер считает пользователя наблюдателем
    await page.route('**/api/me', async (route) => {
      const response = await route.fetch()
      const me = (await response.json()) as Record<string, unknown>
      await route.fulfill({ response, json: { ...me, role: 'dispatcher' } })
    })
    await page.goto(`${appOrigin}/?api=${encodeURIComponent(mock.url)}`)
    await waitForData(page)
    await expect(page.getByTestId('role')).toHaveText('диспетчер')
    const id = (await pendingDecision(page).getAttribute('data-decision-id')) as string
    const decision = decisionById(page, id)

    await decision.getByTestId('cancel-decision').click()
    const notice = page.getByTestId('notice').filter({ hasText: /Команда отклонена/ })
    await expect(notice).toBeVisible({ timeout: 10_000 })
    await expect(notice).toHaveAttribute('data-kind', 'forbidden')
    await expect(page.locator(`[data-decision-id="${id}"]`)).toHaveAttribute('data-status', 'pending')
    expect((await mock.debugState()).decisions.find((d) => d.decision_id === id)?.status).toBe('pending')
    // кнопка снова доступна: управление возвращено
    await expect(decision.getByTestId('cancel-decision')).toBeEnabled()
  })
})

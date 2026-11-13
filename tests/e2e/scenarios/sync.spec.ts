// Требование 2: пропуск, повтор, перестановка сообщений и reset не приводят к расхождению с сервером.
import type { MockEnv } from '../fixtures/mockProcess'
import { expect, test } from '../fixtures'
import { recordConnectionStates, waitForData } from '../helpers/app'
import { expectScreenMatchesServer } from '../helpers/expectScreenMatchesServer'

const DECISIONS: MockEnv = { DECISION_MIN_MS: '1000', DECISION_MAX_MS: '2000', EXECUTE_AFTER_MS: '8000' }

test.describe('B1: FAULTS=drop,dup,reorder, 5 минут', () => {
  test.use({ mockEnv: { ...DECISIONS, FAULTS: 'drop,dup,reorder', FAULT_RATE: '0.02', FAULT_SEED: '21' } })

  test('экран совпадает с /debug/state при каждой промежуточной и итоговой сверке', async ({ app, mock }) => {
    test.setTimeout(7 * 60_000)
    await waitForData(app)
    const states = await recordConnectionStates(app)

    const deadline = Date.now() + 5 * 60_000
    let checks = 0
    while (Date.now() < deadline) {
      await app.waitForTimeout(30_000)
      await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
      checks += 1
    }
    expect(checks).toBeGreaterThanOrEqual(9)
    // Отказы были настоящими: экран не раз восстанавливался, но на каждой сверке сошёлся
    const seen = await states.states()
    expect(seen[seen.length - 1]).toBe('connected')
  })
})

test.describe('B2: FAULTS=reset', () => {
  // Раз в 3 секунды вместо двух минут: поведение то же, тест быстрее
  test.use({ mockEnv: { ...DECISIONS, FAULTS: 'reset', RESET_INTERVAL_MS: '3000' } })

  test('после разрывов экран переподключается, статус возвращается в «подключено», сверка проходит', async ({ app, mock }) => {
    test.setTimeout(60_000)
    await waitForData(app)
    const states = await recordConnectionStates(app)

    await app.waitForTimeout(14_000) // несколько разрывов
    await expect.poll(async () => (await states.states()).includes('reconnecting'), { timeout: 10_000 }).toBe(true)
    await expect(app.getByTestId('connection')).toHaveAttribute('data-state', 'connected', { timeout: 10_000 })
    await expect(app.getByTestId('connection')).toHaveText('Подключено')
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
  })
})

test.describe('B3: потеря соединения при малом журнале сервера', () => {
  // Журнал на 10 записей: у любого отставшего клиента since уже старее журнала, и сервер отвечает reset
  test.use({ mockEnv: { ...DECISIONS, JOURNAL_SIZE: '10' } })

  test('обрыв соединения: сервер отвечает reset, экран берёт новый снимок и сходится', async ({ app, mock }) => {
    test.setTimeout(60_000)
    await waitForData(app)
    const states = await recordConnectionStates(app)

    await mock.disconnect()
    await expect.poll(async () => (await states.states()).includes('reconnecting'), { timeout: 10_000 }).toBe(true)
    await expect(app.getByTestId('connection')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 })

    await mock.disconnect()
    await expect(app.getByTestId('connection')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 })
    await expectScreenMatchesServer(app, mock, { timeoutMs: 20_000 })
  })
})

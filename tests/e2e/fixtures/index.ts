import { fileURLToPath } from 'node:url'
import { test as base, expect, type Page } from '@playwright/test'
import { blockExternal, type ExternalGuard } from '../helpers/blockExternal'
import { startMockProcess, type MockEnv, type RunningMock } from './mockProcess'
import { startStaticPage } from './staticServer'

const REFERENCE_SCREEN = fileURLToPath(new URL('../reference-screen/index.html', import.meta.url))

/** Адрес собранного экрана: его поднимает webServer из playwright.config.ts. */
const SCREEN_ORIGIN = 'http://127.0.0.1:5199'

interface Fixtures {
  /** Какой экран открывать: настоящий (по умолчанию) или эталонный (проверка самой основы e2e). */
  appKind: 'real' | 'reference'
  /** Окружение заглушки для теста: `test.use({ mockEnv: { FAULTS: 'slow' } })`. */
  mockEnv: MockEnv
  /** Свежая заглушка на свободном порту, останавливается после теста. */
  mock: RunningMock
  /** Адрес, с которого отдаётся экран. */
  appOrigin: string
  /** Защита от запросов вне приложения и заглушки; проверяется в конце теста. */
  externalGuard: ExternalGuard
  /** Тест намеренно обращается вовне (проверка самой защиты). */
  allowExternal: boolean
  /** Страница с открытым экраном. */
  app: Page
}

export const test = base.extend<Fixtures>({
  appKind: ['real', { option: true }],
  mockEnv: [{}, { option: true }],
  allowExternal: [false, { option: true }],

  mock: async ({ mockEnv }, use) => {
    const mock = await startMockProcess(mockEnv)
    try {
      await use(mock)
    } finally {
      await mock.stop()
    }
  },

  appOrigin: async ({ appKind }, use) => {
    if (appKind === 'real') {
      await use(SCREEN_ORIGIN)
      return
    }
    const server = await startStaticPage(REFERENCE_SCREEN)
    try {
      await use(server.origin)
    } finally {
      await server.stop()
    }
  },

  externalGuard: [
    async ({ context, mock, appOrigin, allowExternal }, use) => {
      const guard = await blockExternal(context, [appOrigin, mock.url])
      await use(guard)
      if (!allowExternal) guard.assertNone()
    },
    { auto: true },
  ],

  app: async ({ page, mock, appOrigin, externalGuard }, use) => {
    void externalGuard
    await page.goto(`${appOrigin}/?api=${encodeURIComponent(mock.url)}`)
    await use(page)
  },
})

export { expect }

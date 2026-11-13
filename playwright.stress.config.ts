import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Набор устойчивости: тяжёлые сценарии (много машин, фоновая вкладка). Запускается отдельно: `make e2e-stress`.
 * Для честных цифр отрисовки нужен настоящий GPU: E2E_CHANNEL=chrome make e2e-stress.
 */
export default defineConfig({
  ...base,
  testDir: 'tests/e2e/stress',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
})

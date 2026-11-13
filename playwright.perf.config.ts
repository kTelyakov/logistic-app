import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * `make perf`: прогон на нагрузке с замером долгих задач, кадров и памяти. Для точных цифр памяти включён
 * `--enable-precise-memory-info`. Длительность: PERF_MINUTES (по умолчанию 10).
 */
export default defineConfig({
  ...base,
  testDir: 'tests/perf',
  testMatch: '**/*.spec.ts',
  timeout: 30 * 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    ...base.use,
    trace: 'off',
    launchOptions: { args: [...(base.use?.launchOptions?.args ?? []), '--enable-precise-memory-info'] },
  },
})

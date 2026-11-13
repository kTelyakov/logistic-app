import { defineConfig } from '@playwright/test'

/**
 * E2E_CHANNEL=chrome запускает установленный Google Chrome (настоящий GPU для WebGL).
 * По умолчанию используется Chromium из Playwright (WebGL работает программно).
 */
const channel = process.env.E2E_CHANNEL

/** Адрес собранного экрана для e2e. */
export const SCREEN_PORT = 5199

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  // Экран собирается и отдаётся как в боевой сборке: заодно проверяется, что все ресурсы лежат в ней
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${SCREEN_PORT} --strictPort`,
    url: `http://127.0.0.1:${SCREEN_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    ...(channel ? { channel } : {}),
    trace: 'retain-on-failure',
    // Заглушка сама ходит на 127.0.0.1; время браузера сознательно отличается от пояса площадки
    timezoneId: 'America/Sao_Paulo',
    launchOptions: {
      args: ['--use-angle=default', '--ignore-gpu-blocklist'],
    },
  },
})

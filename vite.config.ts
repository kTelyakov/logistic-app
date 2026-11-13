import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// В разработке Vite проксирует API на заглушку (`make mock`): экран открывается без параметров.
const MOCK_URL = process.env.MOCK_URL ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  server: {
    proxy: {
      '/api': MOCK_URL,
      '/debug': MOCK_URL,
      '/ws': { target: MOCK_URL, ws: true },
    },
  },
  test: {
    include: ['mock/src/**/*.test.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**/*.spec.ts'],
    environment: 'node',
    // Тесты компонентов выбирают окружение комментарием `// @vitest-environment happy-dom`
    testTimeout: 15_000,
  },
})

import js from '@eslint/js'
import globals from 'globals'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import dispatch from './tools/lint/dispatch-plugin.mjs'

/**
 * Все правила уровня error: нарушение это ошибка, а не предупреждение.
 * Архитектурные правила 1-4 (AGENTS.md) реализованы локальным плагином tools/lint.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'blob-report/**',
      'openspec/**', '.agents/**', '.claude/**', 'perf/**',
      // Фикстуры с нарушениями нужны тестам линтера и не проверяются сами
      'tools/lint/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] } },
  },
  {
    // Неопределённые имена ловит tsc: для TS и Vue проверка ESLint только создаёт шум
    files: ['**/*.ts', '**/*.vue'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      // Текст от сервера выводится только как текст
      'vue/no-v-html': 'error',
      // Односложные имена у нас только App.vue
      'vue/multi-word-component-names': ['error', { ignores: ['App'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    plugins: { dispatch },
    rules: {
      'dispatch/module-boundaries': 'error',
      'dispatch/component-purity': 'error',
      'dispatch/http-and-layers': 'error',
      'dispatch/store-rules': 'error',
    },
  },
  {
    // Тестам и инструментам нужны произвольные приёмы
    files: ['**/*.test.ts', 'tests/**', 'tools/**', 'mock/**', '*.config.*'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
)

# Proposal

## Why

Тестовое задание (Frontend.md) требует единый набор команд `make mock/dev/check/test/e2e/perf` и обязательные `AGENTS.md` и `PLAN.md`. Агент, который будет писать код, должен с первого дня работать по зафиксированным правилам, иначе структура и границы модулей разъедутся. Без каркаса остальные changes не на что опирать.

## What Changes

- Каркас монорепозитория: npm workspaces (`contract`, `mock`, корень с фронтендом), общий `tsconfig.base.json`, `.gitignore`, `.editorconfig`.
- Скелет фронтенда: Vite + Vue 3 + TypeScript + Pinia, пустой `App.vue`, каталоги `src/modules/`, `src/shared/`.
- `Makefile` со всеми целями из задания; цели, чьи реализации появятся в следующих changes, пока явно завершаются ошибкой «не реализовано», а не успехом.
- `AGENTS.md`: правила кода (1-4 из задания) со ссылками на проверки, команды, запреты (RxJS, WebAssembly, zod, `v-html`, FSD, правка `contract/` вне отдельного change, оптимистичные обновления, расчёт показателей на клиенте).
- Черновик `PLAN.md` (структура разделов 1-6 из задания; наполнение в `final-docs`).

## Capabilities

### New Capabilities
<!-- Нет: change про инструментарий и документы, поведение системы не меняется (skip_specs). -->

### Modified Capabilities
<!-- Нет. -->

## Impact

- Новые файлы в корне репозитория: `package.json`, `Makefile`, `AGENTS.md`, `PLAN.md`, конфиги TypeScript и Vite.
- Зависимости: vue, pinia, vite, typescript, vue-tsc (остальное добавят следующие changes).

## Non-Goals

- Реализация `make check` (правила 1-3), тестов и perf: отдельные changes (`code-rules-check`, `tests-unit-e2e`, `perf`).
- Контракт и заглушка: `shared-contract`, `mock-server`.
- Финальное содержание `README.md`, `DESIGN.md`, `PLAN.md`: `final-docs`.

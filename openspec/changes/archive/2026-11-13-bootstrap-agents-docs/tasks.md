# Tasks

## 1. Каркас репозитория

- [x] 1.1 Создать корневой `package.json` с workspaces `contract`, `mock`, `.gitignore`, `.editorconfig`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`). Проверка: `npm install` проходит без ошибок.
- [x] 1.2 Создать скелет фронтенда: Vite + Vue 3 + TS + Pinia, `src/main.ts`, `src/App.vue`, пустые `src/modules/` и `src/shared/`. Проверка: `npm run dev` открывает пустую страницу, `npx vue-tsc --noEmit` проходит.

## 2. Makefile

- [x] 2.1 Написать `Makefile` с целями `mock`, `dev`, `check`, `test`, `e2e`, `perf`; `dev` и (пока) `check` через `vue-tsc` работают, остальные завершаются с кодом 1 и сообщением «не реализовано: <change>». Проверка: `make dev` стартует, `make e2e; echo $?` даёт ненулевой код.

## 3. Документы для агента

- [x] 3.1 Написать `AGENTS.md`: структура модулей, правила 1-4 со ссылками на проверки, команды, запреты (RxJS, WebAssembly, zod, `v-html`, FSD, правка `contract/` вне отдельного change, оптимистичные обновления, расчёт показателей на клиенте, машины в Pinia), порядок работы через OpenSpec. Проверка: каждое правило из задания (часть 3) присутствует, перекрёстная сверка с `Frontend.md`.
- [x] 3.2 Создать черновик `PLAN.md` со структурой разделов 1-6 из задания и пометкой «наполнить в final-docs». Проверка: файл существует, разделы совпадают с заданием.

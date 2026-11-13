// Каждое правило 1–4 из задания: нарушение, которое обязан поймать `make check`, и допустимый код.
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

let eslint: ESLint
beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() })
})

/** Проверяет текст как файл по виртуальному пути внутри проекта (файла на диске может не быть). */
async function lint(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result?.messages ?? []
}

const dispatchMessages = async (code: string, filePath: string) => (await lint(code, filePath)).filter((m) => m.ruleId?.startsWith('dispatch/'))
const errorsFor = async (code: string, filePath: string, rule: string) => (await dispatchMessages(code, filePath)).filter((m) => m.ruleId === `dispatch/${rule}`)

async function expectViolation(code: string, filePath: string, rule: string, number: number) {
  const found = await errorsFor(code, filePath, rule)
  expect(found.length, `ожидалось нарушение dispatch/${rule} в ${filePath}`).toBeGreaterThan(0)
  expect(found[0]?.severity, 'нарушение должно быть ошибкой, а не предупреждением').toBe(2)
  expect(found[0]?.message).toContain(`Правило ${number}`)
}

async function expectClean(code: string, filePath: string) {
  const found = await dispatchMessages(code, filePath)
  expect(found.map((m) => `${m.ruleId}: ${m.message}`)).toEqual([])
}

describe('правило 1: границы модулей', () => {
  const FILE = 'src/modules/points/helpers/example.ts'

  it('глубокий импорт из чужого модуля через @/', async () => {
    await expectViolation("import { useDecisionsStore } from '@/modules/decisions/store/decisionsStore'\nexport const x = useDecisionsStore", FILE, 'module-boundaries', 1)
  })

  it('глубокий импорт из чужого модуля относительным путём', async () => {
    await expectViolation("import { x } from '../../decisions/helpers/window'\nexport const y = x", FILE, 'module-boundaries', 1)
  })

  it('реэкспорт и динамический import из чужого модуля', async () => {
    await expectViolation("export { x } from '@/modules/decisions/helpers/window'", FILE, 'module-boundaries', 1)
    await expectViolation("export const load = () => import('@/modules/decisions/helpers/window')", FILE, 'module-boundaries', 1)
  })

  it('import type тоже подчиняется границам', async () => {
    await expectViolation("import type { Y } from '@/modules/decisions/store/decisionsStore'\nexport type Z = Y", FILE, 'module-boundaries', 1)
  })

  it('src/shared не знает о модулях и приложении', async () => {
    await expectViolation("import { fetchMe } from '@/modules/session'\nexport const a = fetchMe", 'src/shared/utils/example.ts', 'module-boundaries', 1)
    await expectViolation("import { x } from '@/app/apiBase'\nexport const a = x", 'src/shared/utils/example.ts', 'module-boundaries', 1)
  })

  it('модуль не знает о src/app', async () => {
    await expectViolation("import { resolveApiBase } from '@/app/apiBase'\nexport const a = resolveApiBase", FILE, 'module-boundaries', 1)
  })

  it('допустимо: через index.ts, свои файлы, приложение к модулям', async () => {
    await expectClean("import { fetchMe } from '@/modules/session'\nexport const a = fetchMe", FILE)
    await expectClean("import { fetchMe } from '@/modules/session/index'\nexport const a = fetchMe", FILE)
    await expectClean("import { fetchMe } from '../../session'\nexport const a = fetchMe", FILE)
    await expectClean("import { sortPoints } from './sortPoints'\nexport const a = sortPoints", FILE)
    await expectClean("import { s } from '@/modules/points/helpers/sortPoints'\nexport const a = s", FILE)
    await expectClean("import { useSessionStore } from '@/modules/session'\nexport const a = useSessionStore", 'src/app/example.ts')
  })

  it('сообщение называет модуль и подсказывает исправление', async () => {
    const [m] = await errorsFor("import { a } from '@/modules/decisions/store/decisionsStore'\nexport const x = a", FILE, 'module-boundaries')
    expect(m?.message).toContain('decisions')
    expect(m?.message).toContain('index.ts')
  })
})

describe('правило 2: компонент не делает запросов и не меняет store', () => {
  const COMPONENT = 'src/modules/points/components/Example.vue'
  const wrap = (script: string) => `<script setup lang="ts">\n${script}\n</script>\n<template><div /></template>\n`

  it('fetch в компоненте', async () => {
    await expectViolation(wrap("const load = () => fetch('/api/me')\nvoid load"), COMPONENT, 'component-purity', 2)
  })

  it('импорт слоя api', async () => {
    await expectViolation(wrap("import { setPointMode } from '../api/setPointMode'\nvoid setPointMode"), COMPONENT, 'component-purity', 2)
  })

  it('импорт общего HTTP-клиента', async () => {
    await expectViolation(wrap("import { http } from '@/shared/http'\nvoid http"), COMPONENT, 'component-purity', 2)
  })

  it('импорт store и использование useXStore', async () => {
    await expectViolation(wrap("import { usePointsStore } from '../store/pointsStore'\nvoid usePointsStore"), COMPONENT, 'component-purity', 2)
    await expectViolation(wrap("import { usePointsStore } from '@/modules/points'\nvoid usePointsStore"), COMPONENT, 'component-purity', 2)
    await expectViolation(wrap("import { defineStore } from 'pinia'\nvoid defineStore"), COMPONENT, 'component-purity', 2)
  })

  it('вызов мутатора store', async () => {
    await expectViolation(wrap("declare const store: { replacePointsMutator(a: unknown): void }\nstore.replacePointsMutator([])"), COMPONENT, 'component-purity', 2)
    await expectViolation(wrap("declare function replacePointsMutator(a: unknown): void\nreplacePointsMutator([])"), COMPONENT, 'component-purity', 2)
  })

  it('открытие сети в компоненте', async () => {
    await expectViolation(wrap("const s = new WebSocket('ws://x')\nvoid s"), COMPONENT, 'component-purity', 2)
  })

  it('компонент вне модулей (src/app, src/shared) подчиняется тому же правилу', async () => {
    await expectViolation(wrap("const load = () => fetch('/x')\nvoid load"), 'src/shared/notices/Example.vue', 'component-purity', 2)
  })

  it('допустимо: компонент получает props, сообщает через emit, импортирует только типы', async () => {
    await expectClean(
      wrap("import type { Point } from '@dispatch/contract'\nimport type { Notice } from '../store/noticeStore'\ndefineProps<{ point: Point; notices: Notice[] }>()\nconst emit = defineEmits<{ change: [id: string] }>()\nemit('change', 'x')"),
      COMPONENT,
    )
  })

  it('допустимо: контейнер вызывает слой api и работает со store (в сеть сам не ходит)', async () => {
    await expectClean(
      wrap("import { setPointMode } from './api/setPointMode'\nimport { usePointsStore } from './store/pointsStore'\nconst store = usePointsStore()\nstore.applyServerPointMutator({} as never)\nvoid setPointMode"),
      'src/modules/points/PointsContainer.vue',
    )
  })
})

describe('правило 3: HTTP только в слое api через общий клиент', () => {
  it('fetch вне общего клиента, в том числе в слое api', async () => {
    await expectViolation("export const load = () => fetch('/api/me')", 'src/modules/points/helpers/example.ts', 'http-and-layers', 3)
    await expectViolation("export const load = () => fetch('/api/me')", 'src/modules/points/api/example.ts', 'http-and-layers', 3)
    await expectViolation("export const load = () => fetch('/api/me')", 'src/modules/points/PointsContainer.vue'.replace('.vue', '.ts'), 'http-and-layers', 3)
  })

  it('fetch в контейнере (.vue)', async () => {
    await expectViolation('<script setup lang="ts">\nconst load = () => fetch(\'/x\')\nvoid load\n</script>\n<template><div /></template>', 'src/modules/points/PointsContainer.vue', 'http-and-layers', 3)
  })

  it('XMLHttpRequest, axios и sendBeacon', async () => {
    await expectViolation('export const r = new XMLHttpRequest()', 'src/modules/points/helpers/example.ts', 'http-and-layers', 3)
    await expectViolation("import axios from 'axios'\nexport const a = axios", 'src/modules/points/api/example.ts', 'http-and-layers', 3)
    await expectViolation("export const s = () => navigator.sendBeacon('/x', '')", 'src/modules/points/helpers/example.ts', 'http-and-layers', 3)
  })

  it('общий клиент вне слоя api', async () => {
    await expectViolation("import { http } from '@/shared/http'\nexport const a = http", 'src/modules/points/helpers/example.ts', 'http-and-layers', 3)
    await expectViolation("import { createHttpClient } from '@/shared/http'\nexport const a = createHttpClient", 'src/app/example.ts', 'http-and-layers', 3)
  })

  it('WebSocket вне слоя api', async () => {
    await expectViolation("export const s = new WebSocket('ws://x')", 'src/modules/sync/engine/example.ts', 'http-and-layers', 3)
  })

  it('helpers не зависят от api, store, Vue, Pinia и компонентов', async () => {
    const file = 'src/modules/points/helpers/example.ts'
    await expectViolation("import { setPointMode } from '../api/setPointMode'\nexport const a = setPointMode", file, 'http-and-layers', 3)
    await expectViolation("import { usePointsStore } from '../store/pointsStore'\nexport const a = usePointsStore", file, 'http-and-layers', 3)
    await expectViolation("import { ref } from 'vue'\nexport const a = ref", file, 'http-and-layers', 3)
    await expectViolation("import { defineStore } from 'pinia'\nexport const a = defineStore", file, 'http-and-layers', 3)
    await expectViolation("import Panel from '../components/QueuePanel.vue'\nexport const a = Panel", file, 'http-and-layers', 3)
  })

  it('utils (технические) не знают о предметной области', async () => {
    const file = 'src/shared/utils/example.ts'
    await expectViolation("import { fetchMe } from '@/modules/session'\nexport const a = fetchMe", file, 'http-and-layers', 3)
    await expectViolation("import { x } from '../../modules/points/helpers/viewModel'\nexport const a = x", file, 'http-and-layers', 3)
  })

  it('api не зависит от store, Vue и компонентов', async () => {
    const file = 'src/modules/points/api/example.ts'
    await expectViolation("import { usePointsStore } from '../store/pointsStore'\nexport const a = usePointsStore", file, 'http-and-layers', 3)
    await expectViolation("import { ref } from 'vue'\nexport const a = ref", file, 'http-and-layers', 3)
  })

  it('допустимо: общий клиент в api, fetch в самом клиенте, WebSocket в api, типы из api в helpers', async () => {
    await expectClean("import { http } from '@/shared/http'\nexport const a = http", 'src/modules/points/api/example.ts')
    await expectClean("export const load = () => fetch('/x')", 'src/shared/http/httpClient.ts')
    await expectClean("export const open = () => new WebSocket('ws://x')", 'src/modules/sync/api/openSocket.ts')
    await expectClean("import type { Body } from '../api/cancelDecision'\nexport type X = Body", 'src/modules/decisions/helpers/example.ts')
    await expectClean("import { configureHttp, HttpTimeoutError } from '@/shared/http'\nexport const a = [configureHttp, HttpTimeoutError]", 'src/app/example.ts')
    await expectClean("import { ref } from 'vue'\nexport const a = ref", 'src/shared/utils/example.ts')
  })
})

describe('правило 4: Pinia и мутаторы', () => {
  it('defineStore вне каталога store/', async () => {
    await expectViolation("import { defineStore } from 'pinia'\nexport const useX = defineStore('x', () => ({}))", 'src/modules/points/helpers/example.ts', 'store-rules', 4)
  })

  it('функция store меняет состояние, а имя не оканчивается на Mutator', async () => {
    const code = "import { defineStore } from 'pinia'\nimport { ref } from 'vue'\nexport const useX = defineStore('x', () => {\n  const value = ref(0)\n  function setValue(next: number) {\n    value.value = next\n  }\n  return { value, setValue }\n})"
    await expectViolation(code, 'src/modules/points/store/example.ts', 'store-rules', 4)
  })

  it('мутация через методы коллекции и triggerRef тоже ловится', async () => {
    const code = "import { defineStore } from 'pinia'\nimport { shallowRef, triggerRef } from 'vue'\nexport const useX = defineStore('x', () => {\n  const byId = shallowRef(new Map<string, number>())\n  const add = (id: string) => {\n    byId.value.set(id, 1)\n    triggerRef(byId)\n  }\n  return { add }\n})"
    await expectViolation(code, 'src/modules/points/store/example.ts', 'store-rules', 4)
  })

  it('допустимо: мутатор с суффиксом, читающие функции без суффикса', async () => {
    const code = "import { defineStore } from 'pinia'\nimport { ref } from 'vue'\nexport const useX = defineStore('x', () => {\n  const value = ref(0)\n  const byId = ref(new Map<string, number>())\n  function setValueMutator(next: number) {\n    value.value = next\n  }\n  const addMutator = (id: string) => { byId.value.set(id, 1) }\n  function get(id: string) {\n    return byId.value.get(id)\n  }\n  const serverNow = () => Date.now() + value.value\n  return { value, setValueMutator, addMutator, get, serverNow }\n})"
    await expectClean(code, 'src/modules/points/store/example.ts')
  })
})

describe('v-html и уровень правил', () => {
  it('v-html запрещён', async () => {
    const found = await lint('<script setup lang="ts">\nconst html = \'<b>x</b>\'\n</script>\n<template><div v-html="html" /></template>\n', 'src/modules/points/components/Example.vue')
    const violation = found.find((m) => m.ruleId === 'vue/no-v-html')
    expect(violation?.severity).toBe(2)
  })

  it('все правила архитектуры включены на уровне error для src', async () => {
    const config = await eslint.calculateConfigForFile('src/modules/points/helpers/example.ts')
    for (const rule of ['module-boundaries', 'component-purity', 'http-and-layers', 'store-rules']) {
      const setting = config.rules?.[`dispatch/${rule}`]
      expect(Array.isArray(setting) ? setting[0] : setting, `dispatch/${rule}`).toBe(2)
    }
    const vue = await eslint.calculateConfigForFile('src/modules/points/components/Example.vue')
    expect(vue.rules?.['dispatch/component-purity']?.[0]).toBe(2)
    expect(vue.rules?.['vue/no-v-html']?.[0]).toBe(2)
  })

  it('код приложения проходит все правила (реальный src)', async () => {
    const results = await eslint.lintFiles(['src'])
    const problems = results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.ruleId}: ${m.message}`))
    expect(problems).toEqual([])
  })
})

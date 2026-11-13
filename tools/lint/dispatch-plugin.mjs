// Локальный плагин ESLint: архитектурные правила кода из AGENTS.md (правила 1-4 из задания).
// Все правила уровня error. Область действия: src/**, e2e и инструменты могут обращаться вглубь модулей.
import path from 'node:path'

const toRel = (filename) => path.relative(process.cwd(), filename).split(path.sep).join('/')
const segments = (rel) => rel.split('/')

const MODULE_PATH = /^src\/modules\/([^/]+)(?:\/(.*))?$/
const isPublicEntry = (rest) => rest === undefined || rest === '' || rest === 'index' || rest === 'index.ts'

/** Куда ведёт спецификатор импорта: путь от корня проекта или null для пакетов. */
function resolveSpecifier(spec, rel) {
  if (spec.startsWith('@/')) return `src/${spec.slice(2)}`
  if (spec.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))
  return null
}

const moduleTarget = (target) => {
  const m = target ? MODULE_PATH.exec(target) : null
  return m ? { name: m[1], rest: m[2] } : null
}

/** Источники импортов и реэкспортов, включая динамический import('...') с литералом. */
function importVisitors(handle) {
  const fromNode = (node) => {
    const source = node.source
    if (source && source.type === 'Literal' && typeof source.value === 'string') handle(node, source.value)
  }
  return {
    ImportDeclaration: fromNode,
    ExportNamedDeclaration: fromNode,
    ExportAllDeclaration: fromNode,
    ImportExpression(node) {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') handle(node, node.source.value)
    },
  }
}

const importedNames = (node) => (node.specifiers ?? []).map((s) => (s.imported?.name ?? s.local?.name ?? '')).filter(Boolean)
const calleeName = (callee) => (callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : '')

// --- правило 1: границы модулей ---

const moduleBoundaries = {
  meta: { type: 'problem', schema: [], messages: { violation: '{{text}}' } },
  create(context) {
    const rel = toRel(context.filename)
    if (!rel.startsWith('src/')) return {}
    const current = MODULE_PATH.exec(rel)?.[1] ?? null
    const inShared = rel.startsWith('src/shared/')

    return importVisitors((node, spec) => {
      const target = resolveSpecifier(spec, rel)
      if (!target) return
      const report = (text) => context.report({ node, messageId: 'violation', data: { text: `Правило 1: ${text}` } })

      if (inShared && (target.startsWith('src/modules') || target.startsWith('src/app'))) {
        report(`src/shared не знает о модулях и приложении: «${spec}». Общий код не должен зависеть от предметных модулей.`)
        return
      }
      if (current && target.startsWith('src/app')) {
        report(`модуль «${current}» не знает о src/app: «${spec}». Зависимость идёт от приложения к модулям.`)
        return
      }
      const t = moduleTarget(target)
      if (t && t.name !== current && !isPublicEntry(t.rest)) {
        report(`импорт из модуля «${t.name}» только через его index.ts, а не «${spec}». Экспортируйте нужное из src/modules/${t.name}/index.ts.`)
      }
    })
  },
}

// --- правило 2: компонент не делает запросов и не меняет store ---

const NETWORK_CONSTRUCTORS = new Set(['WebSocket', 'XMLHttpRequest', 'EventSource'])

const componentPurity = {
  meta: { type: 'problem', schema: [], messages: { violation: '{{text}}' } },
  create(context) {
    const rel = toRel(context.filename)
    if (!rel.startsWith('src/') || !rel.endsWith('.vue') || rel.endsWith('Container.vue')) return {}
    const report = (node, text) => context.report({ node, messageId: 'violation', data: { text: `Правило 2: ${text}` } })
    const hint = ' Запросы, состояние и ошибки это дело контейнера (*Container.vue): компонент берёт данные из props и сообщает о действиях через emit.'

    return {
      ...importVisitors((node, spec) => {
        // import type не создаёт связи со store и сетью во время выполнения
        if (node.type === 'ImportDeclaration' && node.importKind === 'type') return
        const names = node.type === 'ImportDeclaration' ? importedNames(node) : []
        const segs = spec.split('/')
        if (segs.includes('api')) report(node, `компонент импортирует слой api «${spec}».${hint}`)
        else if (spec === '@/shared/http' || spec.startsWith('@/shared/http/')) report(node, `компонент импортирует HTTP-клиент «${spec}».${hint}`)
        else if (spec === 'pinia' || segs.includes('store')) report(node, `компонент импортирует store «${spec}».${hint}`)
        else if (names.some((n) => /^use\w+Store$/.test(n) || n === 'defineStore' || n === 'storeToRefs')) report(node, `компонент использует store (${names.filter((n) => /Store$|storeToRefs/.test(n)).join(', ')}).${hint}`)
        else if (names.some((n) => n.endsWith('Mutator'))) report(node, `компонент импортирует мутатор store.${hint}`)
      }),
      CallExpression(node) {
        const name = calleeName(node.callee)
        if (node.callee.type === 'Identifier' && name === 'fetch') report(node, `компонент вызывает fetch.${hint}`)
        else if (name.endsWith('Mutator')) report(node, `компонент вызывает мутатор «${name}».${hint}`)
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && NETWORK_CONSTRUCTORS.has(node.callee.name)) report(node, `компонент открывает сеть (new ${node.callee.name}).${hint}`)
      },
    }
  },
}

// --- правило 3: HTTP только в слое api, слои helpers, utils, api ---

const SEGMENT_FORBIDDEN = {
  helpers: { api: 'слой api', store: 'store', pinia: 'Pinia', vue: 'Vue' },
  api: { store: 'store', pinia: 'Pinia', vue: 'Vue' },
}

const httpAndLayers = {
  meta: { type: 'problem', schema: [], messages: { violation: '{{text}}' } },
  create(context) {
    const rel = toRel(context.filename)
    if (!rel.startsWith('src/')) return {}
    const segs = segments(rel)
    const inApi = segs.includes('api')
    const inClient = rel.startsWith('src/shared/http/')
    const inHelpers = segs.includes('helpers')
    const inUtils = segs.includes('utils')
    const report = (node, text) => context.report({ node, messageId: 'violation', data: { text: `Правило 3: ${text}` } })

    return {
      ...importVisitors((node, spec) => {
        if (['axios', 'ky', 'node-fetch', 'got'].includes(spec)) report(node, `HTTP-библиотека «${spec}» не нужна: запросы идут через общий клиент src/shared/http в слое api.`)

        if ((spec === '@/shared/http' || spec.startsWith('@/shared/http/')) && node.type === 'ImportDeclaration') {
          const requests = importedNames(node).filter((n) => n === 'http' || n === 'createHttpClient')
          if (requests.length > 0 && !inApi && !inClient) report(node, `общий HTTP-клиент (${requests.join(', ')}) используется только в слое api модуля (каталог api/), а не здесь.`)
        }

        // слои: чисто типовой импорт (import type) не создаёт зависимости во время выполнения
        if (node.type === 'ImportDeclaration' && node.importKind === 'type') return
        const specSegs = spec.split('/')
        const target = resolveSpecifier(spec, rel)
        const targetSegs = target ? target.split('/') : specSegs
        const hits = (name) => specSegs.includes(name) || targetSegs.includes(name) || spec === name
        if (inHelpers) {
          for (const [dir, label] of Object.entries(SEGMENT_FORBIDDEN.helpers)) {
            if (hits(dir) || spec.endsWith('.vue')) {
              report(node, `helpers (бизнес-функции) не зависят от ${spec.endsWith('.vue') ? 'компонентов' : label}: «${spec}». Бизнес-функции чистые, данные им передаёт контейнер.`)
              break
            }
          }
        }
        if (inApi) {
          for (const [dir, label] of Object.entries(SEGMENT_FORBIDDEN.api)) {
            if (hits(dir) || spec.endsWith('.vue')) {
              report(node, `слой api только ходит в сеть и не зависит от ${spec.endsWith('.vue') ? 'компонентов' : label}: «${spec}».`)
              break
            }
          }
        }
        if (inUtils) {
          const domain = spec.startsWith('@/modules') || hits('helpers') || hits('api') || hits('store') || spec.endsWith('.vue')
          if (domain) report(node, `utils (технические функции) не знают о предметной области: «${spec}». Предметное место этого кода в helpers модуля.`)
        }
      }),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch' && !inClient) {
          report(node, 'fetch вызывается только в общем клиенте src/shared/http. Остальной код ходит в сеть через слой api и этот клиент.')
        }
        if (node.callee.type === 'MemberExpression' && calleeName(node.callee) === 'sendBeacon' && !inClient) {
          report(node, 'navigator.sendBeacon это HTTP: только через общий клиент в слое api.')
        }
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier') return
        const name = node.callee.name
        if (name === 'XMLHttpRequest' && !inClient) report(node, 'XMLHttpRequest запрещён: только общий клиент src/shared/http.')
        if ((name === 'WebSocket' || name === 'EventSource') && !inApi && !inClient) report(node, `сеть (new ${name}) открывается только в слое api модуля.`)
      },
    }
  },
}

// --- правило 4: Pinia и мутаторы ---

const MUTATING_METHODS = new Set(['set', 'delete', 'clear', 'add', 'push', 'splice', 'unshift', 'pop', 'shift'])

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const value = node[key]
    if (Array.isArray(value)) value.forEach((v) => v && typeof v.type === 'string' && walk(v, visit))
    else if (value && typeof value.type === 'string') walk(value, visit)
  }
}

const touchesValue = (node) => {
  let current = node
  while (current && current.type === 'MemberExpression') {
    if (current.property.type === 'Identifier' && current.property.name === 'value') return true
    current = current.object
  }
  return false
}

/** Меняет ли функция состояние store: присваивание в .value, мутирующий вызов на .value, triggerRef. */
function mutatesState(fn) {
  let found = false
  walk(fn.body, (node) => {
    if (found) return
    if (node.type === 'AssignmentExpression' && touchesValue(node.left)) found = true
    else if (node.type === 'UpdateExpression' && touchesValue(node.argument)) found = true
    else if (node.type === 'CallExpression') {
      if (node.callee.type === 'Identifier' && node.callee.name === 'triggerRef') found = true
      else if (node.callee.type === 'MemberExpression' && MUTATING_METHODS.has(calleeName(node.callee)) && touchesValue(node.callee.object)) found = true
    }
  })
  return found
}

const storeRules = {
  meta: { type: 'problem', schema: [], messages: { violation: '{{text}}' } },
  create(context) {
    const rel = toRel(context.filename)
    if (!rel.startsWith('src/')) return {}
    const inStore = segments(rel).includes('store')
    const report = (node, text) => context.report({ node, messageId: 'violation', data: { text: `Правило 4: ${text}` } })

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineStore') return
        if (!inStore) {
          report(node, 'defineStore только в каталоге store/ модуля: Pinia хранит общее долгоживущее состояние, а не локальное состояние компонента.')
          return
        }
        const setup = node.arguments.find((a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')
        if (!setup || setup.body.type !== 'BlockStatement') return
        for (const statement of setup.body.body) {
          let fn
          let name
          if (statement.type === 'FunctionDeclaration') {
            fn = statement
            name = statement.id?.name
          } else if (statement.type === 'VariableDeclaration') {
            for (const d of statement.declarations) {
              if (d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression') && d.id.type === 'Identifier') {
                fn = d.init
                name = d.id.name
              }
            }
          }
          if (fn && name && mutatesState(fn) && !name.endsWith('Mutator')) {
            report(statement, `функция store «${name}» меняет состояние, её имя должно оканчиваться на Mutator («${name}Mutator»).`)
          }
        }
      },
    }
  },
}

export default {
  meta: { name: 'dispatch' },
  rules: {
    'module-boundaries': moduleBoundaries,
    'component-purity': componentPurity,
    'http-and-layers': httpAndLayers,
    'store-rules': storeRules,
  },
}

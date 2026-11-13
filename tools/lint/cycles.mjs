// Проверка правила 1: циклов импортов нет. Граф файлов src и граф модулей; цикл это ошибка.
// Запуск: node tools/lint/cycles.mjs [каталог src]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'
import ts from 'typescript'

const EXTENSIONS = ['.ts', '.vue', '.tsx', '.mjs', '.js']
const MODULE_DIR = /^modules\/([^/]+)\//

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist'].includes(entry.name)) continue
      walk(full, files)
    } else if (/\.(ts|tsx|vue)$/.test(entry.name) && !/\.(test|spec|typetest)\.(ts|tsx)$/.test(entry.name) && !full.includes(`${path.sep}testing${path.sep}`)) {
      files.push(full)
    }
  }
  return files
}

/** Все специфкаторы импортов файла, включая `import type`, реэкспорты и динамический import(). */
function importsOf(file) {
  const source = fs.readFileSync(file, 'utf8')
  const chunks = []
  if (file.endsWith('.vue')) {
    const { descriptor } = parseSfc(source, { filename: file })
    for (const block of [descriptor.script, descriptor.scriptSetup]) if (block) chunks.push(block.content)
  } else {
    chunks.push(source)
  }
  const specs = []
  for (const chunk of chunks) {
    for (const imported of ts.preProcessFile(chunk, true, true).importedFiles) specs.push(imported.fileName)
  }
  return specs
}

function resolveFile(spec, from, aliasRoot) {
  let base
  if (spec.startsWith('@/')) base = path.join(aliasRoot, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`))]
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null
}

/** Граф: ключ это путь файла, значение это множество файлов, которые он импортирует. */
export function buildGraph(root, aliasRoot = root) {
  const graph = new Map()
  for (const file of walk(root)) {
    const deps = new Set()
    for (const spec of importsOf(file)) {
      const target = resolveFile(spec, file, aliasRoot)
      if (target && target.startsWith(root)) deps.add(target)
    }
    graph.set(file, deps)
  }
  return graph
}

/** Граф модулей: модуль A зависит от B, если файл из A импортирует файл из B. */
export function moduleGraph(fileGraph, root) {
  const graph = new Map()
  // Модуль определяется по пути от корня проверяемого каталога (src/modules/<имя>/...), а не по любому фрагменту пути
  const moduleOf = (file) => MODULE_DIR.exec(path.relative(root, file).split(path.sep).join('/'))?.[1] ?? null
  for (const [file, deps] of fileGraph) {
    const from = moduleOf(file)
    if (!from) continue
    if (!graph.has(from)) graph.set(from, new Set())
    for (const dep of deps) {
      const to = moduleOf(dep)
      if (to && to !== from) graph.get(from).add(to)
    }
  }
  return graph
}

/** Сильно связные компоненты (Тарьян): каждая группа из двух и более узлов, или узел с петлёй, это цикл. */
export function findCycles(graph) {
  let counter = 0
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const cycles = []

  const connect = (node) => {
    index.set(node, counter)
    low.set(node, counter)
    counter += 1
    stack.push(node)
    onStack.add(node)
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        connect(next)
        low.set(node, Math.min(low.get(node), low.get(next)))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)))
      }
    }
    if (low.get(node) === index.get(node)) {
      const group = []
      let top
      do {
        top = stack.pop()
        onStack.delete(top)
        group.push(top)
      } while (top !== node)
      if (group.length > 1 || graph.get(node)?.has(node)) cycles.push(group)
    }
  }
  for (const node of graph.keys()) if (!index.has(node)) connect(node)
  return cycles.map((group) => cyclePath(graph, group))
}

/** Один конкретный путь по кругу внутри группы, чтобы сообщение показывало, как цикл замыкается. */
function cyclePath(graph, group) {
  const inGroup = new Set(group)
  const start = group[0]
  const visited = new Set()
  const dfs = (node, pathSoFar) => {
    if (visited.has(node)) return null
    visited.add(node)
    for (const next of graph.get(node) ?? []) {
      if (!inGroup.has(next)) continue
      if (next === start) return [...pathSoFar, node, start]
      const found = dfs(next, [...pathSoFar, node])
      if (found) return found
    }
    return null
  }
  return dfs(start, []) ?? [...group, start]
}

export function checkCycles(root, aliasRoot = root) {
  const files = buildGraph(root, aliasRoot)
  return { files: findCycles(files), modules: findCycles(moduleGraph(files, root)) }
}

function report(root, aliasRoot) {
  const { files, modules } = checkCycles(root, aliasRoot)
  const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join('/')
  const lines = []
  for (const cycle of modules) lines.push(`Правило 1: цикл между модулями: ${cycle.join(' → ')}`)
  for (const cycle of files) lines.push(`Правило 1: цикл импортов: ${cycle.map(rel).join(' → ')}`)
  return lines
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(process.argv[2] ?? 'src')
  const lines = report(root, root)
  if (lines.length > 0) {
    console.error(lines.join('\n'))
    process.exit(1)
  }
  console.log('Циклов импортов нет')
}

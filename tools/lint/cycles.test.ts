import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error модуль на JS без типов
import { buildGraph, checkCycles, findCycles } from './cycles.mjs'

const fixtures = path.resolve(__dirname, 'fixtures/cycles')
const names = (cycle: string[]) => cycle.map((p) => path.basename(p))

describe('проверка циклов импортов', () => {
  it('цикл из двух файлов найден, путь замкнут', () => {
    const { files } = checkCycles(path.join(fixtures, 'two-files'))
    expect(files).toHaveLength(1)
    const cycle = names(files[0])
    expect(cycle[0]).toBe(cycle[cycle.length - 1])
    expect(new Set(cycle)).toEqual(new Set(['a.ts', 'b.ts']))
  })

  it('граф без цикла чист', () => {
    expect(checkCycles(path.join(fixtures, 'clean'))).toEqual({ files: [], modules: [] })
  })

  it('файл, импортирующий сам себя, это цикл', () => {
    expect(checkCycles(path.join(fixtures, 'self')).files).toHaveLength(1)
  })

  it('цикл между модулями через их index.ts виден и как модульный, и как файловый', () => {
    const root = path.join(fixtures, 'modules')
    const { files, modules } = checkCycles(root)
    expect(modules).toHaveLength(1)
    expect(new Set(modules[0])).toEqual(new Set(['a', 'b']))
    expect(files).toHaveLength(1)
  })

  it('findCycles на готовом графе: длинный цикл и ветка без цикла', () => {
    const graph = new Map<string, Set<string>>([
      ['a', new Set(['b'])],
      ['b', new Set(['c'])],
      ['c', new Set(['a', 'd'])],
      ['d', new Set()],
    ])
    const cycles = findCycles(graph)
    expect(cycles).toHaveLength(1)
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b', 'c']))
  })

  it('разбирает импорты из .ts, type-импорты и <script> в .vue', () => {
    const graph = buildGraph(path.resolve(__dirname, '../../src/modules/session'), path.resolve(__dirname, '../../src'))
    const container = [...graph.keys()].find((f) => f.endsWith('sessionStore.ts'))
    expect(container).toBeDefined()
    expect(graph.size).toBeGreaterThan(3)
  })

  it('весь src без циклов (реальный код)', () => {
    const src = path.resolve(__dirname, '../../src')
    expect(checkCycles(src)).toEqual({ files: [], modules: [] })
  })
})

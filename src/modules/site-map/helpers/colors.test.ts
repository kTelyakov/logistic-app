import { VEHICLE_STATES } from '@/modules/vehicles'
import { describe, expect, it } from 'vitest'
import { STATE_STYLES, stateColorTable } from './colors'

describe('палитра состояний', () => {
  it('стиль на каждое состояние, в порядке числовых кодов', () => {
    expect(STATE_STYLES.map((s) => s.state)).toEqual([...VEHICLE_STATES])
  })

  it('цвета различны, подписи различны и не пусты', () => {
    expect(new Set(STATE_STYLES.map((s) => s.css)).size).toBe(6)
    expect(new Set(STATE_STYLES.map((s) => s.label)).size).toBe(6)
    for (const s of STATE_STYLES) expect(s.label.length).toBeGreaterThan(2)
  })

  it('таблица для шейдера: три компоненты на состояние в долях единицы', () => {
    const table = stateColorTable()
    expect(table).toHaveLength(18)
    for (const v of table) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    // #5aa9ff: moving_empty, индекс 1
    expect(table[3]).toBeCloseTo(0x5a / 255, 6)
    expect(table[4]).toBeCloseTo(0xa9 / 255, 6)
    expect(table[5]).toBeCloseTo(1, 6)
  })
})

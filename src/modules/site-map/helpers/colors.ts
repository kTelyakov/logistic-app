import type { VehicleState } from '@dispatch/contract'
import { VEHICLE_STATES } from '@/modules/vehicles'

export interface StateStyle {
  state: VehicleState
  label: string
  /** Цвет RGB в долях единицы для шейдера. */
  rgb: readonly [number, number, number]
  css: string
}

const hex = (value: string): [number, number, number] => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
]

/** Палитра различима и без цвета: состояния отличаются ещё и подписью в легенде. */
const STYLES: Record<VehicleState, { label: string; css: string }> = {
  moving_loaded: { label: 'Едет гружёная', css: '#f0b429' },
  moving_empty: { label: 'Едет порожняя', css: '#5aa9ff' },
  queued: { label: 'В очереди', css: '#b388ff' },
  service: { label: 'Обслуживание', css: '#3ecf8e' },
  idle: { label: 'Простой', css: '#9aa7b6' },
  offline: { label: 'Нет связи', css: '#ef6461' },
}

/** Стили в порядке числовых кодов состояния (как в арене и в шейдере). */
export const STATE_STYLES: readonly StateStyle[] = VEHICLE_STATES.map((state) => {
  const style = STYLES[state]
  return { state, label: style.label, css: style.css, rgb: hex(style.css) }
})

/** Плоская таблица цветов для униформы шейдера: по три числа на состояние. */
export function stateColorTable(): Float32Array {
  const table = new Float32Array(STATE_STYLES.length * 3)
  STATE_STYLES.forEach((style, i) => table.set(style.rgb, i * 3))
  return table
}

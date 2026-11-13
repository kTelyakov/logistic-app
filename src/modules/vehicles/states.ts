import type { VehicleState } from '@dispatch/contract'

/** Порядок задаёт числовой код состояния в арене и в шейдере. */
export const VEHICLE_STATES: readonly VehicleState[] = [
  'moving_loaded',
  'moving_empty',
  'queued',
  'service',
  'idle',
  'offline',
]

const CODES = new Map<VehicleState, number>(VEHICLE_STATES.map((state, code) => [state, code]))

export function stateToCode(state: VehicleState): number {
  const code = CODES.get(state)
  if (code === undefined) throw new Error(`Неизвестное состояние машины: ${String(state)}`)
  return code
}

export function codeToState(code: number): VehicleState {
  const state = VEHICLE_STATES[code]
  if (state === undefined) throw new Error(`Неизвестный код состояния: ${code}`)
  return state
}

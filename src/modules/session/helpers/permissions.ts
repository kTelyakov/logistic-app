import type { Role } from '@dispatch/contract'

/** Наблюдатель видит данные, но не видит кнопок действий; диспетчер может вмешиваться. */
export function canCommand(role: Role | undefined): boolean {
  return role === 'dispatcher'
}

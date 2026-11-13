import type { Point } from '@dispatch/contract'

/** Пункты в естественном порядке: p-2 перед p-10. */
export function sortPoints(points: readonly Point[]): Point[] {
  return [...points].sort((a, b) => a.point_id.localeCompare(b.point_id, 'ru', { numeric: true }))
}

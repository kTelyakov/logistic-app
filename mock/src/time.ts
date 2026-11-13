export type Clock = () => number

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

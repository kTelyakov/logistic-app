/**
 * last_seen хранится в миллисекундах эпохи (Float64), а float32 шейдера не вмещает их точно.
 * В GPU уходят секунды относительно базы: так точность не хуже миллисекунды на сутках работы.
 */
export function toBaseSeconds(ms: number, baseMs: number): number {
  return (ms - baseMs) / 1000
}

/** Заполняет `out` относительными секундами для первых `count` машин. */
export function fillSeenSeconds(out: Float32Array, lastSeenMs: Float64Array, count: number, baseMs: number): void {
  for (let i = 0; i < count; i++) out[i] = ((lastSeenMs[i] as number) - baseMs) / 1000
}

/** Машина считается устаревшей, если последние данные старше порога по времени сервера (то же правило, что в шейдере). */
export function isStale(lastSeenMs: number, serverNowMs: number, staleAfterMs: number): boolean {
  return serverNowMs - lastSeenMs > staleAfterMs
}

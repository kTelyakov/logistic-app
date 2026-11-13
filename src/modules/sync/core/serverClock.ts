/**
 * Оценка времени сервера. Часы браузера могут идти неверно, поэтому отсчёты и признаки
 * устаревания считаются по времени сервера: serverNow = время браузера + сдвиг.
 *
 * Сдвиг оценивается по полю `at` сообщений: sample = serverAt - localWall. Задержка сети делает
 * замер меньше истинного сдвига, поэтому берём максимум по последним замерам (наименьшая задержка).
 */
export class ServerClock {
  private readonly samples: number[] = []

  constructor(private readonly windowSize = 8) {}

  /** Учитывает сообщение сервера с временем `serverAtIso`, полученное в момент `localWallMs`. */
  observe(serverAtIso: string, localWallMs: number): void {
    const serverAt = Date.parse(serverAtIso)
    if (Number.isNaN(serverAt)) return
    this.samples.push(serverAt - localWallMs)
    if (this.samples.length > this.windowSize) this.samples.shift()
  }

  get synced(): boolean {
    return this.samples.length > 0
  }

  get offsetMs(): number {
    return this.samples.length === 0 ? 0 : Math.max(...this.samples)
  }

  /** Текущее время сервера в миллисекундах. До первого замера совпадает с временем браузера. */
  now(localWallMs: number = Date.now()): number {
    return localWallMs + this.offsetMs
  }
}

import type { Fault } from '@dispatch/contract'
import { unit } from './random'

export interface FaultDecision {
  drop: boolean
  dup: boolean
  reorder: boolean
}

/**
 * Решение об отказе зависит только от (seed, seq), а не от времени и порядка отправки:
 * один и тот же seq при одном seed всегда пропускается, повторяется или переставляется одинаково.
 */
export function faultDecision(
  seed: number,
  seq: number,
  faults: ReadonlySet<Fault>,
  rate: number,
): FaultDecision {
  return {
    drop: faults.has('drop') && unit(seed, 'drop', seq) < rate,
    dup: faults.has('dup') && unit(seed, 'dup', seq) < rate,
    reorder: faults.has('reorder') && unit(seed, 'reorder', seq) < rate,
  }
}

/** FAULTS=slow: часть команд выполняется до задержки ответа, часть после. */
export function executesBeforeDelay(seed: number, key: string): boolean {
  return unit(seed, 'slow', key) < 0.5
}

const REORDER_FLUSH_MS = 250

/**
 * Слой над отправкой одного соединения. Журнал и состояние остаются истинными,
 * искажается только то, что уходит в сокет.
 */
export class FaultySender {
  private held: string | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly send: (json: string) => void,
    private readonly seed: number,
    private readonly faults: ReadonlySet<Fault>,
    private readonly rate: number,
  ) {}

  push(seq: number, json: string): void {
    const decision = faultDecision(this.seed, seq, this.faults, this.rate)
    if (decision.drop) return

    if (this.held !== undefined) {
      // Переставляем: сначала текущее сообщение, потом удержанное
      const heldJson = this.held
      this.held = undefined
      this.clearTimer()
      this.send(json)
      if (decision.dup) this.send(json)
      this.send(heldJson)
      return
    }

    if (decision.reorder) {
      this.held = json
      this.timer = setTimeout(() => this.flush(), REORDER_FLUSH_MS)
      this.timer.unref()
      return
    }

    this.send(json)
    if (decision.dup) this.send(json)
  }

  /** Отдаёт удержанное сообщение, если следующего не последовало. */
  flush(): void {
    this.clearTimer()
    if (this.held !== undefined) {
      const json = this.held
      this.held = undefined
      this.send(json)
    }
  }

  dispose(): void {
    this.clearTimer()
    this.held = undefined
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}

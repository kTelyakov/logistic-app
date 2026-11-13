import type { Decision, Point, Snapshot, Vehicle } from '@dispatch/contract'
import { iso, type Clock } from './time'

export interface JournalEntry {
  seq: number
  json: string
}

type Listener = (entry: JournalEntry) => void

const HOUR_MS = 60 * 60 * 1000

/**
 * Истинное состояние сервера и журнал событий.
 * Снимок и поток строятся из одного журнала, поэтому seq и since всегда согласованы.
 */
export class World {
  seq = 0
  readonly vehicles = new Map<string, Vehicle>()
  readonly points = new Map<string, Point>()
  readonly decisions = new Map<string, Decision>()

  private journal: JournalEntry[] = []
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly now: Clock,
    private readonly journalSize: number,
  ) {}

  emit(type: 'vehicle', data: Vehicle): void
  emit(type: 'point', data: Point): void
  emit(type: 'decision', data: Decision): void
  emit(type: 'vehicle' | 'point' | 'decision', data: Vehicle | Point | Decision): void {
    this.seq += 1
    const entry: JournalEntry = {
      seq: this.seq,
      json: JSON.stringify({ seq: this.seq, at: iso(this.now()), type, data }),
    }
    this.journal.push(entry)
    if (this.journal.length > this.journalSize + (this.journalSize >> 2)) {
      this.journal = this.journal.slice(-this.journalSize)
    }
    for (const listener of this.listeners) listener(entry)
  }

  /**
   * Сообщения после since. null, если их уже нет в журнале (или клиент опережает сервер):
   * тогда клиент должен заново запросить снимок.
   */
  since(since: number): JournalEntry[] | null {
    if (since > this.seq) return null
    if (since === this.seq) return []
    const first = this.journal[0]
    if (first === undefined || since < first.seq - 1) return null
    return this.journal.slice(since + 1 - first.seq)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Решения за последний час. */
  recentDecisions(): Decision[] {
    const threshold = this.now() - HOUR_MS
    const result: Decision[] = []
    for (const decision of this.decisions.values()) {
      if (Date.parse(decision.created_at) >= threshold) result.push(decision)
    }
    return result
  }

  pruneDecisions(): void {
    const threshold = this.now() - 2 * HOUR_MS
    for (const [id, decision] of this.decisions) {
      if (Date.parse(decision.created_at) < threshold) this.decisions.delete(id)
    }
  }

  snapshot(): Snapshot {
    return {
      seq: this.seq,
      at: iso(this.now()),
      vehicles: [...this.vehicles.values()],
      points: [...this.points.values()],
      decisions: this.recentDecisions(),
    }
  }
}

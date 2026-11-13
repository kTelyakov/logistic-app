import { columnsBuffers } from '@/modules/vehicles'
import type { SyncConfig } from '../core'
import type { EngineOutput, StatusOutput, WorkerInput } from '../protocol'
import { BatchApplier, type BatchTarget } from './applyBatch'

export interface SyncClient {
  start(): void
  stop(): void
}

export interface SyncClientOptions {
  /** Адрес сервера; пустая строка означает тот же origin. */
  baseUrl: string
  target: BatchTarget
  onStatus(status: StatusOutput): void
  config?: Partial<SyncConfig>
}

/**
 * Основной поток: запускает воркер, применяет его пакеты к хранилищам и возвращает ему буферы
 * использованных кадров.
 */
export function createSyncClient(options: SyncClientOptions): SyncClient {
  const applier = new BatchApplier(options.target)
  let worker: Worker | undefined

  const post = (input: WorkerInput, transfer: ArrayBuffer[] = []) => worker?.postMessage(input, transfer)

  return {
    start() {
      if (worker) return
      worker = new Worker(new URL('../worker/sync.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<EngineOutput>) => {
        const output = event.data
        if (output.type === 'status') {
          options.onStatus(output)
          return
        }
        const released = applier.apply(output)
        if (released) post({ type: 'recycle', columns: released }, columnsBuffers(released))
      }
      post(options.config ? { type: 'start', baseUrl: options.baseUrl, config: options.config } : { type: 'start', baseUrl: options.baseUrl })
    },
    stop() {
      post({ type: 'stop' })
      worker?.terminate()
      worker = undefined
    },
  }
}

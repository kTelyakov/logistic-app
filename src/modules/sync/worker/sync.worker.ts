/// <reference lib="webworker" />
// Тонкая оболочка: вся логика в SyncEngine, который проверяется в Node.
import { configureHttp } from '@/shared/http'
import { fetchSnapshot } from '../api/fetchSnapshot'
import { openSocket } from '../api/openSocket'
import { SyncEngine } from '../engine/SyncEngine'
import type { WorkerInput } from '../protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
let engine: SyncEngine | undefined

scope.onmessage = (event: MessageEvent<WorkerInput>) => {
  const input = event.data
  switch (input.type) {
    case 'start': {
      engine?.stop()
      configureHttp({ baseUrl: input.baseUrl })
      engine = new SyncEngine(
        {
          fetchSnapshot,
          openSocket: (since, handlers) => openSocket(input.baseUrl, since, handlers),
          emit: (output, transfer) => scope.postMessage(output, transfer ?? []),
        },
        input.config ? { config: input.config } : {},
      )
      engine.start()
      break
    }
    case 'recycle':
      engine?.recycle(input.columns)
      break
    case 'stop':
      engine?.stop()
      engine = undefined
      break
  }
}

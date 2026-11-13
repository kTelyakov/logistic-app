import type { Decision } from '@dispatch/contract'
import { WebSocket } from 'ws'
import { parseConfig, type MockConfig } from './config'
import { startMock, type MockServer } from './server'

/** Быстрые тайминги для тестов: решения создаются и исполняются за доли секунды. */
export async function startFast(overrides: Partial<MockConfig> = {}): Promise<MockServer> {
  const config = parseConfig({}, {
    port: 0,
    load: 60,
    tickMs: 50,
    heartbeatMs: 100,
    decisionMinMs: 80,
    decisionMaxMs: 120,
    executeAfterMs: 5_000,
    ...overrides,
  })
  return startMock(config)
}

export async function until<T>(
  probe: () => T | undefined | false,
  timeoutMs = 4_000,
  stepMs = 15,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error('until: условие не выполнилось за отведённое время')
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
}

/** Копия ожидающего решения: объекты мира живые, и тест должен сравнивать с состоянием на момент вызова. */
export async function pendingDecision(mock: MockServer): Promise<Decision> {
  const live = await until(() => [...mock.world.decisions.values()].find((d) => d.status === 'pending'))
  return { ...live }
}

export function headers(key: string, version: number | string): Record<string, string> {
  return { 'Idempotency-Key': key, 'If-Match': String(version), 'content-type': 'application/json' }
}

export interface WsClient {
  socket: WebSocket
  messages: Array<Record<string, unknown> & { type: string; seq?: number }>
  closed: Promise<void>
}

/** since === undefined: параметр не передаётся вовсе. */
export async function connect(mock: MockServer, since: number | string | undefined): Promise<WsClient> {
  const query = since === undefined ? '' : `?since=${since}`
  const socket = new WebSocket(`${mock.url.replace('http', 'ws')}/ws${query}`)
  const messages: WsClient['messages'] = []
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())))
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  return { socket, messages, closed }
}

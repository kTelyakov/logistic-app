import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerState } from '../helpers/state'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** Переменные, которыми управляется заглушка: из окружения разработчика они не должны просочиться в тест. */
const MOCK_ENV_KEYS = [
  'PORT', 'LOAD', 'FAULTS', 'ROLE', 'FAULT_SEED', 'FAULT_RATE', 'TICK_MS', 'HEARTBEAT_MS',
  'RESET_INTERVAL_MS', 'SLOW_DELAY_MS', 'DECISION_MIN_MS', 'DECISION_MAX_MS', 'EXECUTE_AFTER_MS',
  'STALE_SILENT_MS', 'STALE_ACTIVE_MS', 'SERVICE_MIN_MS', 'SERVICE_MAX_MS', 'QUEUE_RECOMPUTE_MS', 'JOURNAL_SIZE',
]

export type MockEnv = Record<string, string>

export interface DebugState extends ServerState {
  at: string
  paused: boolean
  commands: Record<string, { command: string; target: string; executions: number; replays: number; status: number }>
  config: { load: number; faults: string[]; role: string; seed: number }
}

export interface RunningMock {
  url: string
  port: number
  env: MockEnv
  debugState(): Promise<DebugState>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  /** Лог процесса заглушки (для сообщений об ошибках). */
  output(): string
}

/**
 * Запускает заглушку отдельным процессом, как `make mock`, на свободном порту.
 * Каждый вызов даёт процесс со свежим состоянием.
 */
export async function startMockProcess(env: MockEnv = {}): Promise<RunningMock> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env }
  for (const key of MOCK_ENV_KEYS) delete childEnv[key]
  Object.assign(childEnv, env, { PORT: '0' })

  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'mock/src/main.ts'], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const append = (chunk: Buffer) => {
    log += chunk.toString()
    if (log.length > 20_000) log = log.slice(-20_000)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Заглушка не запустилась за 15 с.\n${log}`)), 15_000)
    const check = () => {
      const match = /слушает (http:\/\/\S+)/.exec(log)
      if (match?.[1]) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }
    child.stdout?.on('data', check)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Заглушка завершилась с кодом ${code} при запуске.\n${log}`))
    })
  })

  const post = async (route: string) => {
    const res = await fetch(`${url}${route}`, { method: 'POST' })
    if (!res.ok) throw new Error(`POST ${route}: ${res.status}`)
  }

  return {
    url,
    port: Number(new URL(url).port),
    env,
    output: () => log,
    async debugState() {
      const res = await fetch(`${url}/debug/state`)
      if (!res.ok) throw new Error(`GET /debug/state: ${res.status}`)
      return (await res.json()) as DebugState
    },
    pause: () => post('/debug/pause'),
    resume: () => post('/debug/resume'),
    async stop() {
      if (child.exitCode === null) child.kill('SIGTERM')
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { PATHS, HEADERS, type Me, type PointMode } from '@dispatch/contract'
import { WebSocketServer, type WebSocket } from 'ws'
import { CommandService } from './commands'
import type { MockConfig } from './config'
import { executesBeforeDelay, FaultySender } from './faults'
import { Simulation } from './sim'
import { iso, type Clock } from './time'
import { World } from './world'

export interface MockServer {
  port: number
  url: string
  world: World
  sim: Simulation
  commands: CommandService
  close(): Promise<void>
}

const MAX_BODY_BYTES = 1024 * 1024
const BUFFERED_LIMIT_BYTES = 64 * 1024 * 1024

function matchPath(template: string, path: string): string | undefined {
  const names = template.split('/')
  const parts = path.split('/')
  if (names.length !== parts.length) return undefined
  let id: string | undefined
  for (let i = 0; i < names.length; i++) {
    if (names[i] === ':id') id = decodeURIComponent(parts[i] ?? '')
    else if (names[i] !== parts[i]) return undefined
  }
  return id
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Тело запроса слишком большое')
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function startMock(
  config: MockConfig,
  clock: Clock = Date.now,
  log: (message: string) => void = () => {},
): Promise<MockServer> {
  const world = new World(clock, config.journalSize)
  const sim = new Simulation(world, config, clock)
  const commands = new CommandService(world, sim, config.role, clock)
  const timers = new Set<NodeJS.Timeout>()
  const clients = new Set<{ socket: WebSocket; sender: FaultySender }>()
  let pendingReset = false

  const me: Me = {
    user_id: 'u-7',
    name: 'Иванова А. С.',
    role: config.role,
    site: { name: 'Площадка 3', tz: 'Asia/Krasnoyarsk' },
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        resolve()
      }, ms)
      timers.add(timer)
    })

  function send(res: http.ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(text)
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', `content-type, ${HEADERS.idempotencyKey}, ${HEADERS.ifMatch}`)
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const path = new URL(req.url ?? '/', 'http://mock.local').pathname
    const isDebug = path.startsWith('/debug')

    if (req.method === 'GET' && path === PATHS.debugState) {
      send(res, 200, {
        ...world.snapshot(),
        commands: commands.executionsByKey(),
        config: {
          load: config.load,
          faults: [...config.faults],
          role: config.role,
          seed: config.seed,
        },
      })
      return
    }

    const slow = config.faults.has('slow') && !isDebug
    const input = {
      key: header(req, HEADERS.idempotencyKey),
      ifMatch: header(req, HEADERS.ifMatch),
    }

    if (req.method === 'POST') {
      const decisionId = matchPath(PATHS.decisionCancel, path)
      const pointId = matchPath(PATHS.pointMode, path)
      if (decisionId === undefined && pointId === undefined) {
        send(res, 404, { message: 'Не найдено' })
        return
      }

      let mode: PointMode | undefined
      if (pointId !== undefined) {
        let body: unknown
        try {
          body = await readJson(req)
        } catch {
          send(res, 400, { message: 'Некорректный JSON' })
          return
        }
        const candidate = (body as { mode?: unknown } | undefined)?.mode
        if (candidate !== 'auto' && candidate !== 'manual') {
          send(res, 400, { message: 'Поле mode: auto или manual' })
          return
        }
        mode = candidate
      }

      const execute = () =>
        decisionId !== undefined
          ? commands.cancelDecision(decisionId, input)
          : commands.setPointMode(pointId as string, mode as PointMode, input)

      if (slow) {
        // Часть команд выполняется до задержки: клиент получит таймаут, а на сервере она уже выполнена
        if (input.key && executesBeforeDelay(config.seed, input.key)) {
          const result = execute()
          await sleep(config.slowDelayMs)
          send(res, result.status, result.body)
        } else {
          await sleep(config.slowDelayMs)
          const result = execute()
          send(res, result.status, result.body)
        }
        return
      }
      const result = execute()
      send(res, result.status, result.body)
      return
    }

    if (req.method === 'GET' && (path === PATHS.me || path === PATHS.snapshot)) {
      if (slow) await sleep(config.slowDelayMs)
      send(res, 200, path === PATHS.me ? me : world.snapshot())
      return
    }

    send(res, 404, { message: 'Не найдено' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      log(`ошибка обработки ${req.method} ${req.url}: ${String(error)}`)
      if (!res.headersSent) send(res, 500, { message: 'Внутренняя ошибка' })
      else res.end()
    })
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://mock.local')
    if (url.pathname !== PATHS.ws) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url))
  })

  /** Склеивает записи одной пачки сообщений в меньшее число TCP-пакетов. */
  function corkOnce(ws: WebSocket): void {
    const raw = (ws as unknown as { _socket?: { cork(): void; uncork(): void; corked?: number } })._socket
    if (!raw || (raw.corked ?? 0) > 0) return
    raw.cork()
    setImmediate(() => raw.uncork())
  }

  function onConnection(ws: WebSocket, url: URL): void {
    const sinceParam = url.searchParams.get('since')
    const since = sinceParam === null ? world.seq : Number(sinceParam)
    if (sinceParam === '' || !Number.isInteger(since) || since < 0) {
      ws.close(1008, 'since: неотрицательное целое')
      return
    }

    const sendRaw = (json: string) => {
      if (ws.readyState !== ws.OPEN) return
      if (ws.bufferedAmount > BUFFERED_LIMIT_BYTES) {
        ws.terminate()
        return
      }
      corkOnce(ws)
      ws.send(json)
    }
    const sender = new FaultySender(sendRaw, config.seed, config.faults, config.faultRate)
    const client = { socket: ws, sender }
    clients.add(client)

    const resetNow = pendingReset
    if (resetNow) pendingReset = false
    const backlog = resetNow ? null : world.since(since)
    if (backlog === null) {
      // Сообщений после since уже нет: клиент заново запрашивает снимок. Соединение остаётся открытым.
      sendRaw(JSON.stringify({ type: 'reset' }))
    } else {
      for (const entry of backlog) sender.push(entry.seq, entry.json)
    }

    const unsubscribe = world.subscribe((entry) => sender.push(entry.seq, entry.json))
    ws.on('close', () => {
      unsubscribe()
      sender.dispose()
      clients.delete(client)
    })
    ws.on('error', () => ws.terminate())
  }

  const heartbeat = setInterval(() => {
    const json = JSON.stringify({ type: 'heartbeat', seq: world.seq, at: iso(clock()) })
    for (const { socket } of clients) {
      if (socket.readyState === socket.OPEN) socket.send(json)
    }
  }, config.heartbeatMs)
  timers.add(heartbeat)

  if (config.faults.has('reset')) {
    const resetTimer = setInterval(() => {
      pendingReset = true
      for (const { socket } of clients) socket.terminate()
    }, config.resetIntervalMs)
    timers.add(resetTimer)
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, resolve)
  })
  sim.start()
  const port = (server.address() as AddressInfo).port

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    world,
    sim,
    commands,
    async close() {
      sim.stop()
      for (const timer of timers) {
        clearTimeout(timer)
        clearInterval(timer)
      }
      timers.clear()
      for (const { socket, sender } of clients) {
        sender.dispose()
        socket.terminate()
      }
      clients.clear()
      wss.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

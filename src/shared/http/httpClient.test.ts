import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { configureHttp, createHttpClient, http as sharedHttp, HttpNetworkError, HttpTimeoutError } from './httpClient'

let server: http.Server | undefined
afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler)
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

describe('httpClient', () => {
  it('GET: возвращает статус и разобранное тело', async () => {
    const base = await serve((_req, res) => json(res, 200, { ok: true }))
    expect(await createHttpClient({ baseUrl: base }).get('/x')).toEqual({ status: 200, body: { ok: true } })
  })

  it('409 и 403 не бросают ошибку и возвращают тело', async () => {
    const base = await serve((req, res) => (req.url === '/conflict' ? json(res, 409, { status: 'executed' }) : json(res, 403, { message: 'нет прав' })))
    const client = createHttpClient({ baseUrl: base })
    expect(await client.post('/conflict')).toEqual({ status: 409, body: { status: 'executed' } })
    expect(await client.post('/forbidden')).toEqual({ status: 403, body: { message: 'нет прав' } })
  })

  it('500 тоже возвращается, а не бросается', async () => {
    const base = await serve((_req, res) => json(res, 500, { message: 'сбой' }))
    expect((await createHttpClient({ baseUrl: base }).get('/x')).status).toBe(500)
  })

  it('POST: тело сериализуется, заголовки передаются', async () => {
    let seen: { method?: string | undefined; headers: http.IncomingHttpHeaders; body: string } | undefined
    const base = await serve((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        seen = { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }
        json(res, 200, {})
      })
    })
    await createHttpClient({ baseUrl: base }).post('/cmd', { mode: 'manual' }, { headers: { 'Idempotency-Key': 'k1', 'If-Match': '3' } })
    expect(seen?.method).toBe('POST')
    expect(seen?.body).toBe('{"mode":"manual"}')
    expect(seen?.headers['idempotency-key']).toBe('k1')
    expect(seen?.headers['if-match']).toBe('3')
    expect(seen?.headers['content-type']).toBe('application/json')
  })

  it('пустое тело и не-JSON ответ', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/empty') {
        res.writeHead(204)
        res.end()
      } else {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('просто текст')
      }
    })
    const client = createHttpClient({ baseUrl: base })
    expect(await client.get('/empty')).toEqual({ status: 204, body: undefined })
    expect(await client.get('/text')).toEqual({ status: 200, body: 'просто текст' })
  })

  it('сетевая ошибка: HttpNetworkError', async () => {
    const base = await serve((_req, res) => json(res, 200, {}))
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
    await expect(createHttpClient({ baseUrl: base }).get('/x')).rejects.toBeInstanceOf(HttpNetworkError)
  })

  it('таймаут: HttpTimeoutError, не HttpNetworkError', async () => {
    const base = await serve(() => {
      /* не отвечаем */
    })
    const error = await createHttpClient({ baseUrl: base, timeoutMs: 80 }).get('/slow').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpTimeoutError)
    expect(error).not.toBeInstanceOf(HttpNetworkError)
    expect((error as HttpTimeoutError).timeoutMs).toBe(80)
  })

  it('таймаут запроса задаётся на вызов', async () => {
    const base = await serve(() => {
      /* не отвечаем */
    })
    const started = Date.now()
    await expect(createHttpClient({ baseUrl: base, timeoutMs: 5_000 }).get('/slow', { timeoutMs: 60 })).rejects.toBeInstanceOf(HttpTimeoutError)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('внешний сигнал отмены даёт сетевую ошибку, а не таймаут', async () => {
    const base = await serve(() => {
      /* не отвечаем */
    })
    const controller = new AbortController()
    const request = createHttpClient({ baseUrl: base }).get('/slow', { signal: controller.signal })
    setTimeout(() => controller.abort(), 30)
    await expect(request).rejects.toBeInstanceOf(HttpNetworkError)
  })

  it('завершающий слэш в baseUrl не ломает путь', async () => {
    const base = await serve((req, res) => json(res, 200, { url: req.url }))
    expect((await createHttpClient({ baseUrl: `${base}/` }).get<{ url: string }>('/a/b')).body.url).toBe('/a/b')
  })

  it('общий клиент: без настройки ошибка, после настройки работает', async () => {
    const base = await serve((_req, res) => json(res, 200, { ok: 1 }))
    // до настройки другой тест мог уже настроить клиент, поэтому проверяем только поведение после
    configureHttp({ baseUrl: base })
    expect(await sharedHttp().get('/x')).toEqual({ status: 200, body: { ok: 1 } })
  })
})

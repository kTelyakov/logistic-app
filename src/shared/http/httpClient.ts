/** Сеть недоступна или запрос оборвался (сервер мог и успеть обработать его). */
export class HttpNetworkError extends Error {
  override readonly name = 'HttpNetworkError'
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message)
  }
}

/** Ответ не пришёл за отведённое время. Команда могла выполниться на сервере: повторять с тем же ключом. */
export class HttpTimeoutError extends Error {
  override readonly name = 'HttpTimeoutError'
  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(`Нет ответа за ${timeoutMs} мс: ${url}`)
  }
}

export interface HttpResponse<T> {
  status: number
  body: T
}

export interface RequestOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

export interface HttpClientConfig {
  /** Адрес сервера без завершающего слэша; пустая строка означает тот же origin. */
  baseUrl: string
  timeoutMs?: number
  /** Подмена fetch для тестов. */
  fetchImpl?: typeof fetch
}

export interface HttpClient {
  get<T>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse<T>>
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Единственная точка HTTP. Не бросает исключение на 4xx и 5xx: тело ответа 409 содержит актуальное
 * состояние, и вызывающему оно нужно. Сетевая ошибка и таймаут различимы по классу ошибки.
 */
export function createHttpClient(config: HttpClientConfig): HttpClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const doFetch = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  async function request<T>(method: string, path: string, body: unknown, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const url = `${baseUrl}${path}`
    const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout

    const headers: Record<string, string> = { ...options.headers }
    let payload: string | undefined
    if (body !== undefined) {
      payload = JSON.stringify(body)
      headers['content-type'] ??= 'application/json'
    }

    let response: Response
    try {
      const init: RequestInit = { method, headers, signal }
      if (payload !== undefined) init.body = payload
      response = await doFetch(url, init)
    } catch (error) {
      if (timeout.aborted) throw new HttpTimeoutError(url, timeoutMs)
      throw new HttpNetworkError(error instanceof Error ? error.message : String(error), url)
    }

    try {
      const text = await response.text()
      const parsed: unknown = text === '' ? undefined : parseBody(text, response.headers.get('content-type'))
      return { status: response.status, body: parsed as T }
    } catch (error) {
      if (timeout.aborted) throw new HttpTimeoutError(url, timeoutMs)
      throw new HttpNetworkError(error instanceof Error ? error.message : String(error), url)
    }
  }

  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body, options),
  }
}

function parseBody(text: string, contentType: string | null): unknown {
  if (contentType?.includes('json')) return JSON.parse(text)
  return text
}

let shared: HttpClient | undefined

/** Настраивает общий клиент. Вызывается один раз при старте (и в воркере: у него свой экземпляр). */
export function configureHttp(config: HttpClientConfig): void {
  shared = createHttpClient(config)
}

/** Общий клиент: слои `api` модулей ходят в сеть только через него. */
export function http(): HttpClient {
  if (!shared) throw new Error('HTTP-клиент не настроен: вызовите configureHttp()')
  return shared
}

import { HttpNetworkError, HttpTimeoutError, type HttpResponse } from '@/shared/http'
import { createCommandKey } from './commandKey'

export interface AttemptPlan {
  /** Пауза перед попыткой. */
  delayMs: number
  timeoutMs: number
}

/**
 * Таймаут растёт: если сервер отвечает медленнее короткого таймаута, короткий повтор не дождётся ответа никогда.
 * Повтор с тем же ключом безопасен: сервер вернёт сохранённый ответ и не выполнит команду второй раз.
 */
export const DEFAULT_ATTEMPTS: readonly AttemptPlan[] = [
  { delayMs: 0, timeoutMs: 2_000 },
  { delayMs: 300, timeoutMs: 5_000 },
  { delayMs: 1_000, timeoutMs: 10_000 },
]

/** Ни одна попытка не дала ответа: команда могла выполниться на сервере. */
export class CommandOutcomeUnknownError extends Error {
  override readonly name = 'CommandOutcomeUnknownError'
  constructor(
    readonly key: string,
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(`Исход команды неизвестен после ${attempts} попыток`)
  }
}

export interface AttemptInfo {
  key: string
  timeoutMs: number
  /** Номер попытки с единицы. */
  attempt: number
}

export interface SendResult<T> {
  response: HttpResponse<T>
  key: string
  attempts: number
}

export interface SendOptions {
  attempts?: readonly AttemptPlan[]
  /** Готовый ключ (тесты); по умолчанию создаётся новый. */
  key?: string
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isRetryable(error: unknown): boolean {
  return error instanceof HttpTimeoutError || error instanceof HttpNetworkError
}

/**
 * Отправляет команду с одним ключом на все попытки. Повторяет таймаут, сетевую ошибку и ответ 5xx.
 * Ответы 2xx, 400, 403, 404 и 409 возвращаются сразу: повтор их не изменит.
 */
export async function sendIdempotent<T>(send: (info: AttemptInfo) => Promise<HttpResponse<T>>, options: SendOptions = {}): Promise<SendResult<T>> {
  const plan = options.attempts ?? DEFAULT_ATTEMPTS
  const sleep = options.sleep ?? defaultSleep
  const key = options.key ?? createCommandKey()
  let lastError: unknown

  for (let index = 0; index < plan.length; index++) {
    const step = plan[index] as AttemptPlan
    if (step.delayMs > 0) await sleep(step.delayMs)
    try {
      const response = await send({ key, timeoutMs: step.timeoutMs, attempt: index + 1 })
      if (response.status < 500) return { response, key, attempts: index + 1 }
      lastError = new Error(`Ответ сервера ${response.status}`)
    } catch (error) {
      if (!isRetryable(error)) throw error
      lastError = error
    }
  }
  throw new CommandOutcomeUnknownError(key, plan.length, lastError)
}

import { PATHS, type WsMessage } from '@dispatch/contract'

export interface SocketHandlers {
  /** Сообщения нескольких событий WebSocket, склеенные в одну пачку. */
  onMessages(messages: WsMessage[]): void
  /** Соединение закрылось не по нашей инициативе (один вызов). */
  onClose(): void
}

export interface SocketHandle {
  close(): void
}

/** Сообщения, пришедшие подряд, сливаются в одну пачку: меньше событий и вызовов ядра. */
const COALESCE_MS = 4

export function toSocketUrl(baseUrl: string, since: number): string {
  const base = baseUrl === '' ? globalThis.location.href : baseUrl
  const url = new URL(PATHS.ws, base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('since', String(since))
  return url.toString()
}

export function openSocket(baseUrl: string, since: number, handlers: SocketHandlers): SocketHandle {
  const socket = new WebSocket(toSocketUrl(baseUrl, since))
  let pending: WsMessage[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let closedByUs = false
  let notified = false

  const flush = () => {
    timer = undefined
    if (pending.length === 0) return
    const batch = pending
    pending = []
    handlers.onMessages(batch)
  }

  socket.onmessage = (event: MessageEvent) => {
    try {
      pending.push(JSON.parse(String(event.data)) as WsMessage)
    } catch {
      return // сообщение не разобрать: пропуск вылечит дыра в seq
    }
    timer ??= setTimeout(flush, COALESCE_MS)
  }

  const notifyClosed = () => {
    if (timer !== undefined) clearTimeout(timer)
    flush()
    if (closedByUs || notified) return
    notified = true
    handlers.onClose()
  }
  socket.onclose = notifyClosed
  socket.onerror = () => {
    // за ошибкой следует close; на случай, если нет, закрываем сами
    try {
      socket.close()
    } catch {
      /* уже закрыт */
    }
  }

  return {
    close() {
      closedByUs = true
      if (timer !== undefined) clearTimeout(timer)
      pending = []
      try {
        socket.close()
      } catch {
        /* уже закрыт */
      }
    },
  }
}

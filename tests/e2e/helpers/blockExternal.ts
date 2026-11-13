import type { BrowserContext } from '@playwright/test'

export interface ExternalGuard {
  /** Адреса, к которым страница пыталась обратиться вне приложения и заглушки. */
  violations(): string[]
  /** Падает, если были обращения вовне. */
  assertNone(): void
}

/**
 * Перехватывает запросы страниц и воркеров контекста. Разрешены: адреса приложения и заглушки
 * (`allowedOrigins`), data: и blob:. Остальное блокируется и записывается как нарушение.
 */
export async function blockExternal(context: BrowserContext, allowedOrigins: string[]): Promise<ExternalGuard> {
  const allowed = new Set(allowedOrigins.map((o) => new URL(o).origin))
  const violations: string[] = []

  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (/^(data|blob|about):/.test(url)) return route.fallback()
    const parsed = new URL(url)
    if (allowed.has(parsed.origin)) return route.fallback()
    violations.push(url)
    return route.abort('blockedbyclient')
  })

  return {
    violations: () => [...violations],
    assertNone() {
      if (violations.length > 0) {
        throw new Error(`Обращения к внешним адресам (${violations.length}):\n${violations.map((u) => `  ${u}`).join('\n')}`)
      }
    },
  }
}

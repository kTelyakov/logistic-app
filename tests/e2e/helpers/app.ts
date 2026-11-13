import { expect, type Page } from '@playwright/test'
import { readScreen } from './state'

/** Ждёт, пока экран получит машины, пункты и хотя бы одно решение. */
export async function waitForData(app: Page, options: { decisions?: boolean } = {}): Promise<void> {
  const needDecisions = options.decisions ?? true
  await expect
    .poll(
      async () => {
        const screen = await readScreen(app)
        return screen.vehicles.length > 0 && screen.points.length > 0 && (!needDecisions || screen.decisions.length > 0)
      },
      { timeout: 20_000 },
    )
    .toBe(true)
}

export interface ConnectionHistory {
  /** Все состояния индикатора связи по порядку, без повторов подряд. */
  states(): Promise<string[]>
}

/** Записывает смены состояния индикатора связи (data-state) в самой странице. */
export async function recordConnectionStates(page: Page): Promise<ConnectionHistory> {
  await page.evaluate(() => {
    const w = window as unknown as { __connectionStates?: string[] }
    w.__connectionStates = []
    const read = () => document.querySelector('[data-testid="connection"]')?.getAttribute('data-state') ?? ''
    const push = () => {
      const value = read()
      const list = w.__connectionStates as string[]
      if (value && list[list.length - 1] !== value) list.push(value)
    }
    push()
    new MutationObserver(push).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'], childList: true })
  })
  return { states: () => page.evaluate(() => (window as unknown as { __connectionStates: string[] }).__connectionStates) }
}

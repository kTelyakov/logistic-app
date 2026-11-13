import type { Page } from '@playwright/test'
import type { RunningMock } from '../fixtures/mockProcess'
import { diffStates, formatDiffs, type Diff } from './diff'
import { readScreen } from './state'

export interface MatchOptions {
  /** Сколько ждать, пока экран догонит сервер. */
  timeoutMs?: number
  pollMs?: number
}

/**
 * Ставит симуляцию на паузу, ждёт, пока экран применит тот же seq, строго сравнивает его с
 * /debug/state и возобновляет симуляцию. Падает с описанием расхождения, если экран не сошёлся.
 * В живом режиме сравнивать нельзя: сервер меняется быстрее, чем экран успевает за ним.
 */
export async function expectScreenMatchesServer(page: Page, mock: RunningMock, options: MatchOptions = {}): Promise<void> {
  const { timeoutMs = 10_000, pollMs = 100 } = options
  await mock.pause()
  try {
    const diffs = await settle(page, mock, timeoutMs, pollMs)
    if (diffs.length > 0) throw new Error(formatDiffs(diffs))
  } finally {
    await mock.resume()
  }
}

/** Сравнивает один раз на уже замершем сервере; для тестов самой сверки. */
export async function compareOnce(page: Page, mock: RunningMock): Promise<Diff[]> {
  const [server, screen] = [await mock.debugState(), await readScreen(page)]
  return diffStates(screen, server)
}

async function settle(page: Page, mock: RunningMock, timeoutMs: number, pollMs: number): Promise<Diff[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const diffs = await compareOnce(page, mock)
    if (diffs.length === 0 || Date.now() >= deadline) return diffs
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

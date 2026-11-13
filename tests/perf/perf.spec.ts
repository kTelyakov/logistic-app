// make perf: экран на заглушке с LOAD=1000 на 10 минут; пишет perf/report.md.
import fs from 'node:fs'
import path from 'node:path'
import type { Browser, CDPSession, Page } from '@playwright/test'
import { expect, test } from '../e2e/fixtures'
import { average, fpsStats, growthPercent, longTasksPerMinute, sliceSeconds, type LongTask } from './metrics'
import { renderReport, type MemoryPoint, type PerfResult } from './report'

const LOAD = Number(process.env.PERF_LOAD ?? 1000)
const MINUTES = Number(process.env.PERF_MINUTES ?? 10)
const WARMUP_SECONDS = Number(process.env.PERF_WARMUP_SECONDS ?? 60)
const SAMPLE_EVERY_MS = 30_000
const REPORT = path.resolve(process.cwd(), 'perf/report.md')

// Окно решений за час заполнено заранее (середина смены): иначе за 10 минут растёт сама история, а не утечка
// PERF_NO_DECISIONS=1: новые решения не создаются (диагностика: отделить память ленты решений от остального)
test.use({ mockEnv: { LOAD: String(LOAD), PREFILL_DECISIONS: '360', ...(process.env.PERF_NO_DECISIONS ? { DECISION_MIN_MS: '3600000', DECISION_MAX_MS: '3600001' } : {}) } })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function installCollector(app: Page): Promise<void> {
  await app.evaluate(() => {
    const w = window as unknown as { __perf: { t0: number; fps: number[]; longTasks: Array<{ at: number; duration: number }>; draws0: number } }
    const t0 = performance.now()
    const state = { t0, fps: [] as number[], longTasks: [] as Array<{ at: number; duration: number }>, draws0: window.__dispatch?.map()?.renderer?.frames ?? 0 }
    w.__perf = state
    const frame = (now: number) => {
      const second = Math.floor((now - t0) / 1000)
      while (state.fps.length <= second) state.fps.push(0)
      state.fps[second] = (state.fps[second] ?? 0) + 1
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push({ at: entry.startTime - t0, duration: entry.duration })
    }).observe({ type: 'longtask', buffered: false })
  })
}

/**
 * Доступ к воркеру через CDP: у воркера нет performance.memory, а Playwright не даёт CDP-сессию воркера.
 * Подключаемся к цели воркера на уровне браузера и шлём команды через Target.sendMessageToTarget.
 */
async function attachWorker(browser: Browser): Promise<{ call(method: string): Promise<{ result?: Record<string, number> }> } | undefined> {
  const root = await browser.newBrowserCDPSession()
  const { targetInfos } = await root.send('Target.getTargets')
  const worker = targetInfos.find((t) => t.type === 'worker' && /sync\.worker/.test(t.url))
  if (!worker) return undefined
  const { sessionId } = await root.send('Target.attachToTarget', { targetId: worker.targetId, flatten: false })
  const answers = new Map<number, { result?: Record<string, number> }>()
  root.on('Target.receivedMessageFromTarget', (event) => {
    const message = JSON.parse(event.message) as { id?: number; result?: Record<string, number> }
    if (message.id !== undefined) answers.set(message.id, message)
  })
  let nextId = 0
  return {
    async call(method: string) {
      const id = ++nextId
      await root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method }) })
      for (let i = 0; i < 100 && !answers.has(id); i++) await sleep(30)
      return answers.get(id) ?? {}
    },
  }
}

type WorkerCdp = Awaited<ReturnType<typeof attachWorker>>

/** Куча и буферы (ArrayBuffer) после принудительной сборки мусора, основной поток и воркер. */
async function sampleMemory(cdp: CDPSession, worker: WorkerCdp, at: number, repeats = 1): Promise<MemoryPoint> {
  const mains: number[] = []
  const workers: number[] = []
  const nodes: number[] = []
  for (let i = 0; i < repeats; i++) {
    await cdp.send('HeapProfiler.collectGarbage')
    const main = await cdp.send('Runtime.getHeapUsage')
    mains.push(main.usedSize + ((main as { backingStorageSize?: number }).backingStorageSize ?? 0))
    nodes.push(((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'Nodes')?.value ?? 0))
    if (worker) {
      await worker.call('HeapProfiler.collectGarbage')
      const usage = (await worker.call('Runtime.getHeapUsage')).result ?? {}
      workers.push((usage.usedSize ?? 0) + (usage.backingStorageSize ?? 0))
    }
    if (i < repeats - 1) await sleep(1_000)
  }
  return { at, mainBytes: average(mains), workerBytes: workers.length ? average(workers) : 0, nodes: Math.round(average(nodes)) }
}

test(`перф: LOAD=${LOAD}, ${MINUTES} мин`, async ({ app, mock, browser }) => {
  test.setTimeout((MINUTES + 8) * 60_000)
  await expect.poll(() => app.evaluate(() => window.__dispatch?.map()?.renderer?.instances ?? 0), { timeout: 60_000 }).toBeGreaterThanOrEqual(LOAD)

  const environment = await app.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'неизвестно'
  })
  const cdp = await app.context().newCDPSession(app)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')

  const worker = await attachWorker(browser)
  expect(worker, 'воркер синхронизации найден').toBeDefined()
  await installCollector(app)
  const startedAt = Date.now()
  const startedIso = new Date(startedAt).toISOString()
  const elapsed = () => (Date.now() - startedAt) / 1000

  // Прогрев, затем опорная точка памяти
  await sleep(WARMUP_SECONDS * 1000)
  const base = await sampleMemory(cdp, worker, elapsed(), 3)
  const series: MemoryPoint[] = [base]
  const drawsAtBase = await app.evaluate(() => window.__dispatch?.map()?.renderer?.frames ?? 0)
  const baseAt = elapsed()

  // Основная часть прогона с периодическим замером памяти
  const end = startedAt + MINUTES * 60_000
  let nextSample = Date.now() + SAMPLE_EVERY_MS
  while (Date.now() < end - 15_000) {
    await sleep(Math.min(5_000, Math.max(100, nextSample - Date.now())))
    if (Date.now() >= nextSample && Date.now() < end - 20_000) {
      series.push(await sampleMemory(cdp, worker, elapsed(), 1))
      nextSample = Date.now() + SAMPLE_EVERY_MS
    }
  }
  const final = await sampleMemory(cdp, worker, elapsed(), 3)
  series.push(final)
  const runSeconds = elapsed()

  const collected = await app.evaluate(() => {
    const p = (window as unknown as { __perf: { fps: number[]; longTasks: Array<{ at: number; duration: number }> } }).__perf
    return { fps: p.fps, longTasks: p.longTasks, draws: window.__dispatch?.map()?.renderer?.frames ?? 0 }
  })

  const perSecond = collected.fps.slice(0, -1) // последняя секунда неполная
  const fps = fpsStats(sliceSeconds(perSecond, WARMUP_SECONDS))
  const fpsWarmup = WARMUP_SECONDS > 0 ? fpsStats(sliceSeconds(perSecond, 0, WARMUP_SECONDS)) : undefined
  const minutes = longTasksPerMinute(collected.longTasks as LongTask[], MINUTES)
  const warmMinutes = Math.ceil(WARMUP_SECONDS / 60)
  const afterWarmup = minutes.slice(warmMinutes)
  const worstMinute = Math.max(0, ...afterWarmup.map((m) => m.longTasks))

  // После принудительной сборки мусора остаётся удерживаемая память плюс то, что живо в момент замера (например,
  // дерево виртуальных узлов Vue при перерисовке ленты решений: около 1,2 МБ на мгновение). Временные данные только
  // добавляют, поэтому удерживаемую память описывает минимум замеров. Проверено: без новых решений пиков нет, куча ровная.
  const total = (p: MemoryPoint) => p.mainBytes + p.workerBytes
  const trendBase = Math.min(...series.slice(0, 5).map(total))
  const trendEnd = Math.min(...series.slice(-5).map(total))
  const growth = growthPercent(trendBase, trendEnd)
  const software = /SwiftShader|llvmpipe|Software/i.test(environment)

  const result: PerfResult = {
    environment: {
      browser: `${browser.browserType().name()} ${browser.version()}${process.env.E2E_CHANNEL ? ` (канал ${process.env.E2E_CHANNEL})` : ''}`,
      renderer: environment.slice(0, 90),
      software,
      platform: `${process.platform} ${process.arch}, Node ${process.version}`,
      load: LOAD,
      minutes: MINUTES,
      warmupSeconds: WARMUP_SECONDS,
      startedAt: startedIso,
    },
    minutes,
    fps,
    fpsWarmup,
    drawsPerSecond: (collected.draws - drawsAtBase) / Math.max(1, runSeconds - baseAt),
    memory: { series, base, end: final, elapsedSeconds: runSeconds - baseAt, trendBase, trendEnd },
    verdicts: [
      { name: 'Долгие задачи (>50 мс) в минуту, после прогрева', target: 'не больше 1', actual: `максимум ${worstMinute}`, ok: worstMinute <= 1 },
      { name: 'Кадров в секунду, среднее', target: 'не меньше 30', actual: fps.average.toFixed(1), ok: fps.average >= 30 },
      { name: 'Кадров в секунду, 5-й перцентиль', target: 'не меньше 30', actual: fps.p5.toFixed(1), ok: fps.p5 >= 30 },
      { name: 'Рост JS-кучи после прогрева (основной поток и воркер, минимум пяти замеров в начале и в конце)', target: 'не больше 10 %', actual: `${growth.toFixed(1)} %`, ok: growth <= 10 },
    ],
  }

  // Отчёт пишется всегда, в том числе при невыполнении целей
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, renderReport(result))
  test.info().annotations.push({ type: 'отчёт', description: path.relative(process.cwd(), REPORT) })
  void mock

  for (const verdict of result.verdicts) expect(verdict.ok, `${verdict.name}: ${verdict.actual} (цель ${verdict.target})`).toBe(true)
})

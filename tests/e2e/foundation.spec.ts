// Проверка самой основы e2e: фикстуры, сверка с /debug/state, защита от внешних запросов.
// Сценарии по требованиям задания (B1–B18) лежат в tests/e2e/scenarios и опираются на эти хелперы.
import { startMockProcess, type MockEnv } from './fixtures/mockProcess'
import { expect, test } from './fixtures'
import { compareOnce, expectScreenMatchesServer } from './helpers/expectScreenMatchesServer'
import { readScreen } from './helpers/state'

// Основа проверяется на эталонном экране: настоящий экран сам проверяется в screen.spec.ts
test.use({ appKind: 'reference' })

const FAST_DECISIONS: MockEnv = { DECISION_MIN_MS: '200', DECISION_MAX_MS: '400', EXECUTE_AFTER_MS: '4000' }

const startedUrls: string[] = []
test.afterAll(async () => {
  // Фикстура останавливает заглушку: после теста порт не отвечает
  for (const url of startedUrls) {
    await expect(fetch(`${url}/debug/state`)).rejects.toThrow()
  }
})

async function waitUntil(probe: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error('waitUntil: условие не выполнилось')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

// --- A1: фикстура запускает заглушку с нужным окружением ---

const ENVIRONMENTS: Array<[string, MockEnv, { load: number; faults: string[]; role: string; seed: number }]> = [
  ['без окружения', {}, { load: 150, faults: [], role: 'dispatcher', seed: 1 }],
  ['slow + observer', { FAULTS: 'slow', ROLE: 'observer' }, { load: 150, faults: ['slow'], role: 'observer', seed: 1 }],
  ['LOAD', { LOAD: '40' }, { load: 40, faults: [], role: 'dispatcher', seed: 1 }],
  [
    'drop,dup,reorder с seed',
    { FAULTS: 'drop,dup,reorder', FAULT_SEED: '7' },
    { load: 150, faults: ['drop', 'dup', 'reorder'], role: 'dispatcher', seed: 7 },
  ],
]

for (const [name, env, expected] of ENVIRONMENTS) {
  test.describe(`A1: окружение «${name}»`, () => {
    test.use({ mockEnv: env })
    test('заглушка стартует с нужной конфигурацией', async ({ mock }) => {
      startedUrls.push(mock.url)
      const state = await mock.debugState()
      expect(state.config).toEqual(expected)
      expect(state.vehicles).toHaveLength(expected.load)
    })
  })
}

test('A1: переменные окружения разработчика не просачиваются в заглушку', async () => {
  const previous = process.env.FAULTS
  process.env.FAULTS = 'slow'
  try {
    const mock = await startMockProcess({})
    startedUrls.push(mock.url)
    try {
      expect((await mock.debugState()).config.faults).toEqual([])
    } finally {
      await mock.stop()
    }
  } finally {
    if (previous === undefined) delete process.env.FAULTS
    else process.env.FAULTS = previous
  }
})

// --- A4: изоляция ---

test('A4: каждый тест получает свежую заглушку на своём порту', async ({ mock }) => {
  startedUrls.push(mock.url)
  const before = await mock.debugState()
  const point = before.points[0]!
  const res = await fetch(`${mock.url}/api/points/${point.point_id}/mode`, {
    method: 'POST',
    headers: { 'Idempotency-Key': 'iso-1', 'If-Match': String((await (await fetch(`${mock.url}/api/snapshot`)).json()).points[0].version), 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'manual' }),
  })
  expect(res.status).toBe(200)
  expect(Object.keys((await mock.debugState()).commands)).toEqual(['iso-1'])

  const other = await startMockProcess()
  startedUrls.push(other.url)
  try {
    expect(other.port).not.toBe(mock.port)
    const otherState = await other.debugState()
    expect(otherState.commands).toEqual({})
    expect(otherState.points.find((p) => p.point_id === point.point_id)?.mode).toBe('auto')
  } finally {
    await other.stop()
  }
})

test('A4: следующий тест не видит команд предыдущего', async ({ mock }) => {
  startedUrls.push(mock.url)
  expect((await mock.debugState()).commands).toEqual({})
})

// --- A2: debugState() не искажается отказами ---

test.describe('A2: debugState при FAULTS=drop,dup,reorder', () => {
  test.use({ mockEnv: { FAULTS: 'drop,dup,reorder', FAULT_RATE: '0.3', FAULT_SEED: '4' } })

  test('истинное состояние совпадает со снимком, а поток искажён', async ({ mock }) => {
    startedUrls.push(mock.url)
    const socket = new WebSocket(`${mock.url.replace('http', 'ws')}/ws?since=0`)
    const seqs: number[] = []
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; seq?: number }
      if (message.type !== 'heartbeat' && message.seq !== undefined) seqs.push(message.seq)
    }
    await waitUntil(async () => seqs.length > 250)
    await mock.pause()
    socket.close()

    const unique = [...new Set(seqs)].sort((a, b) => a - b)
    expect(unique.some((s, i) => i > 0 && s - unique[i - 1]! > 1), 'нет пропусков').toBe(true)
    expect(seqs.length, 'нет повторов').toBeGreaterThan(unique.length)
    expect(seqs.some((s, i) => i > 0 && s < seqs[i - 1]!), 'нет перестановок').toBe(true)

    const truth = await mock.debugState()
    const snapshot = (await (await fetch(`${mock.url}/api/snapshot`)).json()) as typeof truth
    expect(truth.seq).toBe(snapshot.seq)
    expect(truth.vehicles).toEqual(snapshot.vehicles)
    expect(truth.points).toEqual(snapshot.points)
    expect(truth.decisions).toEqual(snapshot.decisions)
  })
})

// --- A3: воспроизводимость ---

test('A3: одинаковый FAULT_SEED даёт одинаковые потерянные seq', async () => {
  const env: MockEnv = { FAULTS: 'drop', FAULT_RATE: '0.2', FAULT_SEED: '9' }
  const [a, b] = await Promise.all([startMockProcess(env), startMockProcess(env)])
  startedUrls.push(a.url, b.url)
  try {
    const collect = async (url: string): Promise<Set<number>> => {
      const seen = new Set<number>()
      const socket = new WebSocket(`${url.replace('http', 'ws')}/ws?since=0`)
      socket.onmessage = (event) => {
        const m = JSON.parse(String(event.data)) as { type: string; seq?: number }
        if (m.type !== 'heartbeat' && m.seq !== undefined) seen.add(m.seq)
      }
      await waitUntil(async () => seen.size > 250)
      socket.close()
      return seen
    }
    const [seenA, seenB] = await Promise.all([collect(a.url), collect(b.url)])
    const top = Math.min(Math.max(...seenA), Math.max(...seenB))
    const missing = (seen: Set<number>) => Array.from({ length: top }, (_, i) => i + 1).filter((s) => !seen.has(s))
    expect(missing(seenA).length).toBeGreaterThan(10)
    expect(missing(seenA)).toEqual(missing(seenB))
  } finally {
    await Promise.all([a.stop(), b.stop()])
  }
})

test('A3: другой FAULT_SEED даёт другие потерянные seq', async () => {
  const collectMissing = async (seed: string): Promise<number[]> => {
    const mock = await startMockProcess({ FAULTS: 'drop', FAULT_RATE: '0.2', FAULT_SEED: seed })
    startedUrls.push(mock.url)
    try {
      const seen = new Set<number>()
      const socket = new WebSocket(`${mock.url.replace('http', 'ws')}/ws?since=0`)
      socket.onmessage = (event) => {
        const m = JSON.parse(String(event.data)) as { type: string; seq?: number }
        if (m.type !== 'heartbeat' && m.seq !== undefined) seen.add(m.seq)
      }
      await waitUntil(async () => seen.size > 200)
      socket.close()
      return Array.from({ length: 150 }, (_, i) => i + 1).filter((s) => !seen.has(s))
    } finally {
      await mock.stop()
    }
  }
  expect(await collectMissing('1')).not.toEqual(await collectMissing('2'))
})

// --- A5: сверка проходит, когда экран совпадает с сервером ---

test('A5: чтение экрана отдаёт seq, машины, пункты, очереди и решения', async ({ app, mock }) => {
  startedUrls.push(mock.url)
  await waitUntil(async () => (await readScreen(app)).decisions.length > 0)
  const screen = await readScreen(app)
  expect(screen.seq).toBeGreaterThan(0)
  expect(screen.vehicles).toHaveLength(150)
  expect(screen.points).toHaveLength(6)
  expect(screen.points.some((p) => p.queue.length > 0)).toBe(true)
  await expect(app.getByTestId('connection')).toHaveText('подключено')
})

test.describe('A5: без отказов', () => {
  test.use({ mockEnv: FAST_DECISIONS })
  test('экран совпадает с /debug/state, сверку можно повторять', async ({ app, mock }) => {
    startedUrls.push(mock.url)
    await waitUntil(async () => (await readScreen(app)).decisions.length > 0)
    await expectScreenMatchesServer(app, mock)
    expect((await mock.debugState()).paused, 'после сверки симуляция возобновлена').toBe(false)
    await app.waitForTimeout(1_500)
    await expectScreenMatchesServer(app, mock)
  })
})

test.describe('A5: FAULTS=drop,dup,reorder', () => {
  test.use({ mockEnv: { ...FAST_DECISIONS, FAULTS: 'drop,dup,reorder', FAULT_RATE: '0.05', FAULT_SEED: '3' } })
  test('экран догоняет сервер через повторный снимок, сверка проходит', async ({ app, mock }) => {
    startedUrls.push(mock.url)
    await app.waitForTimeout(6_000)
    await expectScreenMatchesServer(app, mock, { timeoutMs: 15_000 })
    await app.waitForTimeout(2_000)
    await expectScreenMatchesServer(app, mock, { timeoutMs: 15_000 })
  })
})

// --- A7: негативный контроль ---

test.describe('A7: негативный контроль сверки', () => {
  test.use({ mockEnv: FAST_DECISIONS })

  test('сверка падает на испорченном экране и называет поле', async ({ app, mock }) => {
    startedUrls.push(mock.url)
    await waitUntil(async () => {
      const s = await readScreen(app)
      return s.decisions.length > 0 && s.points.some((p) => p.queue.length > 0)
    })
    await mock.pause()
    await waitUntil(async () => (await compareOnce(app, mock)).length === 0)

    const corrupt = async (mutate: () => void, expectedWhere: RegExp) => {
      await app.evaluate(mutate)
      const diffs = await compareOnce(app, mock)
      expect(diffs.map((d) => d.where).join('\n')).toMatch(expectedWhere)
    }

    // 1. статус решения в DOM
    await corrupt(() => {
      document.querySelector('[data-testid="decision"]')!.setAttribute('data-status', 'executed-by-mistake')
    }, /decision d-\d+ status/)
    // 2. элемент очереди в DOM
    await corrupt(() => {
      document.querySelector('[data-testid="queue-item"]')!.setAttribute('data-wait-s', '99999')
    }, /point p-\d+ queue\[\d+\] wait_s/)
    // 3. режим пункта в DOM
    await corrupt(() => {
      document.querySelector('[data-testid="point"]')!.setAttribute('data-mode', 'manual-by-mistake')
    }, /point p-\d+ mode/)
    // 4. машина в хуке
    await corrupt(() => {
      const hook = (window as unknown as { __dispatch: { vehicles(): Array<{ x_m: number }> } }).__dispatch
      const original = hook.vehicles
      hook.vehicles = () => original().map((v, i) => (i === 0 ? { ...v, x_m: v.x_m + 1 } : v))
    }, /vehicle v-\d+ x_m/)
  })

  test('expectScreenMatchesServer падает с описанием расхождения и возобновляет сервер', async ({ app, mock }) => {
    startedUrls.push(mock.url)
    await waitUntil(async () => (await readScreen(app)).decisions.length > 0)
    await expectScreenMatchesServer(app, mock)

    // Порча в хуке переживает перерисовку живого экрана
    await app.evaluate(() => {
      const hook = (window as unknown as { __dispatch: { vehicles(): Array<{ state: string }> } }).__dispatch
      const original = hook.vehicles
      hook.vehicles = () => original().map((v, i) => (i === 0 ? { ...v, state: 'испорчено' } : v))
    })

    const error = await expectScreenMatchesServer(app, mock, { timeoutMs: 800 }).then(
      () => undefined,
      (e: Error) => e,
    )
    expect(error, 'сверка должна упасть').toBeDefined()
    expect(error!.message).toContain('Экран расходится с /debug/state')
    expect(error!.message).toMatch(/vehicle v-\d+ state: экран="испорчено" сервер="/)
    expect((await mock.debugState()).paused, 'после падения симуляция возобновлена').toBe(false)
  })
})

// --- A6: внешние запросы ---

test.describe('A6: защита от внешних запросов', () => {
  test.use({ allowExternal: true })
  test('обращения к внешним адресам блокируются и записываются', async ({ app, externalGuard }) => {
    await app.evaluate(async () => {
      await fetch('https://fonts.example.invalid/css?family=Roboto').catch(() => null)
      const img = new Image()
      img.src = 'https://tile.example.invalid/1/2/3.png'
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(externalGuard.violations()).toEqual(
      expect.arrayContaining([
        'https://fonts.example.invalid/css?family=Roboto',
        'https://tile.example.invalid/1/2/3.png',
      ]),
    )
    expect(() => externalGuard.assertNone()).toThrow(/fonts\.example\.invalid/)
  })
})

test.describe('A6: защита включена по умолчанию', () => {
  test.fail()
  test('тест с обращением вовне считается проваленным', async ({ app }) => {
    await app.evaluate(async () => {
      await fetch('https://cdn.example.invalid/lib.js').catch(() => null)
    })
  })
})

test('A6: приложение, заглушка, data: и blob: разрешены', async ({ app, mock, externalGuard }) => {
  startedUrls.push(mock.url)
  await app.evaluate(async (api) => {
    await fetch(`${api}/api/me`)
    await fetch('data:text/plain,hello')
    await fetch(URL.createObjectURL(new Blob(['x'])))
  }, mock.url)
  expect(externalGuard.violations()).toEqual([])
})

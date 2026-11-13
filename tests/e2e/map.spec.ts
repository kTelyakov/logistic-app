// Схема площадки на настоящем экране: WebGL2, цвета по состоянию, устаревшие машины, потеря контекста, выбор.
import type { Page } from '@playwright/test'
import { STATE_STYLES } from '../../src/modules/site-map/helpers/colors'
import type { MockEnv } from './fixtures/mockProcess'
import { expect, test } from './fixtures'
import { readScreen } from './helpers/state'

type Rgba = [number, number, number, number]

interface Probe {
  id: string
  state: string
  rgba: Rgba
}

async function waitForMap(app: Page, minVehicles = 1): Promise<void> {
  await expect
    .poll(async () => app.evaluate(() => window.__dispatch?.map()?.renderer?.instances ?? 0), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(minVehicles)
}

/** Читает цвет пикселя GPU в центре маркеров машин, у которых в радиусе 16 пикселей нет соседей. */
async function probeIsolated(app: Page): Promise<Probe[]> {
  return app.evaluate(() => {
    const hook = window.__dispatch
    const map = hook?.map()
    if (!hook || !map) return []
    const vehicles = hook.vehicles()
    const placed = vehicles.flatMap((v) => {
      const pos = map.vehicleScreenPosition(v.vehicle_id)
      return pos ? [{ v, pos }] : []
    })
    const result: Array<{ id: string; state: string; rgba: [number, number, number, number] }> = []
    for (const a of placed) {
      const lonely = placed.every((b) => b === a || Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) > 16)
      if (!lonely) continue
      const rgba = map.pixelAtVehicle(a.v.vehicle_id)
      if (rgba) result.push({ id: a.v.vehicle_id, state: a.v.state, rgba })
    }
    return result
  })
}

const expectedRgb = (state: string): [number, number, number] => {
  const style = STATE_STYLES.find((s) => s.state === state)
  if (!style) throw new Error(`нет стиля для ${state}`)
  return [Math.round(style.rgb[0] * 255), Math.round(style.rgb[1] * 255), Math.round(style.rgb[2] * 255)]
}

const close = (actual: number[], expected: number[], tolerance = 8) => expected.every((e, i) => Math.abs((actual[i] as number) - e) <= tolerance)

const SPARSE: MockEnv = { LOAD: '60', SPEED_SCALE: '15', SERVICE_MIN_MS: '1500', SERVICE_MAX_MS: '2500' }

test.describe('схема: WebGL2', () => {
  test.use({ mockEnv: SPARSE })

  test('рисует на WebGL2, число экземпляров равно числу машин', async ({ app }) => {
    await waitForMap(app, 60)
    const map = await app.evaluate(() => window.__dispatch?.map()?.renderer)
    expect(map?.backend).toBe('webgl2')
    expect(map?.contextLost).toBe(false)
    expect((await readScreen(app)).vehicles.length).toBe(60)
    expect(await app.evaluate(() => window.__dispatch?.map()?.renderer?.instances)).toBe(60)
    await expect(app.getByTestId('map-legend')).toContainText('Нет данных больше 30 с')
  })

  test('цвет машины в GPU соответствует её состоянию', async ({ app }) => {
    await waitForMap(app, 60)
    // Ждём, пока машины окажутся хотя бы в трёх разных состояниях
    await expect
      .poll(async () => new Set((await readScreen(app)).vehicles.map((v) => v.state)).size, { timeout: 40_000 })
      .toBeGreaterThanOrEqual(3)

    const checked = new Set<string>()
    for (let attempt = 0; attempt < 8 && checked.size < 3; attempt++) {
      for (const probe of await probeIsolated(app)) {
        const [r, g, b, a] = probe.rgba
        if (a < 250) continue // край маркера: не центр
        expect(close([r, g, b], expectedRgb(probe.state)), `${probe.id} (${probe.state}): пиксель ${[r, g, b]} вместо ${expectedRgb(probe.state)}`).toBe(true)
        checked.add(probe.state)
      }
      if (checked.size < 3) await app.waitForTimeout(500)
    }
    expect(checked.size, `проверено состояний: ${[...checked].join(', ')}`).toBeGreaterThanOrEqual(3)
  })

  test('разные состояния дают разные цвета', async ({ app }) => {
    await waitForMap(app, 60)
    await expect.poll(async () => new Set((await readScreen(app)).vehicles.map((v) => v.state)).size, { timeout: 40_000 }).toBeGreaterThanOrEqual(2)
    const byState = new Map<string, Rgba>()
    for (let attempt = 0; attempt < 8 && byState.size < 2; attempt++) {
      for (const probe of await probeIsolated(app)) if (probe.rgba[3] >= 250) byState.set(probe.state, probe.rgba)
      if (byState.size < 2) await app.waitForTimeout(500)
    }
    const colors = [...byState.values()].map((c) => c.slice(0, 3).join(','))
    expect(new Set(colors).size).toBe(colors.length)
    expect(colors.length).toBeGreaterThanOrEqual(2)
  })
})

test.describe('схема: устаревшие машины', () => {
  // Каждая пятая машина молчит: её last_seen остаётся на моменте старта
  test.use({ mockEnv: { LOAD: '40', FAULTS: 'stale', STALE_SILENT_MS: '600000', STALE_ACTIVE_MS: '1' } })

  test('молчащая машина показана приглушённой не раньше 30 секунд по времени сервера', async ({ app }) => {
    test.setTimeout(75_000)
    await waitForMap(app, 40)
    const alphaOf = (id: string) => app.evaluate((vehicleId) => window.__dispatch?.map()?.pixelAtVehicle(vehicleId)?.[3] ?? -1, id)

    // v-01 из молчащей группы, v-02 живая. Сначала обе яркие
    await expect.poll(() => alphaOf('v-02'), { timeout: 5_000 }).toBeGreaterThanOrEqual(250)
    expect(await alphaOf('v-01'), 'до 30 секунд молчащая ещё не устарела').toBeGreaterThanOrEqual(250)

    // После порога молчащая приглушена (альфа около 0,55), живая по-прежнему яркая
    await expect.poll(() => alphaOf('v-01'), { timeout: 45_000, intervals: [1_000] }).toBeLessThan(200)
    expect(await alphaOf('v-02')).toBeGreaterThanOrEqual(250)
    // Машина осталась на схеме
    expect(await app.evaluate(() => window.__dispatch?.map()?.renderer?.instances)).toBe(40)
  })
})

test.describe('схема: потеря контекста', () => {
  test.use({ mockEnv: SPARSE })

  test('контекст потерян и восстановлен без перезагрузки страницы', async ({ app }) => {
    await waitForMap(app, 60)
    await app.evaluate(() => {
      ;(window as unknown as { __marker: number }).__marker = 42
    })
    const framesBefore = await app.evaluate(() => window.__dispatch?.map()?.renderer?.frames ?? 0)

    expect(await app.evaluate(() => window.__dispatch?.map()?.loseContext())).toBe(true)
    await expect(app.getByTestId('map-context-lost')).toBeVisible({ timeout: 5_000 })
    expect(await app.evaluate(() => window.__dispatch?.map()?.renderer?.contextLost)).toBe(true)

    expect(await app.evaluate(() => window.__dispatch?.map()?.restoreContext())).toBe(true)
    await expect(app.getByTestId('map-context-lost')).toBeHidden({ timeout: 8_000 })
    await expect.poll(() => app.evaluate(() => window.__dispatch?.map()?.renderer?.restores ?? 0), { timeout: 8_000 }).toBe(1)
    await expect.poll(() => app.evaluate(() => window.__dispatch?.map()?.renderer?.frames ?? 0), { timeout: 8_000 }).toBeGreaterThan(framesBefore)
    expect(await app.evaluate(() => window.__dispatch?.map()?.renderer?.instances)).toBe(60)
    // страница не перезагружалась, а машины снова видны в GPU
    expect(await app.evaluate(() => (window as unknown as { __marker: number }).__marker)).toBe(42)
    await expect.poll(async () => (await probeIsolated(app)).filter((p) => p.rgba[3] >= 250).length, { timeout: 8_000 }).toBeGreaterThan(0)
  })
})

test.describe('схема: управление', () => {
  test.use({ mockEnv: SPARSE })

  test('щелчок рядом с машиной выбирает её, щелчок в пустоте снимает выбор', async ({ app }) => {
    await waitForMap(app, 60)
    const target = await app.evaluate(() => {
      const hook = window.__dispatch
      const map = hook?.map()
      if (!hook || !map) return null
      const placed = hook.vehicles().flatMap((v) => {
        const pos = map.vehicleScreenPosition(v.vehicle_id)
        return pos ? [{ id: v.vehicle_id, name: v.name, pos }] : []
      })
      return placed.find((a) => placed.every((b) => b === a || Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) > 40)) ?? null
    })
    expect(target, 'нужна машина без соседей в 40 пикселях').not.toBeNull()
    if (!target) return

    const box = await app.getByTestId('map-overlay').boundingBox()
    if (!box) throw new Error('нет области схемы')
    // машины двигаются: щелкаем по свежей позиции, смещение в пределах радиуса выбора
    await app.mouse.click(box.x + target.pos[0] + 3, box.y + target.pos[1] - 2)
    const panel = app.getByTestId('selected-vehicle')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('data-vehicle-id', target.id)
    await expect(panel).toContainText(target.name)
    await expect(panel.getByTestId('selected-last-seen')).toContainText(/\d{2}:\d{2}:\d{2}/)

    await app.getByRole('button', { name: 'Снять выбор' }).click()
    await expect(panel).toBeHidden()
  })

  test('масштаб: кнопки и колесо меняют вид, «Весь участок» возвращает', async ({ app }) => {
    await waitForMap(app, 60)
    const scale = () => app.evaluate(() => window.__dispatch?.map()?.viewport.scale ?? 0)
    const initial = await scale()
    await app.getByTestId('map-zoom-in').click()
    await expect.poll(scale).toBeGreaterThan(initial * 1.5)
    await app.getByTestId('map-zoom-out').click()
    await app.getByTestId('map-zoom-out').click()
    await expect.poll(scale).toBeLessThan(initial)

    const box = await app.getByTestId('map-overlay').boundingBox()
    if (!box) throw new Error('нет области схемы')
    await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const before = await scale()
    await app.mouse.wheel(0, -400)
    await expect.poll(scale).toBeGreaterThan(before)

    await app.getByTestId('map-reset').click()
    await expect.poll(scale).toBeCloseTo(initial, 4)
  })

  test('перетаскивание сдвигает вид', async ({ app }) => {
    await waitForMap(app, 60)
    await app.getByTestId('map-zoom-in').click()
    const center = () => app.evaluate(() => window.__dispatch?.map()?.viewport.centerX ?? 0)
    const before = await center()
    const box = await app.getByTestId('map-overlay').boundingBox()
    if (!box) throw new Error('нет области схемы')
    await app.mouse.move(box.x + 300, box.y + 300)
    await app.mouse.down()
    await app.mouse.move(box.x + 420, box.y + 300, { steps: 6 })
    await app.mouse.up()
    // содержимое потянули вправо: центр в мире ушёл влево
    await expect.poll(center).toBeLessThan(before)
  })
})

test.describe('схема: нет WebGL2', () => {
  test('вместо схемы сообщение, очереди и решения работают', async ({ page, mock, appOrigin, externalGuard }) => {
    void externalGuard
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2') return null
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest) as never
      } as typeof original
    })
    await page.goto(`${appOrigin}/?api=${encodeURIComponent(mock.url)}`)
    await expect(page.getByTestId('map-unavailable')).toContainText('WebGL2')
    await expect(page.getByTestId('point')).toHaveCount(6, { timeout: 15_000 })
    await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'connected')
  })
})

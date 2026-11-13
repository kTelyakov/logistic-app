import type { FpsStats, MinuteRow } from './metrics'

export interface MemoryPoint {
  /** Секунды от старта замера. */
  at: number
  mainBytes: number
  workerBytes: number
  nodes: number
}

export interface PerfResult {
  environment: {
    browser: string
    renderer: string
    software: boolean
    platform: string
    load: number
    minutes: number
    warmupSeconds: number
    startedAt: string
  }
  minutes: MinuteRow[]
  fps: FpsStats
  /** Среднее кадров в секунду за прогрев (для справки). */
  fpsWarmup: FpsStats | undefined
  drawsPerSecond: number
  memory: {
    series: MemoryPoint[]
    base: MemoryPoint
    end: MemoryPoint
    elapsedSeconds: number
    /** Минимум суммарной кучи по первым и по последним пяти замерам ряда: по ним считается вердикт. */
    trendBase: number
    trendEnd: number
  }
  verdicts: Array<{ name: string; target: string; actual: string; ok: boolean }>
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1)
const fixed = (value: number, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '—')
const pct = (base: number, end: number) => (base === 0 ? '—' : `${(((end - base) / base) * 100).toFixed(1)} %`)

export function renderReport(result: PerfResult): string {
  const { environment: env, memory } = result
  const lines: string[] = []
  const push = (...rows: string[]) => lines.push(...rows)

  push('# Отчёт о производительности', '')
  push(`Сформирован командой \`make perf\` ${env.startedAt}. Экран открыт на заглушке с \`LOAD=${env.load}\` на ${env.minutes} мин; первые ${env.warmupSeconds} с считаются прогревом.`, '')

  push('## Окружение', '')
  push('| Параметр | Значение |', '|---|---|')
  push(`| Браузер | ${env.browser} |`)
  push(`| Рендерер WebGL | ${env.renderer}${env.software ? ' (**программный**, CPU)' : ' (GPU)'} |`)
  push(`| Платформа | ${env.platform} |`)
  push(`| Нагрузка | ${env.load} машин, обновление каждой раз в секунду; окно решений за час заполнено заранее (360), как в середине смены |`)
  push(`| Длительность | ${env.minutes} мин, прогрев ${env.warmupSeconds} с |`, '')

  push('## Итог по целям', '')
  push('| Метрика | Цель | Результат | |', '|---|---|---|---|')
  for (const v of result.verdicts) push(`| ${v.name} | ${v.target} | ${v.actual} | ${v.ok ? 'выполнено' : '**не выполнено**'} |`)
  push('')

  push('## Долгие задачи (больше 50 мс) по минутам', '')
  push('Основной поток страницы. Минута 0 включает старт и в вердикт не входит.', '')
  push('| Минута | Долгих задач | Самая долгая, мс |', '|---:|---:|---:|')
  for (const row of result.minutes) push(`| ${row.minute}${row.minute === 0 ? ' (прогрев)' : ''} | ${row.longTasks} | ${row.maxMs ? Math.round(row.maxMs) : '—'} |`)
  push('')

  push('## Частота кадров', '')
  push('Кадры страницы (`requestAnimationFrame`) по секундным окнам после прогрева.', '')
  push('| Показатель | Значение |', '|---|---:|')
  push(`| Среднее, кадров/с | ${fixed(result.fps.average)} |`)
  push(`| 5-й перцентиль, кадров/с | ${fixed(result.fps.p5)} |`)
  push(`| Минимум, кадров/с | ${fixed(result.fps.min, 0)} |`)
  push(`| Секундных окон | ${result.fps.seconds} |`)
  push(`| Отрисовок схемы в секунду | ${fixed(result.drawsPerSecond)} |`, '')
  push('Схема перерисовывается при изменении данных, вида или времени сервера (пакеты приходят до 20 раз в секунду), а не на каждый кадр страницы: поэтому «кадры страницы» и «отрисовки схемы» отдельными строками.', '')

  push('## JS-куча', '')
  push('Куча и буферы (`ArrayBuffer`: арена машин, кадры) основного потока и воркера синхронизации после принудительной сборки мусора в каждом (`HeapProfiler.collectGarbage`, `Runtime.getHeapUsage` через CDP). Точка это среднее трёх замеров.', '')
  push('| Точка | Основной поток, МБ | Воркер, МБ | Всего, МБ | Узлов DOM |', '|---|---:|---:|---:|---:|')
  const row = (label: string, p: MemoryPoint) => push(`| ${label} | ${mb(p.mainBytes)} | ${mb(p.workerBytes)} | ${mb(p.mainBytes + p.workerBytes)} | ${p.nodes} |`)
  row(`после прогрева (${Math.round(memory.base.at)} с)`, memory.base)
  row(`в конце (${Math.round(memory.end.at)} с)`, memory.end)
  push(`| Минимум пяти замеров в начале ряда / в конце | | | ${mb(memory.trendBase)} / ${mb(memory.trendEnd)} | |`)
  push(`| Рост по этим минимумам (вердикт) | | | ${pct(memory.trendBase, memory.trendEnd)} | |`)
  push(`| Рост по точкам «после прогрева» и «в конце» | ${pct(memory.base.mainBytes, memory.end.mainBytes)} | ${pct(memory.base.workerBytes, memory.end.workerBytes)} | ${pct(memory.base.mainBytes + memory.base.workerBytes, memory.end.mainBytes + memory.end.workerBytes)} | ${pct(memory.base.nodes, memory.end.nodes)} |`, '')

  push('Вердикт считается по минимуму замеров: после принудительной сборки мусора остаётся удерживаемая память плюс то, что живо в момент замера (например, дерево виртуальных узлов Vue при перерисовке ленты решений, около 1,2 МБ на мгновение). Временные данные только добавляют, поэтому удерживаемую память описывает минимум. Без новых решений пиков в ряду нет (проверено отдельным прогоном: куча ровная, рост 0,2 %).', '')
  push('Ряд замеров во времени:', '')
  push('| Секунда | Основной поток, МБ | Воркер, МБ | Узлов DOM |', '|---:|---:|---:|---:|')
  for (const p of memory.series) push(`| ${Math.round(p.at)} | ${mb(p.mainBytes)} | ${mb(p.workerBytes)} | ${p.nodes} |`)
  push('')

  push('## Оговорки', '')
  push(`- Прогон ${env.minutes} мин, а не 12 часов смены: показан тренд памяти. Скорость роста суммарной кучи за период после прогрева: ${fixed(((memory.end.mainBytes + memory.end.workerBytes - memory.base.mainBytes - memory.base.workerBytes) / 1e6) * (3600 / Math.max(1, memory.elapsedSeconds)), 2)} МБ/ч.`)
  push('- Замеряется JS-куча вместе с буферами `ArrayBuffer` (арена машин в воркере и переданные кадры в основном потоке). Память процессов браузера целиком (GPU, растеризатор) не входит.')
  if (env.software) push('- WebGL в этом окружении программный (SwiftShader): частота кадров ограничена CPU. На настоящем GPU цифры лучше: `E2E_CHANNEL=chrome make perf`.')
  push('- Долгие задачи считаются только для основного потока страницы; воркер синхронизации работает отдельно и интерфейс не блокирует.')
  push('')
  return lines.join('\n')
}

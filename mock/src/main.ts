import { parseConfig } from './config'
import { startMock } from './server'

const STATS_INTERVAL_MS = 10_000

async function main(): Promise<void> {
  const config = parseConfig(process.env)
  const log = (message: string) => console.log(`[mock] ${message}`)
  // Часы сервера могут расходиться с часами машины: так проверяется, что экран живёт по времени сервера
  const clock = () => Date.now() + config.clockOffsetMs
  const mock = await startMock(config, clock, log)

  log(`слушает ${mock.url}`)
  log(
    `LOAD=${config.load} FAULTS=${[...config.faults].join(',') || '-'} ROLE=${config.role} ` +
      `FAULT_SEED=${config.seed} (уровень отказов ${config.faultRate})` +
      (config.clockOffsetMs !== 0 ? ` CLOCK_OFFSET_MS=${config.clockOffsetMs}` : ''),
  )

  // Если симуляция не успевает, обновления отстают: показываем это в логе
  let lastEmitted = 0
  let lastSeq = 0
  setInterval(() => {
    const emitted = mock.sim.stats.emitted
    const perSecond = Math.round((emitted - lastEmitted) / (STATS_INTERVAL_MS / 1000))
    const seqPerSecond = Math.round((mock.world.seq - lastSeq) / (STATS_INTERVAL_MS / 1000))
    lastEmitted = emitted
    lastSeq = mock.world.seq
    log(
      `обновлений машин: ${perSecond}/с (ожидается ${config.load}/с), сообщений: ${seqPerSecond}/с, ` +
        `макс. длительность шага: ${mock.sim.stats.maxTickMs.toFixed(1)} мс`,
    )
    mock.sim.stats.maxTickMs = 0
  }, STATS_INTERVAL_MS).unref()

  const stop = () => {
    mock.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((error: unknown) => {
  console.error(`[mock] не удалось запустить: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

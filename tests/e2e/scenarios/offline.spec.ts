// Требование 8: нет запросов к внешним адресам; шрифты, иконки и подложка в сборке.
import { expect, test } from '../fixtures'
import { waitForData } from '../helpers/app'

test.describe('B14: без внешних ресурсов', () => {
  test('экран за всё время работы обращается только к своему адресу и заглушке', async ({ app, mock, appOrigin }) => {
    const origins = new Set<string>()
    const record = (url: string) => {
      if (/^(data|blob|about):/.test(url)) return
      origins.add(new URL(url).origin)
    }
    app.on('request', (r) => record(r.url()))
    app.on('websocket', (w) => record(w.url().replace(/^ws/, 'http')))
    await app.reload()
    await waitForData(app)
    await app.waitForTimeout(2_000)
    expect([...origins].sort()).toEqual([appOrigin, mock.url].sort())
  })

  test('сборка не содержит ссылок на внешние адреса (шрифты, иконки, стили, скрипты)', async ({ appOrigin }) => {
    const index = await (await fetch(`${appOrigin}/`)).text()
    const assets = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string).filter((u) => u.startsWith('/'))
    expect(assets.length, 'в index.html есть скрипты и стили сборки').toBeGreaterThan(1)

    // найденные во всех ресурсах адреса http(s): пространства имён XML безвредны, остальное запрещено
    const ALLOWED = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/127\.0\.0\.1/, /^https?:\/\/localhost/, /^https?:\/\/mock\.local/]
    const found = new Map<string, string>()
    for (const url of [`${appOrigin}/`, ...assets.map((a) => `${appOrigin}${a}`)]) {
      const text = await (await fetch(url)).text()
      for (const match of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
        if (!ALLOWED.some((re) => re.test(match[0]))) found.set(match[0], url)
      }
    }
    // Адреса в сообщениях об ошибках фреймворка не запрашиваются; они перечислены здесь явно, чтобы новые не прошли незамеченными
    const documentation = [...found.keys()].filter((u) => /^https:\/\/(vuejs\.org|github\.com|developer\.mozilla\.org)\//.test(u))
    const requested = [...found.entries()].filter(([u]) => !documentation.includes(u))
    expect(requested.map(([u, from]) => `${u} (${from})`)).toEqual([])

    // Ни @import, ни url(...) на внешние адреса в стилях
    const css = assets.find((a) => a.endsWith('.css'))
    if (css) {
      const text = await (await fetch(`${appOrigin}${css}`)).text()
      expect(text).not.toMatch(/@import\s+url\(\s*['"]?https?:/)
      expect(text).not.toMatch(/url\(\s*['"]?https?:/)
    }
  })

  test('шрифты системные: в стилях нет @font-face с внешним источником', async ({ appOrigin }) => {
    const index = await (await fetch(`${appOrigin}/`)).text()
    const css = [...index.matchAll(/href="(\/[^"]+\.css)"/g)].map((m) => m[1] as string)
    for (const href of css) {
      const text = await (await fetch(`${appOrigin}${href}`)).text()
      expect(text).not.toMatch(/@font-face[^}]*src:[^}]*https?:/)
    }
  })
})

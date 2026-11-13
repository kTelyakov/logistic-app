import { readFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface StaticServer {
  origin: string
  stop(): Promise<void>
}

/**
 * Отдаёт одну HTML-страницу с настоящего локального адреса. Страница, поданная через
 * route.fulfill, считается «публичной», и Chrome запрещает ей обращаться к loopback.
 */
export async function startStaticPage(htmlPath: string): Promise<StaticServer> {
  const html = await readFile(htmlPath, 'utf8')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    async stop() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

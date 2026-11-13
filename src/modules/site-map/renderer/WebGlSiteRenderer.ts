import { STALE_AFTER_MS } from '@dispatch/contract'
import { EMPTY_VIEW, type VehicleView } from '@/modules/vehicles'
import { stateColorTable } from '../helpers/colors'
import { fillSeenSeconds } from '../helpers/seen'
import type { Viewport } from '../helpers/viewport'
import type { RendererDiagnostics, SiteRenderer } from './SiteRenderer'
import { FRAGMENT_SHADER, STATE_COUNT, VERTEX_SHADER } from './shaders'

/** Размер маркера машины в пикселях CSS. */
const MARKER_PX = 11
const INITIAL_CAPACITY = 1024
/** База времени для last_seen пересчитывается, когда уходит так далеко: float32 теряет точность. */
const REBASE_AFTER_MS = 6 * 3_600_000
/** Время сервера обновляет кадр, когда сдвинулось не меньше чем на столько (устаревание не требует частой перерисовки). */
const NOW_REDRAW_MS = 250

interface GlResources {
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  corner: WebGLBuffer
  x: WebGLBuffer
  y: WebGLBuffer
  heading: WebGLBuffer
  state: WebGLBuffer
  seen: WebGLBuffer
  uniforms: Record<string, WebGLUniformLocation | null>
  capacity: number
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Не удалось создать шейдер')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Ошибка шейдера: ${log ?? 'нет сообщения'}`)
  }
  return shader
}

/** Один draw call на все машины; столбцы арены идут в буферы GPU без преобразований, кроме last_seen. */
export class WebGlSiteRenderer implements SiteRenderer {
  private readonly gl: WebGL2RenderingContext
  /** Расширение берём заранее: у потерянного контекста getExtension возвращает null. */
  private readonly loseExtension: WEBGL_lose_context | null
  private resources: GlResources | undefined
  private view: VehicleView = EMPTY_VIEW
  private viewport: Viewport = { scale: 1, centerX: 0, centerY: 0, width: 1, height: 1 }
  private dpr = 1
  private serverNowMs = Date.now()
  private baseMs = Date.now()
  private seenScratch = new Float32Array(INITIAL_CAPACITY)
  private colors = stateColorTable()

  private dataDirty = false
  private drawDirty = true
  private lostContext = false
  private renderedNowMs = 0
  private disposed = false

  private readonly stats: RendererDiagnostics = { backend: 'webgl2', contextLost: false, instances: 0, frames: 0, uploads: 0, restores: 0, lastCpuMs: 0 }

  private readonly onLost = (event: Event) => {
    // Без preventDefault браузер не будет восстанавливать контекст
    event.preventDefault()
    this.lostContext = true
    this.stats.contextLost = true
    this.resources = undefined
  }

  private readonly onRestored = () => {
    this.lostContext = false
    this.stats.contextLost = false
    this.stats.restores += 1
    this.createResources()
    // Данные живут в арене, а не в GPU: достаточно залить текущий кадр заново
    this.dataDirty = true
    this.drawDirty = true
  }

  constructor(readonly canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.gl = gl
    this.loseExtension = gl.getExtension('WEBGL_lose_context')
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.createResources()
  }

  // --- интерфейс ---

  setVehicles(view: VehicleView): void {
    this.view = view
    this.dataDirty = true
    this.drawDirty = true
  }

  setServerNow(ms: number): void {
    this.serverNowMs = ms
    if (Math.abs(ms - this.renderedNowMs) >= NOW_REDRAW_MS) this.drawDirty = true
  }

  setViewport(viewport: Viewport, devicePixelRatio: number): void {
    this.viewport = viewport
    this.dpr = devicePixelRatio
    const width = Math.max(1, Math.round(viewport.width * devicePixelRatio))
    const height = Math.max(1, Math.round(viewport.height * devicePixelRatio))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    this.canvas.style.width = `${viewport.width}px`
    this.canvas.style.height = `${viewport.height}px`
    this.drawDirty = true
  }

  needsRender(): boolean {
    return !this.disposed && !this.lostContext && (this.dataDirty || this.drawDirty)
  }

  render(): void {
    if (this.disposed || this.lostContext || this.gl.isContextLost()) return
    const started = performance.now()
    this.draw()
    this.stats.lastCpuMs = performance.now() - started
  }

  readPixel(screenX: number, screenY: number): [number, number, number, number] {
    if (this.lostContext || this.gl.isContextLost()) return [0, 0, 0, 0]
    // Рисуем и читаем в одном вызове: без preserveDrawingBuffer буфер после кадра уже недоступен
    this.draw()
    const gl = this.gl
    const out = new Uint8Array(4)
    const px = Math.round(screenX * this.dpr)
    const py = Math.round(this.canvas.height - screenY * this.dpr)
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return [out[0] as number, out[1] as number, out[2] as number, out[3] as number]
  }

  diagnostics(): RendererDiagnostics {
    return { ...this.stats }
  }

  loseContext(): boolean {
    this.loseExtension?.loseContext()
    return this.loseExtension !== null
  }

  restoreContext(): boolean {
    this.loseExtension?.restoreContext()
    return this.loseExtension !== null
  }

  dispose(): void {
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.releaseResources()
  }

  // --- ресурсы ---

  private createResources(): void {
    const gl = this.gl
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('Не удалось создать программу')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Ошибка линковки: ${gl.getProgramInfoLog(program) ?? 'нет сообщения'}`)
    }
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)

    const vao = gl.createVertexArray()
    const buffer = () => {
      const b = gl.createBuffer()
      if (!b) throw new Error('Не удалось создать буфер')
      return b
    }
    if (!vao) throw new Error('Не удалось создать VAO')
    const resources: GlResources = {
      program,
      vao,
      corner: buffer(),
      x: buffer(),
      y: buffer(),
      heading: buffer(),
      state: buffer(),
      seen: buffer(),
      capacity: 0,
      uniforms: {},
    }
    for (const name of ['uCenter', 'uScale', 'uViewport', 'uSizePx', 'uServerNow', 'uStaleAfter', 'uColors']) {
      resources.uniforms[name] = gl.getUniformLocation(program, name)
    }

    gl.bindVertexArray(vao)
    // квад: два треугольника полосой
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.corner)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.3, -1.3, 1.3, -1.3, -1.3, 1.3, 1.3, 1.3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const instanced = (location: number, buf: WebGLBuffer, size: number, type: number, integer = false) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(location)
      if (integer) gl.vertexAttribIPointer(location, size, type, 0, 0)
      else gl.vertexAttribPointer(location, size, type, false, 0, 0)
      gl.vertexAttribDivisor(location, 1)
    }
    instanced(1, resources.x, 1, gl.FLOAT)
    instanced(2, resources.y, 1, gl.FLOAT)
    instanced(3, resources.heading, 1, gl.FLOAT)
    instanced(4, resources.state, 1, gl.UNSIGNED_BYTE, true)
    instanced(5, resources.seen, 1, gl.FLOAT)
    gl.bindVertexArray(null)

    this.resources = resources
    this.allocate(Math.max(INITIAL_CAPACITY, this.seenScratch.length))
  }

  private releaseResources(): void {
    const r = this.resources
    if (!r || this.gl.isContextLost()) return
    const gl = this.gl
    for (const b of [r.corner, r.x, r.y, r.heading, r.state, r.seen]) gl.deleteBuffer(b)
    gl.deleteVertexArray(r.vao)
    gl.deleteProgram(r.program)
    this.resources = undefined
  }

  /** Выделяет в GPU буферы на `capacity` машин. */
  private allocate(capacity: number): void {
    const r = this.resources
    if (!r) return
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, r.x)
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, r.y)
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, r.heading)
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, r.state)
    gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, r.seen)
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW)
    r.capacity = capacity
    if (this.seenScratch.length < capacity) this.seenScratch = new Float32Array(capacity)
    this.dataDirty = true
  }

  // --- отрисовка ---

  /** Заливает столбцы кадра в GPU. Столбцы идут как есть; единственное преобразование: last_seen. */
  private upload(): void {
    const r = this.resources
    if (!r) return
    const gl = this.gl
    const { count, columns } = this.view
    if (count > r.capacity) {
      let capacity = r.capacity
      while (capacity < count) capacity *= 2
      this.allocate(capacity)
    }
    if (count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, r.x)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, columns.x, 0, count)
      gl.bindBuffer(gl.ARRAY_BUFFER, r.y)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, columns.y, 0, count)
      gl.bindBuffer(gl.ARRAY_BUFFER, r.heading)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, columns.heading, 0, count)
      gl.bindBuffer(gl.ARRAY_BUFFER, r.state)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, columns.state, 0, count)
      fillSeenSeconds(this.seenScratch, columns.lastSeenMs, count, this.baseMs)
      gl.bindBuffer(gl.ARRAY_BUFFER, r.seen)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.seenScratch, 0, count)
    }
    this.stats.uploads += 1
    this.dataDirty = false
  }

  private draw(): void {
    const r = this.resources
    if (!r) return
    const gl = this.gl

    // Время ушло далеко от базы: float32 теряет точность, пересчитываем секунды заново
    if (Math.abs(this.serverNowMs - this.baseMs) > REBASE_AFTER_MS) {
      this.baseMs = this.serverNowMs
      this.dataDirty = true
    }
    if (this.dataDirty) this.upload()

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const count = this.view.count
    if (count > 0) {
      gl.useProgram(r.program)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // предумноженная альфа
      const u = r.uniforms
      gl.uniform2f(u.uCenter ?? null, this.viewport.centerX, this.viewport.centerY)
      gl.uniform1f(u.uScale ?? null, this.viewport.scale)
      gl.uniform2f(u.uViewport ?? null, this.viewport.width, this.viewport.height)
      gl.uniform1f(u.uSizePx ?? null, MARKER_PX)
      gl.uniform1f(u.uServerNow ?? null, (this.serverNowMs - this.baseMs) / 1000)
      gl.uniform1f(u.uStaleAfter ?? null, STALE_AFTER_MS / 1000)
      gl.uniform3fv(u.uColors ?? null, this.colors.length === STATE_COUNT * 3 ? this.colors : stateColorTable())
      gl.bindVertexArray(r.vao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      gl.bindVertexArray(null)
    }

    this.stats.instances = count
    this.stats.frames += 1
    this.renderedNowMs = this.serverNowMs
    this.drawDirty = false
  }
}

/** Создаёт рендерер или возвращает null, если WebGL2 недоступен. */
export function createWebGlRenderer(canvas: HTMLCanvasElement): SiteRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) return null
  return new WebGlSiteRenderer(canvas, gl)
}

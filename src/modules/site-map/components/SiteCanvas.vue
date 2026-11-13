<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { vehicleAt, vehicleSlotOf, type VehicleView } from '@/modules/vehicles'
import { drawBackground, drawOverlay, type OverlayLabel, type PointMarker } from '../helpers/background'
import { setMapDiagnostics } from '../diagnostics'
import { hitTestVehicle, pickLabelSlots } from '../helpers/interaction'
import { fitViewport, panBy, resizeViewport, SITE_BOUNDS, worldToScreen, zoomAt, type Viewport } from '../helpers/viewport'
import { createWebGlRenderer } from '../renderer/WebGlSiteRenderer'
import type { SiteRenderer } from '../renderer/SiteRenderer'

const props = defineProps<{
  view: VehicleView
  points: PointMarker[]
  /** Время сервера, мс: по нему шейдер определяет устаревшие машины. */
  serverNowMs: number
  selectedId: string | null
}>()
const emit = defineEmits<{ select: [id: string | null] }>()

const stage = ref<HTMLDivElement>()
const backgroundCanvas = ref<HTMLCanvasElement>()
const glCanvas = ref<HTMLCanvasElement>()
const overlayCanvas = ref<HTMLCanvasElement>()

const unavailable = ref(false)
const contextLost = ref(false)
const viewport = shallowRef<Viewport>(fitViewport(800, 500))

let renderer: SiteRenderer | null = null
let dpr = 1
let userMoved = false
let staticDirty = true
let overlayDirty = true
let frameHandle = 0
let frameCounter = 0
let observer: ResizeObserver | undefined

function applyViewport(next: Viewport): void {
  viewport.value = next
  renderer?.setViewport(next, dpr)
  for (const canvas of [backgroundCanvas.value, overlayCanvas.value]) {
    if (!canvas) continue
    const width = Math.max(1, Math.round(next.width * dpr))
    const height = Math.max(1, Math.round(next.height * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    canvas.style.width = `${next.width}px`
    canvas.style.height = `${next.height}px`
  }
  staticDirty = true
  overlayDirty = true
}

function onResize(): void {
  const el = stage.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  dpr = window.devicePixelRatio || 1
  applyViewport(userMoved ? resizeViewport(viewport.value, width, height) : fitViewport(width, height, SITE_BOUNDS))
}

function resetView(): void {
  userMoved = false
  onResize()
}

function zoomBy(factor: number): void {
  const vp = viewport.value
  userMoved = true
  applyViewport(zoomAt(vp, vp.width / 2, vp.height / 2, factor))
}

// --- жесты ---

let drag: { x: number; y: number; moved: number } | undefined

function pointerPosition(event: PointerEvent | WheelEvent | MouseEvent): [number, number] {
  const rect = (overlayCanvas.value as HTMLCanvasElement).getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top]
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  const [x, y] = pointerPosition(event)
  drag = { x, y, moved: 0 }
}

function onPointerMove(event: PointerEvent): void {
  if (!drag) return
  const [x, y] = pointerPosition(event)
  const dx = x - drag.x
  const dy = y - drag.y
  drag.moved += Math.abs(dx) + Math.abs(dy)
  drag.x = x
  drag.y = y
  if (drag.moved > 4) {
    userMoved = true
    applyViewport(panBy(viewport.value, dx, dy))
  }
}

function onPointerUp(event: PointerEvent): void {
  const was = drag
  drag = undefined
  if (!was || was.moved > 4) return
  const [x, y] = pointerPosition(event)
  const slot = hitTestVehicle(props.view, viewport.value, x, y)
  emit('select', slot >= 0 ? (props.view.tables.ids[slot] ?? null) : null)
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const [x, y] = pointerPosition(event)
  userMoved = true
  applyViewport(zoomAt(viewport.value, x, y, Math.exp(-event.deltaY * 0.0015)))
}

function onDoubleClick(event: MouseEvent): void {
  const [x, y] = pointerPosition(event)
  userMoved = true
  applyViewport(zoomAt(viewport.value, x, y, 2))
}

// --- отрисовка ---

function drawStatic(): void {
  const ctx = backgroundCanvas.value?.getContext('2d')
  if (ctx) drawBackground(ctx, viewport.value, dpr, SITE_BOUNDS)
  staticDirty = false
}

function drawOverlayLayer(): void {
  const ctx = overlayCanvas.value?.getContext('2d')
  if (!ctx) return
  const view = props.view
  const labels: OverlayLabel[] = pickLabelSlots(view, viewport.value).flatMap((slot) => {
    const v = vehicleAt(view, slot)
    return v ? [{ text: v.name, x: v.x_m, y: v.y_m }] : []
  })
  let selected: { x: number; y: number } | undefined
  if (props.selectedId) {
    const v = vehicleAt(view, vehicleSlotOf(view, props.selectedId))
    if (v) selected = { x: v.x_m, y: v.y_m }
  }
  drawOverlay(ctx, viewport.value, dpr, props.points, labels, selected)
  overlayDirty = false
}

function frame(): void {
  frameHandle = requestAnimationFrame(frame)
  if (staticDirty) drawStatic()
  if (overlayDirty) drawOverlayLayer()
  if (renderer?.needsRender()) renderer.render()
  // признак потери контекста обновляем не на каждом кадре
  if (renderer && ++frameCounter % 10 === 0) contextLost.value = renderer.diagnostics().contextLost
}

watch(() => props.view, (view) => {
  renderer?.setVehicles(view)
  overlayDirty = true
})
watch(() => props.points, () => (overlayDirty = true))
watch(() => props.serverNowMs, (ms) => renderer?.setServerNow(ms))
watch(() => props.selectedId, () => (overlayDirty = true))

onMounted(() => {
  const gl = glCanvas.value
  if (!gl) return
  renderer = createWebGlRenderer(gl)
  if (!renderer) {
    unavailable.value = true
    return
  }
  renderer.setVehicles(props.view)
  renderer.setServerNow(props.serverNowMs)
  observer = new ResizeObserver(onResize)
  if (stage.value) observer.observe(stage.value)
  onResize()
  frameHandle = requestAnimationFrame(frame)

  const rendererRef = renderer
  setMapDiagnostics(() => ({
    backend: 'webgl2',
    renderer: rendererRef.diagnostics(),
    viewport: { ...viewport.value },
    pixelAtVehicle(id) {
      const v = vehicleAt(props.view, vehicleSlotOf(props.view, id))
      if (!v) return null
      const [sx, sy] = worldToScreen(viewport.value, v.x_m, v.y_m)
      return rendererRef.readPixel(sx, sy)
    },
    vehicleScreenPosition(id) {
      const v = vehicleAt(props.view, vehicleSlotOf(props.view, id))
      return v ? worldToScreen(viewport.value, v.x_m, v.y_m) : null
    },
    loseContext: () => rendererRef.loseContext(),
    restoreContext: () => rendererRef.restoreContext(),
  }))
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameHandle)
  observer?.disconnect()
  setMapDiagnostics(undefined)
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <div ref="stage" class="map-stage" data-testid="map-stage">
    <p v-if="unavailable" class="map-stage__unavailable" role="alert" data-testid="map-unavailable">
      Схема недоступна: браузер не поддерживает WebGL2. Очереди и решения работают.
    </p>
    <template v-else>
      <canvas ref="backgroundCanvas" class="map-stage__layer" aria-hidden="true" />
      <canvas ref="glCanvas" class="map-stage__layer" data-testid="map-canvas" aria-hidden="true" />
      <canvas
        ref="overlayCanvas"
        class="map-stage__layer map-stage__overlay"
        role="img"
        aria-label="Схема площадки: перетаскивание сдвигает, колесо масштабирует, щелчок выбирает машину"
        data-testid="map-overlay"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="drag = undefined"
        @wheel="onWheel"
        @dblclick="onDoubleClick"
      />
      <div class="map-stage__controls">
        <button type="button" class="action" data-testid="map-zoom-in" aria-label="Приблизить" @click="zoomBy(1.6)">+</button>
        <button type="button" class="action" data-testid="map-zoom-out" aria-label="Отдалить" @click="zoomBy(1 / 1.6)">−</button>
        <button type="button" class="action" data-testid="map-reset" @click="resetView">Весь участок</button>
      </div>
      <p v-if="contextLost" class="map-stage__lost" role="status" data-testid="map-context-lost">Восстановление графики…</p>
    </template>
  </div>
</template>

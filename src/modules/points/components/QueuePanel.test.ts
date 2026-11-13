// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Point } from '@dispatch/contract'
import { toPointViews } from '../helpers/viewModel'
import QueuePanel from './QueuePanel.vue'

const point: Point = {
  point_id: 'p-2', name: 'Пункт 2', x_m: 0, y_m: 0, mode: 'auto', version: 14,
  queue: [
    { vehicle_id: 'v-09', eta: '2026-10-01T04:13:40Z', service_start: '2026-10-01T04:15:10Z', wait_s: 90 },
    { vehicle_id: 'v-12', eta: '2026-10-01T04:14:00Z', service_start: '2026-10-01T04:15:30Z', wait_s: 90 },
  ],
}
const nameOf = (id: string) => (id === 'v-09' ? 'Т-09' : id)

describe('QueuePanel', () => {
  it('показывает значения сервера в поясе площадки и ничего не пересчитывает', () => {
    const wrapper = mount(QueuePanel, { props: { points: toPointViews([point], 'Asia/Krasnoyarsk', nameOf) } })
    const rows = wrapper.findAll('[data-testid="queue-item"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('Т-09')
    expect(rows[0]?.text()).toContain('11:13:40') // 04:13:40Z в Красноярске
    expect(rows[0]?.text()).toContain('11:15:10')
    expect(rows[0]?.text()).toContain('1 мин 30 с') // wait_s=90 как у сервера
    expect(rows[1]?.text()).toContain('v-12') // имени нет в справочнике: показывается id
  })

  it('контракт для тестов: data-атрибуты точки и элементов очереди', () => {
    const wrapper = mount(QueuePanel, { props: { points: toPointViews([point], 'UTC', nameOf) } })
    const el = wrapper.find('[data-testid="point"]')
    expect(el.attributes()).toMatchObject({ 'data-point-id': 'p-2', 'data-mode': 'auto' })
    const row = wrapper.find('[data-testid="queue-item"]')
    expect(row.attributes()).toMatchObject({
      'data-vehicle-id': 'v-09',
      'data-eta': '2026-10-01T04:13:40Z',
      'data-service-start': '2026-10-01T04:15:10Z',
      'data-wait-s': '90',
    })
  })

  it('ручной режим помечен', () => {
    const wrapper = mount(QueuePanel, { props: { points: toPointViews([{ ...point, mode: 'manual' }], 'UTC', nameOf) } })
    expect(wrapper.find('[data-testid="point"]').attributes('data-mode')).toBe('manual')
    expect(wrapper.text()).toContain('Ручной')
  })

  it('пустая очередь и отсутствие пунктов', () => {
    expect(mount(QueuePanel, { props: { points: [] } }).text()).toContain('Нет данных о пунктах')
    const wrapper = mount(QueuePanel, { props: { points: toPointViews([{ ...point, queue: [] }], 'UTC', nameOf) } })
    expect(wrapper.text()).toContain('Очереди нет')
    expect(wrapper.findAll('[data-testid="queue-item"]')).toHaveLength(0)
  })
})

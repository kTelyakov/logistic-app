// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Point } from '@dispatch/contract'
import { toPointViews } from '../helpers/viewModel'
import ModeSwitch from './ModeSwitch.vue'
import QueuePanel from './QueuePanel.vue'

const point: Point = { point_id: 'p-2', name: 'Пункт 2', x_m: 0, y_m: 0, mode: 'auto', version: 14, queue: [] }

describe('ModeSwitch', () => {
  it('активный режим недоступен для нажатия, другой сообщает через emit', async () => {
    const wrapper = mount(ModeSwitch, { props: { mode: 'auto', busy: false } })
    expect(wrapper.get('[data-testid="mode-auto"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="mode-manual"]').trigger('click')
    expect(wrapper.emitted('change')).toEqual([['manual']])
  })

  it('пока команда в пути, оба режима недоступны', () => {
    const wrapper = mount(ModeSwitch, { props: { mode: 'auto', busy: true } })
    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })
})

describe('QueuePanel: права', () => {
  const views = toPointViews([point], 'UTC', (id) => id)

  it('диспетчер видит переключатель и посылает pointId и режим', async () => {
    const wrapper = mount(QueuePanel, { props: { points: views, canCommand: true } })
    await wrapper.get('[data-testid="mode-manual"]').trigger('click')
    expect(wrapper.emitted('setMode')).toEqual([['p-2', 'manual']])
  })

  it('наблюдатель не видит кнопок, режим показан текстом', () => {
    const wrapper = mount(QueuePanel, { props: { points: views, canCommand: false } })
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).toContain('Авто')
  })

  it('по умолчанию кнопок нет', () => {
    expect(mount(QueuePanel, { props: { points: views } }).find('button').exists()).toBe(false)
  })
})

// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConnectionBadge from './ConnectionBadge.vue'

describe('ConnectionBadge', () => {
  it('показывает подпись и состояние для тестов', () => {
    const wrapper = mount(ConnectionBadge, { props: { state: 'stale', label: 'Данные устарели' } })
    expect(wrapper.text()).toBe('Данные устарели')
    expect(wrapper.attributes('data-state')).toBe('stale')
    expect(wrapper.classes()).toContain('connection--stale')
    expect(wrapper.attributes('role')).toBe('status')
  })
})

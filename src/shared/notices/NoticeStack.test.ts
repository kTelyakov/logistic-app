// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NoticeStack from './NoticeStack.vue'

describe('NoticeStack', () => {
  const notices = [
    { id: 1, kind: 'conflict' as const, message: 'Решение уже исполнено' },
    { id: 2, kind: 'forbidden' as const, message: 'Нет прав' },
  ]

  it('показывает сообщения с видом для тестов', () => {
    const wrapper = mount(NoticeStack, { props: { notices } })
    const items = wrapper.findAll('[data-testid="notice"]')
    expect(items.map((i) => i.attributes('data-kind'))).toEqual(['conflict', 'forbidden'])
    expect(items[0]?.text()).toContain('Решение уже исполнено')
  })

  it('закрытие сообщает через emit, а не меняет данные само', async () => {
    const wrapper = mount(NoticeStack, { props: { notices } })
    await wrapper.findAll('button')[1]?.trigger('click')
    expect(wrapper.emitted('dismiss')).toEqual([[2]])
  })

  it('текст выводится как текст', () => {
    const wrapper = mount(NoticeStack, { props: { notices: [{ id: 1, kind: 'error' as const, message: '<b onclick=1>x</b>' }] } })
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b onclick=1>x</b>')
  })
})

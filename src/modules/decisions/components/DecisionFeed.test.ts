// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DecisionView } from '../helpers/viewModel'
import DecisionFeed from './DecisionFeed.vue'

const view = (patch: Partial<DecisionView> = {}): DecisionView => ({
  id: 'd-1', status: 'pending', statusLabel: 'Ожидает', version: 1, vehicleName: 'Т-17', route: 'Пункт 2 → Пункт 4',
  gain: '2 мин 20 с', reason: 'Очередь', createdAt: '01.10, 11:12:05', countdown: '00:30', pending: true, ...patch,
})

describe('DecisionFeed', () => {
  it('порядок элементов совпадает с порядком props: новые сверху задаёт контейнер', () => {
    const wrapper = mount(DecisionFeed, { props: { decisions: [view({ id: 'd-3' }), view({ id: 'd-2' }), view({ id: 'd-1' })] } })
    expect(wrapper.findAll('[data-testid="decision"]').map((e) => e.attributes('data-decision-id'))).toEqual(['d-3', 'd-2', 'd-1'])
  })

  it('контракт для тестов: статус и версия в data-атрибутах', () => {
    const wrapper = mount(DecisionFeed, { props: { decisions: [view({ status: 'executed', version: 4, pending: false, countdown: null })] } })
    expect(wrapper.find('[data-testid="decision"]').attributes()).toMatchObject({ 'data-decision-id': 'd-1', 'data-status': 'executed', 'data-version': '4' })
  })

  it('у ожидающих виден обратный отсчёт, у остальных нет', () => {
    const wrapper = mount(DecisionFeed, {
      props: { decisions: [view({ id: 'd-2' }), view({ id: 'd-1', status: 'executed', statusLabel: 'Исполнено', pending: false, countdown: null })] },
    })
    const items = wrapper.findAll('[data-testid="decision"]')
    expect(items[0]?.find('[data-testid="decision-countdown"]').text()).toBe('00:30')
    expect(items[1]?.find('[data-testid="decision-countdown"]').exists()).toBe(false)
    expect(items[1]?.text()).toContain('Исполнено')
  })

  it('reason с разметкой выводится как текст и не создаёт элементов', () => {
    const reason = '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> {{ 1 + 1 }}'
    const wrapper = mount(DecisionFeed, { props: { decisions: [view({ reason })] } })
    const el = wrapper.find('[data-testid="decision-reason"]')
    expect(el.text()).toBe(reason)
    expect(el.element.querySelector('img')).toBeNull()
    expect(el.element.querySelector('script')).toBeNull()
    expect((globalThis as { __xss?: number }).__xss).toBeUndefined()
  })

  it('пустая лента', () => {
    expect(mount(DecisionFeed, { props: { decisions: [] } }).text()).toContain('Решений за последний час нет')
  })

  it('слот действий доступен для кнопок (команды добавляются отдельно)', () => {
    const wrapper = mount(DecisionFeed, {
      props: { decisions: [view()] },
      slots: { actions: '<button data-testid="stub-action">x</button>' },
    })
    expect(wrapper.find('[data-testid="stub-action"]').exists()).toBe(true)
  })
})

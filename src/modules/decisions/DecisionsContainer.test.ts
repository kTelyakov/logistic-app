// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import type { Decision, Me } from '@dispatch/contract'
import { useSessionStore } from '@/modules/session'
import DecisionsContainer from './DecisionsContainer.vue'
import { useDecisionsStore } from './store/decisionsStore'

const me = (role: Me['role']): Me => ({ user_id: 'u-7', name: 'Иванова А. С.', role, site: { name: 'Площадка 3', tz: 'Asia/Krasnoyarsk' } })
const decision = (n: number, status: Decision['status']): Decision => ({
  decision_id: `d-${n}`, vehicle_id: 'v-1', from_point: 'p-1', to_point: 'p-2', gain_s: 30, reason: 'r', status,
  created_at: new Date().toISOString(), execute_at: new Date(Date.now() + 60_000).toISOString(), version: 1,
})

function mountWith(role: Me['role']) {
  setActivePinia(createPinia())
  useSessionStore().setMeMutator(me(role))
  useDecisionsStore().replaceDecisionsMutator([decision(1, 'pending'), decision(2, 'executed'), decision(3, 'pending')])
  return mount(DecisionsContainer)
}

describe('DecisionsContainer: права', () => {
  it('диспетчер: кнопка «Отменить» только у ожидающих решений', () => {
    const wrapper = mountWith('dispatcher')
    const buttons = wrapper.findAll('[data-testid="cancel-decision"]')
    expect(buttons).toHaveLength(2)
    const executed = wrapper.find('[data-decision-id="d-2"]')
    expect(executed.find('[data-testid="cancel-decision"]').exists()).toBe(false)
  })

  it('наблюдатель: кнопок действий нет вообще', () => {
    const wrapper = mountWith('observer')
    expect(wrapper.findAll('[data-testid="decision"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="cancel-decision"]').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('пока сессия не загружена, кнопок нет', () => {
    setActivePinia(createPinia())
    useDecisionsStore().replaceDecisionsMutator([decision(1, 'pending')])
    expect(mount(DecisionsContainer).find('button').exists()).toBe(false)
  })
})

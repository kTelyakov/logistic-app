import { describe, expect, it } from 'vitest'
import { canCommand } from './permissions'

describe('canCommand', () => {
  it('диспетчер может вмешиваться', () => expect(canCommand('dispatcher')).toBe(true))
  it('наблюдатель не может', () => expect(canCommand('observer')).toBe(false))
  it('пока сессия не загружена, действий нет', () => expect(canCommand(undefined)).toBe(false))
})

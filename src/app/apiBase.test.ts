import { describe, expect, it } from 'vitest'
import { resolveApiBase } from './apiBase'

describe('resolveApiBase', () => {
  it('без параметра: тот же origin', () => expect(resolveApiBase('')).toBe(''))
  it('?api= задаёт адрес сервера', () => expect(resolveApiBase('?api=http%3A%2F%2F127.0.0.1%3A8787')).toBe('http://127.0.0.1:8787'))
  it('завершающие слэши отбрасываются', () => expect(resolveApiBase('?api=http://h:1//')).toBe('http://h:1'))
  it('пустой параметр: тот же origin', () => expect(resolveApiBase('?api=')).toBe(''))
  it('посторонние параметры игнорируются', () => expect(resolveApiBase('?x=1&api=http://a')).toBe('http://a'))
})

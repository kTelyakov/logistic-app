import { PATHS, type Me } from '@dispatch/contract'
import { http } from '@/shared/http'

export async function fetchMe(): Promise<Me> {
  const response = await http().get<Me>(PATHS.me)
  if (response.status !== 200) throw new Error(`Сессия: ответ ${response.status}`)
  return response.body
}

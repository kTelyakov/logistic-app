import { PATHS, type Snapshot } from '@dispatch/contract'
import { http } from '@/shared/http'

export async function fetchSnapshot(): Promise<Snapshot> {
  const response = await http().get<Snapshot>(PATHS.snapshot)
  if (response.status !== 200) throw new Error(`Снимок: ответ ${response.status}`)
  return response.body
}

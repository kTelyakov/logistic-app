export type NoticeKind = 'conflict' | 'forbidden' | 'unknown' | 'error' | 'info'

export interface Notice {
  id: number
  kind: NoticeKind
  message: string
}

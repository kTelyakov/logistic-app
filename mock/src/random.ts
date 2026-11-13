/** Детерминированный генератор (mulberry32). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a, 32 бита. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Финализатор murmur3: перемешивает биты, иначе у соседних строк старшие биты FNV почти не отличаются. */
function fmix32(value: number): number {
  let h = value >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Число в [0, 1), которое зависит только от аргументов: решения об отказах не зависят от времени. */
export function unit(seed: number, ...parts: Array<string | number>): number {
  return fmix32(fnv1a(`${seed}:${parts.join(':')}`)) / 4294967296
}

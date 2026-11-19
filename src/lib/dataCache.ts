// Memória da aba, isolada por sessão. Não armazena tokens nem usa localStorage.
export const CATALOG_TTL = 60_000
export const CHANGE_EVENT = 'optocom:operational-change'
type Entry = { promise: Promise<unknown>; expires: number; pending: boolean; value?: unknown }
const entries = new Map<string, Entry>()
let session: string | null = null
let epoch = 0

export function clearDataSession() {
  session = null; epoch++; entries.clear()
}
export function setDataSession(id: string) {
  if (session !== id) { clearDataSession(); session = id }
}
export function dataSessionId() { return session }
export function invalidateCache(prefix: string) {
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
}
export function invalidateReads() { invalidateCache('read:') }
export function invalidateCatalogs() { invalidateCache('catalog:') }

export function sharedRead<T>(key: string, load: () => PromiseLike<T>, ttl = 0): Promise<T> {
  const previous = entries.get(key)
  if (previous && (previous.pending || previous.expires > Date.now())) return previous.promise as Promise<T>
  const currentEpoch = epoch
  const entry: Entry = { promise: Promise.resolve(), pending: true, expires: 0 }
  entry.promise = Promise.resolve().then(load).then(value => {
    if (currentEpoch !== epoch) throw new DOMException('Sessão alterada.', 'AbortError')
    if (entries.get(key) === entry) {
      entry.pending = false
      entry.value = value
      if (ttl > 0) entry.expires = Date.now() + ttl
      else entries.delete(key)
    }
    return value
  }, error => {
    if (entries.get(key) === entry) entries.delete(key)
    throw error
  })
  entries.set(key, entry)
  return entry.promise as Promise<T>
}

export function peekCache<T>(key: string): T | undefined {
  const entry = entries.get(key)
  return entry && !entry.pending && entry.expires > Date.now() ? entry.value as T : undefined
}

export function dataChanged() {
  invalidateReads()
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

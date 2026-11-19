import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeLiveRefresh } from './liveRefresh'

export function useRemoteData<T>(load: () => Promise<T>, keys: unknown[] = [], live = true, enabled = true) {
  const loader = useRef(load); loader.current = load
  const generation = useRef(0)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => {
    const request = ++generation.current
    setLoading(true)
    void loader.current().then(result => {
      if (request === generation.current) { setData(result); setError('') }
    }).catch(error => {
      if (request === generation.current) setError(error)
    }).finally(() => { if (request === generation.current) setLoading(false) })
  }, [])
  const signature = JSON.stringify(keys)
  useEffect(() => {
    if (!enabled) { setLoading(true); return () => { generation.current++ } }
    setData(null); refresh()
    const unsubscribe = live ? subscribeLiveRefresh(refresh) : () => {}
    return () => { generation.current++; unsubscribe() }
  }, [signature, live, enabled, refresh])
  return { data, error, loading, refresh }
}

// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeLiveRefresh } from './liveRefresh'
import { CATALOG_TTL, clearDataSession, sharedRead } from './dataCache'
let unsubscribers: (() => void)[] = []
beforeEach(() => { vi.useFakeTimers(); clearDataSession(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible') })
afterEach(() => { unsubscribers.forEach(unsubscribe => unsubscribe()); unsubscribers = []; vi.useRealTimers(); vi.restoreAllMocks() })
describe('Atualização compartilhada', () => {
  it('mantém um único timer e o remove depois da última tela', async () => {
    const a = vi.fn(), b = vi.fn(), ua = subscribeLiveRefresh(a), ub = subscribeLiveRefresh(b)
    unsubscribers.push(ua, ub); expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(30_000); expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1)
    ua(); expect(vi.getTimerCount()).toBe(1)
    ub(); expect(vi.getTimerCount()).toBe(0); unsubscribers = []
  })
  it('não faz polling oculto e combina foco/visibilidade/online ao retornar', async () => {
    const refresh = vi.fn(); unsubscribers.push(subscribeLiveRefresh(refresh))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).not.toHaveBeenCalled()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(50); expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('retorno à aba invalida catálogo mesmo dentro do TTL', async () => {
    const load = vi.fn().mockResolvedValue('referência'); await sharedRead('catalog:test', load, CATALOG_TTL)
    unsubscribers.push(subscribeLiveRefresh(() => {}))
    window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(50)
    await sharedRead('catalog:test', load, CATALOG_TTL); expect(load).toHaveBeenCalledTimes(2)
  })
})

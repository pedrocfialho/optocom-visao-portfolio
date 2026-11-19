// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_TTL, clearDataSession, invalidateCache, setDataSession, sharedRead } from './dataCache'
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(clearDataSession)
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('Cache de dados por sessão', () => {
  it('deduplica recursos em andamento e só armazena resultados quando há TTL', async () => {
    const d = deferred<string>(), load = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue('novo')
    const a = sharedRead('read:test', load), b = sharedRead('read:test', load)
    expect(a).toBe(b); await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1)
    d.resolve('primeiro'); expect(await a).toBe('primeiro'); expect(await b).toBe('primeiro')
    expect(await sharedRead('read:test', load)).toBe('novo'); expect(load).toHaveBeenCalledTimes(2)
  })
  it('catálogos expiram em 60s, sem persistência em disco', async () => {
    vi.useFakeTimers(); const disk = vi.spyOn(Storage.prototype, 'setItem'), load = vi.fn().mockResolvedValue(['ativo'])
    await sharedRead('catalog:test', load, CATALOG_TTL)
    await vi.advanceTimersByTimeAsync(30_000); await sharedRead('catalog:test', load, CATALOG_TTL)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_001); await sharedRead('catalog:test', load, CATALOG_TTL)
    expect(load).toHaveBeenCalledTimes(2); expect(disk).not.toHaveBeenCalled()
  })
  it('invalida somente o recurso alterado', async () => {
    const a = vi.fn().mockResolvedValue(1), b = vi.fn().mockResolvedValue(2)
    await sharedRead('catalog:a', a, CATALOG_TTL); await sharedRead('catalog:b', b, CATALOG_TTL)
    invalidateCache('catalog:a')
    await sharedRead('catalog:a', a, CATALOG_TTL); await sharedRead('catalog:b', b, CATALOG_TTL)
    expect(a).toHaveBeenCalledTimes(2); expect(b).toHaveBeenCalledTimes(1)
  })
  it('resposta invalidada em andamento não repovoa catálogo antigo', async () => {
    const d = deferred<string>(), load = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue('novo')
    const old = sharedRead('catalog:test', load, CATALOG_TTL)
    await Promise.resolve(); invalidateCache('catalog:test')
    expect(await sharedRead('catalog:test', load, CATALOG_TTL)).toBe('novo')
    d.resolve('antigo'); await old
    expect(await sharedRead('catalog:test', load, CATALOG_TTL)).toBe('novo'); expect(load).toHaveBeenCalledTimes(2)
  })
  it('troca de usuário limpa dados e rejeita a resposta da sessão anterior', async () => {
    setDataSession('a'); const d = deferred<string>(), load = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue('usuário b')
    const old = sharedRead('catalog:test', load, CATALOG_TTL)
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve(); setDataSession('b'); d.resolve('usuário a'); await rejected
    expect(await sharedRead('catalog:test', load, CATALOG_TTL)).toBe('usuário b')
    setDataSession('b'); await sharedRead('catalog:test', load, CATALOG_TTL); expect(load).toHaveBeenCalledTimes(2)
  })
  it('falhas não são armazenadas em cache', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok')
    await expect(sharedRead('catalog:test', load, CATALOG_TTL)).rejects.toThrow('offline')
    expect(await sharedRead('catalog:test', load, CATALOG_TTL)).toBe('ok')
  })
})

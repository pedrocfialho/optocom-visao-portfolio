// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { describe, expect, it } from 'vitest'
import { readPublicConfig } from './env'

describe('Configuração pública', () => {
  it('permite somente prévia quando não há configuração', () => {
    expect(readPublicConfig({})).toBeNull()
  })
  it('não trata configuração incompleta como modo de prévia', () => {
    expect(() => readPublicConfig({ VITE_SUPABASE_URL: 'https://clinic.supabase.co' })).toThrow()
  })
  it('rejeita conexão remota sem TLS', () => {
    expect(() => readPublicConfig({ VITE_SUPABASE_URL: 'http://clinic.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_only' })).toThrow('HTTPS')
  })
  it('aceita chave pública e rejeita secret/service_role', () => {
    const env = { VITE_SUPABASE_URL: 'https://clinic.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_only' }
    expect(readPublicConfig(env)?.url).toBe(env.VITE_SUPABASE_URL)
    expect(() => readPublicConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_only' })).toThrow()
    const jwt = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`
    expect(() => readPublicConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: jwt })).toThrow('nunca service_role')
    const anon = `header.${btoa(JSON.stringify({ role: 'anon' }))}.signature`
    expect(readPublicConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: anon })?.key).toBe(anon)
  })
})

// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { describe, expect, it } from 'vitest'
import { readAdminConfig } from './admin-config.mjs'
const env = {
  SUPABASE_URL: 'https://clinic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-example', APP_URL: 'http://localhost:5173',
  ADMIN_1_NAME: 'Pessoa Um', ADMIN_1_EMAIL: 'um@example.com',
  ADMIN_2_NAME: 'Pessoa Dois', ADMIN_2_EMAIL: 'dois@example.com',
  ADMIN_3_NAME: 'Pessoa Três', ADMIN_3_EMAIL: 'tres@example.com',
}
describe('Provisionamento administrativo', () => {
  it('exige três identidades completas e diferentes', () => {
    expect(readAdminConfig(env).admins).toHaveLength(3)
    expect(() => readAdminConfig({ ...env, ADMIN_3_EMAIL: '' })).toThrow()
    expect(() => readAdminConfig({ ...env, ADMIN_3_EMAIL: 'UM@example.com' })).toThrow('diferentes')
  })
  it('exige HTTPS para convite em produção', () => {
    expect(() => readAdminConfig({ ...env, APP_URL: 'http://clinic.example.com' })).toThrow('HTTPS')
    expect(readAdminConfig(env).redirectTo).toBe('http://localhost:5173/definir-senha')
  })
})

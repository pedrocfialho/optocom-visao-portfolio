// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { describe, expect, it } from 'vitest'
import { passwordFlowFromHash } from './passwordFlow'

describe('Reconhecimento do callback Supabase', () => {
  it('reconhece convite e recuperação sem interpretar tokens', () => {
    expect(passwordFlowFromHash('#type=invite')).toBe(true)
    expect(passwordFlowFromHash('#type=recovery')).toBe(true)
    expect(passwordFlowFromHash('#type=signup')).toBe(false)
    expect(passwordFlowFromHash('')).toBe(false)
  })
})

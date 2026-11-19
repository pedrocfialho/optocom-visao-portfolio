// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { expect, it } from 'vitest'
import { clinicDate } from './format'
it('exibe o dia correto em São Paulo perto da meia-noite UTC', () => {
  expect(clinicDate(new Date('2026-10-30T01:00:00Z'))).toContain('29 de outubro de 2026')
})

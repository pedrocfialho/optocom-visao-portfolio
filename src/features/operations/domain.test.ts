// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { expect, it } from 'vitest'
import { clinicInstant, clinicParts, dayRange, moneyCents, visitTotal } from './domain'

it('soma valores monetários em centavos sem erro de ponto flutuante', () => {
  expect(visitTotal('180,00', '20,00', ['80,00', '40,00'])).toEqual({ consultation: 16000, total: 28000 })
  expect(visitTotal('0', '0', [])).toEqual({ consultation: 0, total: 0 })
  expect(visitTotal('0,10', '0', ['0,20']).total).toBe(30)
  expect(() => visitTotal('10', '11', [])).toThrow('desconto')
  for (const value of ['-1', 'NaN', 'Infinity', '1.001', '']) expect(() => moneyCents(value)).toThrow()
})
it('converte agenda no fuso da clínica mesmo com navegador em outro fuso', () => {
  expect(clinicInstant('2026-11-03', '09:00')).toBe('2026-11-03T12:00:00.000Z')
  expect(clinicInstant('2026-11-03', '23:30')).toBe('2026-11-04T02:30:00.000Z')
  expect(clinicParts(new Date('2026-11-04T02:30:00Z'))).toEqual({ date: '2026-11-03', time: '23:30' })
  expect(dayRange('2026-12-31')).toEqual(['2026-12-31T03:00:00.000Z', '2027-01-01T03:00:00.000Z'])
})

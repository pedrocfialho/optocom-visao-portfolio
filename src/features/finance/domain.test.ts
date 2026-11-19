// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {describe,expect,it} from 'vitest'
import {csv,dateLabel,money,period,signedMoney} from './domain'
describe('Apresentação e exportação financeira',()=>{
 it('mês anterior respeita virada de ano e fevereiro bissexto',()=>{expect(period('previous','2026-01-09')).toEqual({from:'2025-12-01',to:'2025-12-31'});expect(period('previous','2024-03-31')).toEqual({from:'2024-02-01',to:'2024-02-29'})})
 it('preserva centavos e recusa valores ambíguos/subcentavos',()=>{expect(money('150,10')).toBe('150.10');expect(signedMoney('-4,10')).toBe('-4.10');expect(()=>money('1.234')).toThrow();expect(()=>money('NaN')).toThrow()})
 it('neutraliza fórmulas de planilha sem quebrar aspas, delimitadores e números',()=>{const output=csv([['=HYPERLINK("malicioso")','  +CMD','@SUM(1)',-2.5,'Texto; com "aspas"']]);expect(output).toContain("'=HYPERLINK");expect(output).toContain("'  +CMD");expect(output).toContain("'@SUM");expect(output).toContain('"-2,50"');expect(output).toContain('"Texto; com ""aspas"""')})
 it('usa a data clínica em instantes próximos da virada UTC',()=>{expect(dateLabel('2026-11-05T01:30:00Z')).toBe('04/11/2026');expect(dateLabel('2026-11-05')).toBe('05/11/2026')})
 it('calcula meses bissextos, ano e período diário sem trocar o fuso',()=>{expect(period('month','2024-02-29')).toEqual({from:'2024-02-01',to:'2024-02-29'});expect(period('year','2026-11-04')).toEqual({from:'2026-01-01',to:'2026-12-31'});expect(period('today','2026-11-04')).toEqual({from:'2026-11-04',to:'2026-11-04'})})
})

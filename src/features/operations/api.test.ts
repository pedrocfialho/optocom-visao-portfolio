// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), fetches: vi.fn(), selects: vi.fn(), save: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }))
import * as api from './api'
import { clearDataSession } from '../../lib/dataCache'
beforeEach(() => {
  clearDataSession(); vi.clearAllMocks()
  mocks.save.mockResolvedValue({ data: { id: 'p', version: 2, full_name: 'Atualizado', active: true }, error: null })
  mocks.from.mockImplementation((table: string) => {
    const builder = {
      select: (columns: string) => { mocks.selects(table, columns); return builder },
      order: () => builder, eq: () => builder, update: () => builder,
      range: () => { mocks.fetches(table); return Promise.resolve({ data: [], error: null }) },
      maybeSingle: mocks.save,
    }
    return builder
  })
})
describe('Catálogos operacionais e projeções', () => {
  it('Agenda não busca exames; páginas compartilham os outros catálogos', async () => {
    await Promise.all([api.agendaCatalogs(), api.agendaCatalogs()])
    expect(mocks.fetches.mock.calls.flat().sort()).toEqual(['appointment_types', 'professionals'])
    await api.catalogs()
    expect(mocks.fetches.mock.calls.flat().sort()).toEqual(['appointment_types', 'exams', 'professionals'])
    expect(mocks.selects.mock.calls.every(([, columns]) => !columns.includes('*'))).toBe(true)
  })
  it('salvar profissional invalida imediatamente somente esse catálogo', async () => {
    await api.catalogs()
    await api.saveCatalog('professionals', { name: 'Atualizado', price: 0, active: true }, { id: 'p', version: 1 })
    await api.catalogs()
    expect(mocks.fetches.mock.calls.flat().filter(x => x === 'professionals')).toHaveLength(2)
    expect(mocks.fetches.mock.calls.flat().filter(x => x === 'appointment_types')).toHaveLength(1)
    expect(mocks.fetches.mock.calls.flat().filter(x => x === 'exams')).toHaveLength(1)
  })
  it('listagem de atendimentos preserva campos visíveis sem notas/metadata', async () => {
    await Promise.all([api.visits(), api.visits()])
    expect(mocks.fetches).toHaveBeenCalledTimes(1)
    const columns = mocks.selects.mock.calls[0][1]
    expect(columns).toContain('consultation_name_snapshot'); expect(columns).toContain('total_amount')
    expect(columns).not.toContain('*'); expect(columns).not.toContain('admin_notes'); expect(columns).not.toContain('created_by')
  })
})

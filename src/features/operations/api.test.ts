// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), fetches: vi.fn(), selects: vi.fn(), save: vi.fn(), write: vi.fn(), eq: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
import * as api from './api'
import { clearDataSession } from '../../lib/dataCache'
beforeEach(() => {
  clearDataSession(); vi.clearAllMocks()
  mocks.save.mockResolvedValue({ data: { id: 'p', version: 2, full_name: 'Atualizado', active: true }, error: null })
  mocks.from.mockImplementation((table: string) => {
    const builder = {
      select: (columns: string) => { mocks.selects(table, columns); return builder },
      order: () => builder,
      eq: (column:string,value:unknown) => { mocks.eq(column,value);return builder },
      insert: (input:unknown) => { mocks.write('insert',input);return builder },
      update: (input:unknown) => { mocks.write('update',input);return builder },
      range: () => { mocks.fetches(table); return Promise.resolve({ data: [], error: null }) },
      maybeSingle: mocks.save,
    }
    return builder
  })
})
describe('Catálogos operacionais e projeções', () => {
  it('formulário normal cria paciente completo sem telefone ou outros campos opcionais',async()=>{
    const input={full_name:'Ana Exemplo',phone:null,birth_date:null,cpf:null,admin_notes:'',active:true}
    await api.savePatient(input,null)
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('insert',{...input,registration_pending:false})
  })
  it('completar cadastro atualiza o mesmo ID e versão, sem INSERT e sem exigir telefone',async()=>{
    const input={full_name:'Ana Exemplo',phone:null,birth_date:null,cpf:null,admin_notes:'',active:true}
    await api.savePatient(input,{id:'patient-example',version:3})
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('update',{...input,registration_pending:false})
    expect(mocks.eq).toHaveBeenCalledWith('id','patient-example');expect(mocks.eq).toHaveBeenCalledWith('version',3)
  })
  it('cadastro rápido envia uma única RPC atômica, sem INSERT separado de paciente', async () => {
    const input={full_name:'Ana Exemplo',professional_id:'pro',appointment_type_id:'type',start_at:'2030-01-01T17:00:00Z',status:'scheduled' as const,admin_notes:''}
    mocks.rpc.mockResolvedValue({data:{id:'appointment-example',patient_id:'patient-example'},error:null})
    expect(await api.scheduleNewPatient(input)).toMatchObject({id:'appointment-example'})
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('schedule_new_patient',{p_data:input})
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('migration ausente informa a dependência sem tentar criar dados por outro caminho', async () => {
    mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}})
    await expect(api.scheduleNewPatient({full_name:'Ana Exemplo',professional_id:'pro',appointment_type_id:'type',start_at:'2030-01-01T17:00:00Z',status:'scheduled',admin_notes:''})).rejects.toThrow('Nenhum paciente ou agendamento foi criado')
    expect(mocks.from).not.toHaveBeenCalled()
  })
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

// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {act,renderHook} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('./supabase',()=>({supabase:{rpc}}))
import {manageRemoval} from './recordRemoval'
import {useRecordRemoval} from './useRecordRemoval'
beforeEach(()=>{rpc.mockReset();vi.spyOn(window,'confirm').mockReturnValue(true)})
afterEach(()=>vi.restoreAllMocks())
describe('Exclusão com confirmação, proteção contra repetição e habilitação explícita',()=>{
 it('migration ausente não tenta DELETE direto nem inativação silenciosa',async()=>{
  rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}})
  await expect(manageRemoval('patients','id',1)).rejects.toThrow('Nenhum registro foi alterado')
  expect(rpc).toHaveBeenCalledTimes(1)
 })
 it('cancelar confirmação não altera o registro',async()=>{
  vi.mocked(window.confirm).mockReturnValue(false);rpc.mockResolvedValue({data:{action:'delete',name:'Paciente local',linked:false,version:1},error:null})
  const done=vi.fn(),{result}=renderHook(()=>useRecordRemoval((e:unknown)=>String(e)))
  await act(()=>result.current.remove('patients','id',1,done))
  expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][1].p_confirm).toBe(false);expect(done).not.toHaveBeenCalled()
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Paciente local'))
 })
 it('dois cliques simultâneos geram somente um preview e uma alteração',async()=>{
  let resolve!:(value:unknown)=>void
  rpc.mockReturnValueOnce(new Promise(r=>{resolve=r})).mockResolvedValue({data:{action:'deactivate',name:'Histórico',linked:true,version:1},error:null})
  const done=vi.fn(),{result}=renderHook(()=>useRecordRemoval((e:unknown)=>String(e)))
  let pending!:Promise<void>;act(()=>{pending=result.current.remove('patients','id',1,done);void result.current.remove('patients','id',1,done)})
  expect(rpc).toHaveBeenCalledTimes(1)
  await act(async()=>{resolve({data:{action:'deactivate',name:'Histórico',linked:true,version:1},error:null});await pending})
  expect(rpc).toHaveBeenCalledTimes(2);expect(done).toHaveBeenCalledOnce();expect(result.current.message).toContain('Nenhum dado histórico foi apagado')
 })
})

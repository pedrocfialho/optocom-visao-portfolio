// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {beforeEach,describe,expect,it,vi} from 'vitest'
const {rpc,from,presence}=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),presence:vi.fn()}))
vi.mock('../../lib/supabase',()=>({supabase:{rpc,from}}))
import * as api from './api'
import { clearDataSession, setDataSession } from '../../lib/dataCache'
beforeEach(()=>{clearDataSession();rpc.mockReset();presence.mockReset().mockResolvedValue({data:[],error:null});from.mockReset().mockImplementation(()=>({select:()=>({eq:()=>({limit:presence})})}))})
describe('Cliente financeiro sem gravação remota',()=>{
 it('reutiliza identificador após resposta de rede perdida, evitando duplicação',async()=>{
  rpc.mockResolvedValueOnce({data:null,error:{message:'Falha de rede de teste'}}).mockResolvedValueOnce({data:{ok:true},error:null})
  const payload={action:'save_catalog',table:'financial_accounts',fields:{name:'Conta de teste',kind:'cash'}}
  await expect(api.command(payload)).rejects.toMatchObject({message:'Falha de rede de teste'})
  expect(await api.command(payload)).toEqual({ok:true})
  expect(rpc.mock.calls[0][1].p_data.request_id).toBe(rpc.mock.calls[1][1].p_data.request_id)
 })
 it('normaliza centavos sem enviar totais de taxa/líquido calculados pelo cliente',async()=>{
  rpc.mockResolvedValue({data:{},error:null})
  await api.registerReceipt({visit_id:'teste',visit_version:1,finance_version:0} as never,{applied_on:'2026-11-04',balance_due_on:'2026-11-04',complete_financial:false,payments:[{method_id:'metodo-teste',account_id:'conta-teste',gross_amount:'150,10',installments:1,received_now:true,fee_rule_id:null}]})
  expect(rpc.mock.calls[0][1].p_data.payments[0].gross_amount).toBe('150.10')
  expect(rpc.mock.calls[0][1].p_data.payments[0]).not.toHaveProperty('fee_amount')
 })
 it('explica a ausência da migration sem sugerir falha da autenticação',()=>{expect(api.errorText({code:'PGRST202'})).toContain('financeiro ainda não foi liberado');expect(api.errorText({code:'40001'})).toContain('Outro computador')})
 it('mantém leitura financeira com aviso quando uma recorrência exige correção',async()=>{
  presence.mockResolvedValue({data:[{id:'regra'}],error:null})
  rpc.mockResolvedValueOnce({data:null,error:{code:'P0001',message:'Conta da recorrência inativa'}}).mockResolvedValueOnce({data:{from:'2026-11-04',to:'2026-11-04',summary:{gross_revenue:10}},error:null})
  const result=await api.report('2026-11-04','2026-11-04');expect(result.summary.gross_revenue).toBe(10);expect(result.generation_warning).toContain('Conta da recorrência inativa')
 })
 it('compartilha catálogos e invalida após alteração financeira bem sucedida',async()=>{
  rpc.mockResolvedValue({data:{recurring:[],methods:[]},error:null})
  await Promise.all([api.catalogs(),api.catalogs(),api.catalogs()]);await api.catalogs()
  expect(rpc).toHaveBeenCalledTimes(1)
  await api.command({action:'save_catalog',table:'payment_methods',fields:{name:'PIX'}})
  await api.catalogs();expect(rpc.mock.calls.map(x=>x[0])).toEqual(['finance_catalogs','finance_command','finance_catalogs'])
 })
 it('relatórios não carregam catálogos completos; compartilham RPC simultânea e mantêm filtros/valores',async()=>{
  rpc.mockResolvedValue({data:{from:'2026-11-01',to:'2026-11-05',summary:{gross_revenue:310,fees:4.10}},error:null})
  const [a,b]=await Promise.all([api.report('2026-11-01','2026-11-05'),api.report('2026-11-01','2026-11-05')])
  expect(a).toEqual(b);expect(a.summary.gross_revenue).toBe(310);expect(a.summary.fees).toBe(4.10)
  expect(rpc).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledWith('finance_report',{p_from:'2026-11-01',p_to:'2026-11-05'});expect(presence).toHaveBeenCalledTimes(1)
  await api.report('2026-11-01','2026-11-05');expect(rpc).toHaveBeenCalledTimes(2);expect(presence).toHaveBeenCalledTimes(1)
 })
 it('catálogo já carregado evita até a consulta leve de presença de recorrência',async()=>{
  rpc.mockResolvedValueOnce({data:{recurring:[]},error:null}).mockResolvedValue({data:{summary:{}},error:null})
  await api.catalogs();await api.report('2026-11-01','2026-11-05')
  expect(from).not.toHaveBeenCalled();expect(rpc.mock.calls.map(x=>x[0])).toEqual(['finance_catalogs','finance_report'])
 })
 it('aguarda geração de recorrências antes dos indicadores, uma vez por dia/sessão',async()=>{
  presence.mockResolvedValue({data:[{id:'regra'}],error:null})
  let finish!:()=>void
  rpc.mockImplementation((name:string)=>name==='finance_command'?new Promise(resolve=>{finish=()=>resolve({data:{generated:1},error:null})}):Promise.resolve({data:{summary:{gross_revenue:20}},error:null}))
  const first=api.report('2026-11-05','2026-11-05'),second=api.report('2026-11-05','2026-11-05')
  await vi.waitFor(()=>expect(rpc).toHaveBeenCalledTimes(1))
  expect(rpc.mock.calls[0][0]).toBe('finance_command');finish();await Promise.all([first,second])
  expect(rpc.mock.calls.map(x=>x[0])).toEqual(['finance_command','finance_report'])
  await api.report('2026-11-05','2026-11-05');expect(rpc.mock.calls.filter(x=>x[0]==='finance_command')).toHaveLength(1)
 })
 it('não ignora erro de autorização ao consultar a presença de recorrências',async()=>{
  presence.mockResolvedValue({data:null,error:{code:'42501'}})
  await expect(api.report('2026-11-05','2026-11-05')).rejects.toMatchObject({code:'42501'})
  expect(rpc).not.toHaveBeenCalled()
 })
 it('deduplica filtros equivalentes independentemente da ordem das propriedades',async()=>{
  const execute=vi.fn().mockResolvedValue({data:[],error:null})
  const query={select:()=>query,order:()=>query,range:()=>query,eq:()=>query,then:(resolve:(value:unknown)=>unknown)=>execute().then(resolve)}
  from.mockReturnValue(query)
  await Promise.all([api.entries({direction:'expense',status:'pending',offset:0}),api.entries({offset:0,status:'pending',direction:'expense'})])
  expect(from).toHaveBeenCalledTimes(1);expect(execute).toHaveBeenCalledTimes(1)
 })
 it('catálogo invalidado em andamento não contamina a checagem de recorrência nova',async()=>{
  let finish!:(value:unknown)=>void
  rpc.mockImplementation((name:string)=>name==='finance_catalogs'?new Promise(resolve=>{finish=resolve}):Promise.resolve({data:{summary:{}},error:null}))
  const old=api.catalogs();await vi.waitFor(()=>expect(rpc).toHaveBeenCalledTimes(1))
  await api.command({action:'save_catalog',table:'financial_accounts',fields:{name:'Banco'}})
  finish({data:{recurring:[{active:true}]},error:null});await old
  await api.report('2026-11-05','2026-11-05')
  expect(presence).toHaveBeenCalledTimes(1)
  expect(rpc.mock.calls.filter(x=>x[0]==='finance_command')).toHaveLength(1)
 })
 it('retry financeiro sobrevive à revalidação mas não é reutilizado por outra identidade',async()=>{
  const payload={action:'save_entry',fields:{description:'Retry sintético isolado',gross_amount:'10.00'}}
  setDataSession('a');rpc.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}}).mockResolvedValue({data:{ok:true},error:null})
  await expect(api.command(payload)).rejects.toMatchObject({message:'Resposta perdida'})
  const first=rpc.mock.calls[0][1].p_data.request_id
  clearDataSession();setDataSession('a');await api.command(payload)
  expect(rpc.mock.calls[1][1].p_data.request_id).toBe(first)
  rpc.mockResolvedValueOnce({data:null,error:{message:'Outra perda'}})
  await expect(api.command(payload)).rejects.toMatchObject({message:'Outra perda'})
  const ownerA=rpc.mock.calls[2][1].p_data.request_id
  clearDataSession();setDataSession('b');await api.command(payload)
  expect(rpc.mock.calls[3][1].p_data.request_id).not.toBe(ownerA)
 })
})

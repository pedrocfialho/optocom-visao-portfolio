import { supabase } from '../../lib/supabase'
import type { Json } from '../../lib/database.types'
import type { CardSettlementDetails,CardSettlementReport,EntryRow, EntryStatus, FinanceCatalogs, FinanceReport, LoanBalance, Payment, PaymentBundle, Receivable, VisitBalance } from '../../lib/finance.types'
import type { VisitInput } from '../operations/api'
import { CATALOG_TTL, dataChanged, dataSessionId, invalidateCache, invalidateReads, peekCache, sharedRead } from '../../lib/dataCache'
import { money,today } from './domain'
function client(){if(!supabase)throw new Error('Conecte o Supabase para acessar o financeiro.');return supabase}
export function errorText(error:unknown){const e=error as {code?:string;message?:string};if(['PGRST202','PGRST205','42P01','42883'].includes(e.code??''))return 'O financeiro ainda não foi liberado no banco. Os cadastros e atendimentos continuam disponíveis.';if(['40001','40P01'].includes(e.code??''))return 'Outro computador alterou este registro. Recarregue antes de salvar.';if(e.code==='42501')return 'Acesso restrito a administradores ativos.';if(e.code==='23505')return 'Este registro ou período já existe. Recarregue para evitar duplicidade.';if(['23514','23502','22P02','22003','22007','22008'].includes(e.code??''))return 'Revise campos obrigatórios, datas, taxas e valores.';return e.message??'Não foi possível acessar o financeiro. Confira a conexão.'}
const pending=new Map<string,string>()
function unavailable(error:{code?:string}|null){return error&&['PGRST202','42883'].includes(error.code??'')}
export function cardSettlementReport(from:string,to:string){return sharedRead('read:card-report:'+JSON.stringify([from,to]),async()=>{const {data,error}=await client().rpc('card_settlement_report',{p_from:from,p_to:to});if(unavailable(error))return null;if(error)throw error;return data as unknown as CardSettlementReport|null})}
export function cardSettlementDetails(id:string){return sharedRead('read:card-details:'+id,async()=>{const {data,error}=await client().rpc('card_settlement_details',{p_entry_id:id});if(unavailable(error))return null;if(error)throw error;return data as unknown as CardSettlementDetails|null})}
export async function cardException(payload:Record<string,unknown>){const key=JSON.stringify(['card-exception',dataSessionId(),payload]),rid=pending.get(key)??crypto.randomUUID();pending.set(key,rid);const {data,error}=await client().rpc('card_settlement_exception',{p_data:{...payload,request_id:rid} as Json});if(error)throw error;pending.delete(key);dataChanged();return data as unknown as CardSettlementDetails}
export async function command<T=Record<string,unknown>>(payload:Record<string,unknown>,quiet=false):Promise<T>{
 // Preservar o identificador de retry após falha transitória de Auth, sem reutilizá-lo por outro usuário.
 const key=JSON.stringify([dataSessionId(),payload]),requestId=pending.get(key)??crypto.randomUUID();pending.set(key,requestId)
 const {data,error}=await client().rpc('finance_command',{p_data:{...payload,request_id:requestId} as Json});if(error)throw error
 pending.delete(key)
 if(['save_catalog','save_rate','toggle_rate','save_recurring'].includes(String(payload.action))){invalidateCache('catalog:financial');invalidateCache('catalog:recurring-presence')}
 if(payload.action==='save_recurring')invalidateCache('once:recurring:')
 if(quiet)invalidateReads();else dataChanged();return data as unknown as T
}
export function catalogs(){return sharedRead('catalog:financial',async()=>{const {data,error}=await client().rpc('finance_catalogs');if(error)throw error;return data as unknown as FinanceCatalogs},CATALOG_TTL)}
function hasRecurring(){
 const config=peekCache<FinanceCatalogs>('catalog:financial')
 if(config)return Promise.resolve(config.recurring.some(x=>x.active))
 return sharedRead('catalog:recurring-presence',async()=>{
 const {data,error}=await client().from('recurring_expenses').select('id').eq('active',true).limit(1)
 if(error)throw error
 return data.length>0
},CATALOG_TTL)}
export async function report(from:string,to:string){
 let generationWarning=''
 if(await hasRecurring()){
  try{await sharedRead('once:recurring:'+today(),()=>command({action:'generate_recurring',months:3},true),86_400_000)}catch(error){generationWarning='Previsões recorrentes não geradas: '+errorText(error)}
 }
 const result=await sharedRead('read:report:'+JSON.stringify([from,to]),async()=>{const {data,error}=await client().rpc('finance_report',{p_from:from,p_to:to});if(error)throw error;return data as unknown as FinanceReport})
 return {...result,...(generationWarning?{generation_warning:generationWarning}:{})}
}
const BALANCE_COLUMNS='visit_id,patient_id,patient_name,visit_at,visit_status,visit_version,finance_version,due_on,total_amount,consultation_final,allocated_amount,pending_amount,financial_status' as const
const ENTRY_COLUMNS='id,version,direction,origin,visit_id,payment_id,supplier_id,loan_id,recurring_id,installment_no,recurrence_period,description,category_id,category_name_snapshot,impact_snapshot,account_id,method_id,method_name_snapshot,method_kind_snapshot,competence,due_on,settled_on,gross_amount,fee_amount,net_amount,status,notes,cancel_reason,supplier_name,account_name,patient_name,fee_rule_id,percentage_snapshot,fixed_fee_snapshot' as const
const RECEIVABLE_COLUMNS='id,source_type,visit_id,patient_name,description,gross_amount,fee_amount,net_amount,due_on,settled_on,status,version,method_name_snapshot,account_name' as const
export function charges(id?:string,offset=0){return sharedRead('read:charges:'+JSON.stringify([id,offset]),async()=>{let query=client().from('finance_visit_balances').select(BALANCE_COLUMNS).eq('visit_status','completed').order('visit_at',{ascending:false}).range(offset,offset+20);if(id)query=query.eq('visit_id',id);const {data,error}=await query;if(error)throw error;return data})}
export function receipt(visitId:string){return sharedRead('read:receipt:'+visitId,async()=>{const [balances,{data:payments,error},{data:entries,error:entriesError}]=await Promise.all([charges(visitId),client().from('finance_payments').select('*').eq('visit_id',visitId).order('created_at'),client().from('finance_entry_overview').select(ENTRY_COLUMNS).eq('visit_id',visitId).order('due_on')]);if(error||entriesError)throw error??entriesError;if(!balances[0])throw new Error('Atendimento concluído não encontrado.');return {balance:balances[0],payments:payments as Payment[],entries:entries as EntryRow[]}})}
function normalizedBundle(bundle:PaymentBundle){return {...bundle,payments:bundle.payments.map(p=>({...p,gross_amount:money(p.gross_amount)}))}}
export function registerReceipt(balance:VisitBalance,bundle:PaymentBundle){return command<VisitBalance>({action:'register_visit',visit_id:balance.visit_id,visit_version:balance.visit_version,finance_version:balance.finance_version,...normalizedBundle(bundle)})}
export function finishVisit(visit:VisitInput,bundle:PaymentBundle){return command<VisitBalance&{visit:import('../../lib/database.types').Visit}>({action:'finish_visit',visit_data:visit,...normalizedBundle(bundle)})}
export function entries(options:{direction?:'income'|'expense';supplierId?:string;loanId?:string;categoryId?:string;status?:string;from?:string;to?:string;offset?:number;ascending?:boolean}={}){return sharedRead('read:entries:'+JSON.stringify([options.direction,options.supplierId,options.loanId,options.categoryId,options.status,options.from,options.to,options.offset??0,options.ascending??false]),async()=>{
 let query=client().from('finance_entry_overview').select(ENTRY_COLUMNS).order('due_on',{ascending:options.ascending??false}).order('id').range(options.offset??0,(options.offset??0)+20)
 if(options.categoryId)query=query.eq('category_id',options.categoryId);if(options.direction)query=query.eq('direction',options.direction);if(options.status)query=query.eq('status',options.status as EntryStatus);if(options.supplierId)query=query.eq('supplier_id',options.supplierId);if(options.loanId)query=query.eq('loan_id',options.loanId);if(options.from)query=query.gte('due_on',options.from);if(options.to)query=query.lte('due_on',options.to)
 const {data,error}=await query;if(error)throw error;return data
})}
export function entry(id:string){return sharedRead('read:entry:'+id,async()=>{const {data,error}=await client().from('finance_entry_overview').select(ENTRY_COLUMNS).eq('id',id).single();if(error)throw error;return data as EntryRow})}
export function receivables(options:{from?:string;to?:string;status?:string;offset?:number}={}){return sharedRead('read:receivables:'+JSON.stringify([options.from,options.to,options.status,options.offset??0]),async()=>{let query=client().from('finance_receivables').select(RECEIVABLE_COLUMNS).order('due_on').order('id').range(options.offset??0,(options.offset??0)+20);if(options.status)query=query.eq('status',options.status as EntryStatus);if(options.from)query=query.gte('due_on',options.from);if(options.to)query=query.lte('due_on',options.to);const {data,error}=await query;if(error)throw error;return data as Receivable[]})}
export function movements(entryId:string){return sharedRead('read:movements:'+entryId,async()=>{const {data,error}=await client().from('finance_movements').select('id,reversal_of,direction,occurred_on,gross_amount,fee_amount,net_amount,reason').eq('entry_id',entryId).order('created_at');if(error)throw error;return data})}
export function loans(offset=0){return sharedRead('read:loans:'+offset,async()=>{const {data,error}=await client().from('finance_loan_balances').select('*').order('received_on',{ascending:false}).order('id').range(offset,offset+20);if(error)throw error;return data as LoanBalance[]})}
export function closing(date:string){return sharedRead('read:closing:'+date,async()=>{const {data,error}=await client().from('daily_closings').select('id,version,closed_on,actual_by_method,notes,needs_review,difference').eq('closed_on',date).maybeSingle();if(error)throw error;return data})}
export function supplierBalances(offset=0){return sharedRead('read:suppliers:'+offset,async()=>{const {data,error}=await client().from('finance_supplier_balances').select('*').order('name').order('id').range(offset,offset+20);if(error)throw error;return data})}


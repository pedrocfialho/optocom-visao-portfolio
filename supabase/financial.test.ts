// @vitest-environment node
// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const admin='00000000-0000-4000-8000-000000000001', outsider='00000000-0000-4000-8000-000000000002'
type Row = Record<string, unknown>
async function scalar<T=unknown>(sql:string,args:unknown[]=[]):Promise<T> { const {rows}=await db.query<Record<string,T>>(sql,args);return Object.values(rows[0])[0] }
async function command(data:Row, requestId=crypto.randomUUID()) { return scalar<Row>('select public.finance_command($1::jsonb)',[JSON.stringify({...data,request_id:requestId})]) }
async function catalog(table:string,fields:Row) { return command({action:'save_catalog',table,fields}) }
let accounts:Row[],methods:Row[],categories:Row[],patient:string,professional:string,consultation:string,exam:string,visit:Row,rate:Row, balance:Row
const method=(kind:string)=>methods.find(x=>x.kind===kind)!.id
const category=(code:string)=>categories.find(x=>x.code===code)!.id
const account=()=>accounts[0].id
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date())
const visitData=()=>({request_id:crypto.randomUUID(),patient_id:patient,professional_id:professional,appointment_type_id:consultation,visit_at:today()+'T12:00:00-03:00',base_price:'180.00',consultation_discount:'20.00',exams:[{exam_id:exam,unit_price:'150.00'}],complete:true})
const payment=(kind:string,amount:string,extra:Row={})=>({method_id:method(kind),account_id:account(),gross_amount:amount,installments:1,received_now:kind!=='credit',...extra})
async function report(){return scalar<{summary:Record<string,number>;by_method:Row[]}>('select finance_report($1,$1)',[today()])}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;insert into auth.users values('${admin}'),('${outsider}');`)
 for(const name of ['202610300001_foundation.sql','20261103000100_operational_core.sql','20261104000100_financial_core.sql']) await db.exec(await readFile(new URL('./migrations/'+name,import.meta.url),'utf8'))
 await db.exec(`insert into users_profile(id,full_name) values('${admin}','Administrador financeiro de teste');set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);`)
 const catalogs=await scalar<{accounts:Row[];methods:Row[];categories:Row[]}>('select finance_catalogs()');accounts=catalogs.accounts;methods=catalogs.methods;categories=catalogs.categories
 patient=await scalar<string>("insert into patients(full_name,phone) values('Paciente financeiro de teste','51999990001') returning id")
 professional=await scalar<string>("insert into professionals(full_name) values('Profissional financeiro de teste') returning id")
 consultation=await scalar<string>("insert into appointment_types(name,default_price) values('Consulta de teste',180) returning id")
 exam=await scalar<string>("insert into exams(name,default_price) values('Exame de teste',150) returning id")
},30000)
afterAll(async()=>{await db.close()})
describe('Financeiro em PostgreSQL local real, sem tocar o Supabase remoto',()=>{
 it('cria somente objetos previstos e protege escrita direta/RLS',async()=>{
  expect(await scalar('select count(*)::int from pg_policies where policyname=\'finance_active_admin_read\'')).toBe(13)
  expect(await scalar('select count(*)::int from pg_class where relrowsecurity and relnamespace=\'public\'::regnamespace')).toBe(22)
  await expect(db.exec("insert into payment_methods(name,kind) values('Forjado','cash')")).rejects.toThrow('permission denied')
  await expect(db.exec('select finance_generate_recurring(3)')).rejects.toThrow('permission denied')
 })
 it('configura taxa real de teste sem taxa implícita para cartão',async()=>{
  rate=await command({action:'save_rate',fields:{method_id:method('credit'),acquirer:'Adquirente de teste',brand:'Bandeira de teste',installments:3,percentage:'2.5',fixed_fee:'0.10',settlement_days:30,interval_days:30,valid_from:today()}})
  expect(Number(rate.percentage)).toBe(2.5)
 })
 it('conclui atendimento + pagamento dividido + parcelas na mesma transação',async()=>{
  const data={...visitData(),total_amount:'0.00'},requestId=crypto.randomUUID()
  const lines=[payment('pix','150.00'),payment('credit','160.00',{installments:3,fee_rule_id:rate.id,received_now:false,fee_amount:'0.00',net_amount:'99999.00'})]
  balance=await command({action:'finish_visit',visit_data:data,applied_on:today(),complete_financial:true,payments:lines},requestId)
  visit=balance.visit as Row
  expect(Number(balance.total_amount)).toBe(310);expect(Number(balance.pending_amount)).toBe(0);expect(balance.financial_status).toBe('completed')
  const same=await command({action:'finish_visit',visit_data:data,applied_on:today(),complete_financial:true,payments:lines},requestId)
  expect(same.visit_id).toBe(balance.visit_id)
  expect(await scalar('select count(*)::int from finance_payments where visit_id=$1',[visit.id])).toBe(2)
  expect(await scalar('select sum(gross_amount)::text from finance_entries where visit_id=$1',[visit.id])).toBe('310.00')
  expect(await scalar('select sum(fee_amount)::text from finance_entries where visit_id=$1',[visit.id])).toBe('4.10')
  expect(await scalar('select sum(net_amount)::text from finance_entries where visit_id=$1',[visit.id])).toBe('305.90')
  const result=await report();expect(Number(result.summary.gross_revenue)).toBe(310);expect(Number(result.summary.receivable)).toBe(155.90);expect(Number(result.summary.cash_variation)).toBe(150)
 })
 it('falha atômica ao tentar concluir financeiro com soma incorreta',async()=>{
  const before=await scalar('select count(*)::int from visits')
  await expect(command({action:'finish_visit',visit_data:visitData(),applied_on:today(),complete_financial:true,payments:[payment('pix','10.00')]})).rejects.toThrow('soma')
  expect(await scalar('select count(*)::int from visits')).toBe(before)
 })
 it('permite parcial e saldo a receber, sem duplicar atendimento ou receita',async()=>{
  const data=visitData();const result=await command({action:'finish_visit',visit_data:data,applied_on:today(),complete_financial:false,payments:[payment('cash','100.00')]})
  expect(Number(result.pending_amount)).toBe(210);expect(result.financial_status).toBe('partial')
  expect(await scalar('select net_amount::text from finance_receivables where source_type=\'balance\' and visit_id=$1',[result.visit_id])).toBe('210.00')
  await expect(command({action:'register_visit',visit_id:result.visit_id,visit_version:result.visit_version,finance_version:0,applied_on:today(),payments:[]})).rejects.toThrow('Outro computador')
 })
 it('recusa NaN, subcentavos, excedente e cartão sem taxa; ignora líquido forjado',async()=>{
  for(const bad of ['NaN','Infinity','1.001','-1.00']) await expect(command({action:'finish_visit',visit_data:visitData(),applied_on:today(),payments:[payment('pix',bad)]})).rejects.toThrow()
  await expect(command({action:'finish_visit',visit_data:visitData(),applied_on:today(),payments:[payment('pix','999.00')]})).rejects.toThrow('ultrapassa')
  await expect(command({action:'finish_visit',visit_data:visitData(),applied_on:today(),payments:[payment('debit','310.00')]})).rejects.toThrow('taxa')
 })
 it('nova vigência preserva valores históricos; impede editar a taxa antiga',async()=>{
  await db.exec('reset role')
  await expect(db.query('update card_fee_rules set percentage=90 where id=$1',[rate.id])).rejects.toThrow('imutáveis')
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
  const tomorrow=await scalar<string>("select (current_date+1)::text")
  await command({action:'save_rate',fields:{method_id:method('credit'),acquirer:'Adquirente de teste',brand:'Bandeira de teste',installments:3,percentage:'5',fixed_fee:'1',settlement_days:30,valid_from:tomorrow}})
  expect(await scalar('select fee_amount::text from finance_payments where fee_rule_id=$1',[rate.id])).toBe('4.10')
 })
 it('mantém categorias estruturais e a modalidade de métodos já usados',async()=>{
  await expect(command({action:'save_catalog',table:'payment_methods',id:method('pix'),version:1,fields:{kind:'credit'}})).rejects.toThrow('Modalidade')
  await expect(command({action:'save_catalog',table:'finance_categories',id:category('capital'),version:1,fields:{impact:'revenue'}})).rejects.toThrow('classificação')
 })
 it('entrada manual com cartão exige taxa e mantém bruto, líquido e previsão calculados no banco',async()=>{
  const fields={direction:'income',description:'Receita manual de cartão de teste',category_id:category('other_revenue'),account_id:account(),method_id:method('credit'),competence:today(),due_on:today(),gross_amount:'100.00',fee_amount:'0.00',net_amount:'999.00'}
  await expect(command({action:'save_entry',fields})).rejects.toThrow('taxa vigente')
  const manualRate=await command({action:'save_rate',fields:{method_id:method('credit'),acquirer:'Adquirente manual de teste',brand:'Bandeira de teste',installments:1,percentage:'3',fixed_fee:'0.20',settlement_days:2,valid_from:today()}})
  const result=await command({action:'save_entry',fields:{...fields,fee_rule_id:manualRate.id}})
  expect(Number(result.fee_amount)).toBe(3.2);expect(Number(result.net_amount)).toBe(96.8)
  expect(result.due_on).toBe(await scalar('select (current_date+2)::text'))
  await expect(command({action:'settle_entry',id:result.id,version:result.version,date:today(),method_id:method('pix')})).rejects.toThrow('edite o lançamento')
 })
 it('recebe atendimento legado sem header financeiro e retorno zero sem criar receita fictícia',async()=>{
  await db.exec('reset role;alter table visits disable trigger sync_financial_visit;')
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
  const legacy=await scalar<Row>('select save_visit($1::jsonb)',[JSON.stringify({...visitData(),base_price:'0.00',consultation_discount:'0.00',exams:[]})])
  await db.exec('reset role;alter table visits enable trigger sync_financial_visit;')
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
  expect(await scalar('select finance_version from finance_visit_balances where visit_id=$1',[legacy.id])).toBe(0)
  const result=await command({action:'register_visit',visit_id:legacy.id,visit_version:legacy.version,finance_version:0,applied_on:today(),complete_financial:true,payments:[]})
  expect(result.financial_status).toBe('completed');expect(Number(result.total_amount)).toBe(0)
  expect(await scalar('select count(*)::int from finance_entries where visit_id=$1',[legacy.id])).toBe(0)
 })
 it('liquida parcela uma vez, preserva versão e gera movimento auditável',async()=>{
  const e=(await db.query<Row>("select * from finance_entries where visit_id=$1 and method_kind_snapshot='credit' order by installment_no",[visit.id])).rows[0]
  const paid=await command({action:'settle_entry',id:e.id,version:e.version,date:today()})
  await expect(command({action:'settle_entry',id:e.id,version:e.version,date:today()})).rejects.toThrow('Outro computador')
  expect(paid.status).toBe('settled');expect(await scalar('select count(*)::int from finance_movements where entry_id=$1',[e.id])).toBe(1)
  const reversed=await command({action:'reverse_entry',id:e.id,version:paid.version,date:today(),reason:'Liquidação de teste estornada'})
  expect(reversed.status).toBe('pending');expect(await scalar('select sum(case when direction=\'income\' then net_amount else -net_amount end)::text from finance_movements where entry_id=$1',[e.id])).toBe('0.00')
 })
 it('cadastra fornecedor, despesa, pagamento e estorno sem destruir histórico',async()=>{
  const supplier=await catalog('suppliers',{name:'Fornecedor de teste',phone:'51999990001',active:true})
  const e=await command({action:'save_entry',fields:{direction:'expense',description:'Despesa de teste',category_id:category('materials'),supplier_id:supplier.id,account_id:account(),method_id:method('pix'),competence:today(),due_on:today(),gross_amount:'50.00'}})
  const paid=await command({action:'settle_entry',id:e.id,version:e.version,date:today()})
  expect(await scalar('select count(*)::int from finance_entry_overview where supplier_id=$1',[supplier.id])).toBe(1)
  await command({action:'cancel_entry',id:paid.id,version:paid.version,date:today(),reason:'Despesa cancelada no teste'})
  expect(await scalar('select count(*)::int from finance_movements where entry_id=$1',[e.id])).toBe(2)
  expect(await scalar('select status from finance_entries where id=$1',[e.id])).toBe('cancelled')
 })
 it('gera recorrências sem duplicar competências em múltiplas chamadas',async()=>{
  const month=await scalar<string>("select date_trunc('month',current_date)::date::text")
  const rule=await command({action:'save_recurring',fields:{description:'Aluguel recorrente de teste',category_id:category('rent'),account_id:account(),method_id:method('pix'),amount:'100.00',day_of_month:31,start_month:month,active:true}})
  await command({action:'generate_recurring',months:3});await command({action:'generate_recurring',months:3})
  expect(await scalar('select count(*)::int from finance_entries where recurring_id=$1',[rule.id])).toBe(3)
 })
 it('empréstimo/aporte alteram caixa sem inflar faturamento; parcelas baixam saldo',async()=>{
  const before=await report()
  const loan=await command({action:'create_loan',fields:{institution:'Credor de teste',original_amount:'1000.00',received_on:today(),installment_count:4,installment_amount:'260.00',first_due_on:today(),account_id:account(),method_id:method('pix')}})
  const after=await report();expect(after.summary.gross_revenue).toBe(before.summary.gross_revenue);expect(Number(after.summary.cash_variation)-Number(before.summary.cash_variation)).toBe(1000)
  expect(await scalar('select remaining_amount::text from finance_loan_balances where id=$1',[loan.id])).toBe('1040.00')
  const e=(await db.query<Row>("select * from finance_entries where loan_id=$1 and origin='loan_installment' order by installment_no",[loan.id])).rows[0]
  await command({action:'settle_entry',id:e.id,version:e.version,date:today()})
  expect(await scalar('select remaining_amount::text from finance_loan_balances where id=$1',[loan.id])).toBe('780.00')
  expect((await report()).summary.expenses).toBe(after.summary.expenses)
 })
 it('estorna pagamento, reabre saldo e impede cancelar atendimento antes do estorno',async()=>{
  await expect(scalar('select cancel_visit($1,$2,$3)',[visit.id,visit.version,'Cancelamento de teste'])).rejects.toThrow('Estorne')
  const pay=(await db.query<Row>("select * from finance_payments where visit_id=$1 and method_kind_snapshot='pix'",[visit.id])).rows[0]
  await command({action:'cancel_payment',id:pay.id,version:pay.version,date:today(),reason:'Devolução de teste',retained_fee:'0.00'})
  expect(await scalar('select pending_amount::text from finance_visit_balances where visit_id=$1',[visit.id])).toBe('150.00')
  expect(await scalar('select count(*)::int from audit_log where entity_type=\'finance_payments\' and entity_id=$1',[pay.id])).toBeGreaterThan(1)
 })
 it('liquida cartão histórico inativado e estorna parcela/taxa sem dupla contagem',async()=>{
  await command({action:'save_catalog',table:'payment_methods',id:method('credit'),version:1,fields:{active:false}})
  const e=(await db.query<Row>("select * from finance_entries where visit_id=$1 and method_kind_snapshot='credit' order by installment_no",[visit.id])).rows[0]
  await command({action:'settle_entry',id:e.id,version:e.version,date:today()})
  const before=await report(),pay=(await db.query<Row>("select * from finance_payments where visit_id=$1 and method_kind_snapshot='credit'",[visit.id])).rows[0]
  await command({action:'cancel_payment',id:pay.id,version:pay.version,date:today(),reason:'Cartão estornado no teste',retained_fee:'1.00'})
  const after=await report();expect(Number(after.summary.cash_variation)).toBeCloseTo(Number(before.summary.cash_variation)-Number(e.net_amount)-1,2)
  expect(Number(after.summary.fees)).toBeCloseTo(Number(before.summary.fees)-Number(pay.fee_amount)+1,2)
  expect(await scalar('select pending_amount::text from finance_visit_balances where visit_id=$1',[visit.id])).toBe('310.00')
 })
 it('fecha dia, exige justificativa de divergência e sinaliza alterações posteriores',async()=>{
  const data=await report();const actual=Object.fromEntries(data.by_method.map(m=>[m.id,String(m.net)]))
  const ids=Object.keys(actual)
  const altered={...actual,[ids[0]]:String(Number(actual[ids[0]])+10),[ids[1]]:String(Number(actual[ids[1]])-10)}
  await expect(command({action:'close_daily',date:today(),version:0,actual_by_method:altered,notes:''})).rejects.toThrow('divergência por forma')
  const closing=await command({action:'close_daily',date:today(),version:0,actual_by_method:actual,notes:''})
  expect(Number(closing.difference)).toBe(0)
  await command({action:'save_entry',fields:{direction:'income',description:'Aporte de teste',category_id:category('capital'),account_id:account(),method_id:method('pix'),competence:today(),due_on:today(),gross_amount:'10.00'},settle_now:true,settled_on:today()})
  expect(await scalar('select needs_review from daily_closings where id=$1',[closing.id])).toBe(true)
  await expect(command({action:'close_daily',date:today(),version:closing.version,actual_by_method:actual,notes:'Revisão de teste'})).rejects.toThrow(/outro computador/i)
  const current=(await db.query<Row>('select * from daily_closings where id=$1',[closing.id])).rows[0],fresh=await report()
  const reviewed=await command({action:'close_daily',date:today(),version:current.version,actual_by_method:Object.fromEntries(fresh.by_method.map(m=>[m.id,String(m.net)])),notes:'Revisão após aporte de teste'})
  expect(reviewed.needs_review).toBe(false);expect(Number(reviewed.difference)).toBe(0);expect(Number(reviewed.version)).toBeGreaterThan(Number(current.version))
 })
 it('bloqueia exclusão física e acesso de usuário sem perfil ou administrador inativo',async()=>{
  await expect(db.exec('delete from finance_entries')).rejects.toThrow('permission denied')
  await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false)`)
  expect(await scalar('select count(*)::int from finance_entries')).toBe(0)
  await expect(scalar('select finance_report(current_date,current_date)')).rejects.toThrow('administrador ativo')
  await db.exec(`reset role;update users_profile set active=false where id='${admin}';set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
  expect(await scalar('select count(*)::int from finance_movements')).toBe(0)
  await expect(command({action:'generate_recurring'})).rejects.toThrow('administrador ativo')
 })
})

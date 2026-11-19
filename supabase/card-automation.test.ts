// @vitest-environment node
// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'
const db=new PGlite(),admin='00000000-0000-4000-8000-000000000001'
type Row=Record<string,unknown>
const scalar=async<T=unknown>(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,T>>(sql,args)).rows[0])[0]
const cmd=(data:Row)=>scalar<Row>('select finance_command($1::jsonb)',[JSON.stringify({request_id:crypto.randomUUID(),...data})])
let patient:string,pro:string,type:string,method:string,account:string,rule:string,historical:Row,visit:Row
const finish=()=>cmd({action:'finish_visit',visit_data:{request_id:crypto.randomUUID(),patient_id:patient,professional_id:pro,appointment_type_id:type,visit_at:'2026-06-01T12:00:00Z',base_price:'310.00',consultation_discount:'0',exams:[]},applied_on:'2026-06-01',complete_financial:true,payments:[{method_id:method,account_id:account,gross_amount:'310.00',fee_rule_id:rule,installments:3,received_now:false}]})
async function run(date:string){await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");try{return await scalar<number>('select process_card_settlements($1)',[date])}finally{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)}}
async function entry(visitId=String(visit.visit_id)){return (await db.query<Row>('select * from finance_entries where visit_id=$1 order by installment_no',[visitId])).rows[0]}
async function exception(e:Row,action:string,extra:Row={}){const details=await scalar<{plan:{version:number}}>('select card_settlement_details($1)',[e.id]);return scalar('select card_settlement_exception($1::jsonb)',[JSON.stringify({request_id:crypto.randomUUID(),entry_id:e.id,version:e.version,plan_version:details.plan.version,action,date:'2026-11-01',reason:'Exceção sintética local',...extra})])}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;insert into auth.users values('${admin}');`)
 for(const file of ['202610300001_foundation.sql','20261103000100_operational_core.sql','20261104000100_financial_core.sql','20261109000100_safe_catalog_removal.sql'])await db.exec(await readFile(new URL('./migrations/'+file,import.meta.url),'utf8'))
 await db.exec(`insert into users_profile(id,full_name) values('${admin}','Admin local');set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
 patient=await scalar<string>("insert into patients(full_name,phone) values('Paciente local','51999990001') returning id");pro=await scalar<string>("insert into professionals(full_name) values('Profissional local') returning id");type=await scalar<string>("insert into appointment_types(name,default_price) values('Consulta local',310) returning id");method=await scalar<string>("select id from payment_methods where kind='credit'");account=await scalar<string>('select id from financial_accounts limit 1')
 rule=String((await cmd({action:'save_rate',fields:{method_id:method,acquirer:'Local',brand:'Teste',installments:3,percentage:'3',fixed_fee:'0.10',settlement_days:30,interval_days:30,valid_from:'2026-01-01'}})).id)
 historical=await finish()
 await db.exec('reset role;create schema cron;create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text);create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;')
 await db.exec(await readFile(new URL('./migrations/20261109000200_card_settlement_automation.sql',import.meta.url),'utf8'))
 await db.exec('set role authenticated');visit=await finish()
},30000)
afterAll(()=>db.close())
describe('Automatização proposta, com pg_cron simulado e PostgreSQL local real',()=>{
 it('não migra históricos; agenda somente parcelas novas e preserva centavos e datas',async()=>{
  expect(await scalar('select count(*)::int from card_settlement_plans where entry_id in (select id from finance_entries where visit_id=$1)',[historical.visit_id])).toBe(0)
  expect(await scalar('select count(*)::int from card_settlement_plans')).toBe(3)
  expect(await scalar('select sum(net_amount)::text from finance_entries where visit_id=$1',[visit.visit_id])).toBe('300.60')
  expect(await scalar('select min(expected_on)::text from card_settlement_plans')).toBe('2026-07-01')
 })
 it('nega execução do worker, escrita direta e alteração de eventos ao frontend',async()=>{
  await expect(scalar('select process_card_settlements()')).rejects.toThrow('permission denied')
  await expect(db.exec('delete from card_settlement_plans')).rejects.toThrow('permission denied')
  expect(await scalar("select count(*)::int from pg_policies where tablename like 'card_settlement_%'")).toBe(2)
 })
 it('liquida na previsão, não antes, e não duplica ao repetir o job',async()=>{
  expect(await run('2026-06-30')).toBe(0);expect(await run('2026-07-01')).toBe(1);expect(await run('2026-07-01')).toBe(0)
  expect((await entry()).status).toBe('settled')
  expect(await scalar("select count(*)::int from card_settlement_events where source='automatic'")).toBe(1)
  expect(await run('2026-09-01')).toBe(2)
  const summary=await scalar<{automatic_net:number}>('select card_settlement_report($1,$2)',['2026-06-01','2026-09-01']);expect(Number(summary.automatic_net)).toBe(300.6)
  expect(await scalar("select bool_and(created_by is null) from card_settlement_events where source='automatic'")).toBe(true)
 })
 it('estorno suspende a automação e mantém os movimentos históricos',async()=>{
  const e=await entry();await exception(e,'reverse')
  expect((await entry()).status).toBe('pending');expect(await run('2026-11-01')).toBe(0)
  expect(await scalar('select count(*)::int from finance_movements where entry_id=$1',[e.id])).toBe(2)
 })
 it('permite não recebido, chargeback e novo agendamento sem reescrever pagamento',async()=>{
  const payment=await scalar('select to_jsonb(p) from finance_payments p where visit_id=$1',[visit.visit_id])
  await exception(await entry(),'chargeback')
  await exception(await entry(),'not_received')
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date())
  await exception(await entry(),'reschedule',{date})
  expect(await run(date)).toBe(1)
  expect(await scalar('select to_jsonb(p) from finance_payments p where visit_id=$1',[visit.visit_id])).toEqual(payment)
 })
 it('liquidação com diferença registra movimento manual e preserva valores contratados',async()=>{
  const e=await entry(),before=await scalar('select to_jsonb(p) from finance_payments p where visit_id=$1',[visit.visit_id])
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date())
  await exception(e,'difference',{net_amount:'95.00',date})
  expect(await scalar('select sum(case direction when \'income\' then net_amount else -net_amount end)::text from finance_movements where entry_id=$1',[e.id])).toBe('95.00')
  expect((await entry()).gross_amount).toBe(e.gross_amount);expect((await entry()).fee_amount).toBe(e.fee_amount)
  expect(await scalar('select to_jsonb(p) from finance_payments p where visit_id=$1',[visit.visit_id])).toEqual(before)
  await exception(await entry(),'difference',{net_amount:'90.00',date})
  const report=await scalar<{difference_net:number}>('select card_settlement_report($1,$2)',['2026-01-01',date])
  expect(Number(report.difference_net)).toBeCloseTo(90-Number(e.net_amount),2)
  expect(await scalar('select sum(case direction when \'income\' then net_amount else -net_amount end)::text from finance_movements where entry_id=$1',[e.id])).toBe('90.00')
 })
 it('deduplica exceções e não repete efeitos ao reenviar a mesma operação',async()=>{
  const v=await finish(),e=await entry(String(v.visit_id)),details=await scalar<{plan:{version:number}}>('select card_settlement_details($1)',[e.id]);
  const payload={request_id:crypto.randomUUID(),entry_id:e.id,version:e.version,plan_version:details.plan.version,action:'not_received',date:'2026-11-01',reason:'Reenvio local controlado'}
  const first=await scalar('select card_settlement_exception($1::jsonb)',[JSON.stringify(payload)])
  const count=await scalar('select count(*)::int from card_settlement_events')
  expect(await scalar('select card_settlement_exception($1::jsonb)',[JSON.stringify(payload)])).toEqual(first)
  expect(await scalar('select count(*)::int from card_settlement_events')).toBe(count)
  await expect(scalar('select card_settlement_exception($1::jsonb)',[JSON.stringify({...payload,reason:'Outro conteúdo'})])).rejects.toThrow('já utilizado')
 })
 it('liquidação manual suspende automação e cancelamento mantém o histórico',async()=>{
  const v=await finish(),e=await entry(String(v.visit_id));await cmd({action:'settle_entry',id:e.id,version:e.version,date:'2026-11-01'})
  expect(await scalar('select state from card_settlement_plans where entry_id=$1',[e.id])).toBe('manual')
  const payment=(await db.query<Row>('select * from finance_payments where visit_id=$1',[v.visit_id])).rows[0]
  await cmd({action:'cancel_payment',id:payment.id,version:payment.version,date:'2026-11-01',reason:'Cancelamento sintético local',retained_fee:'0'})
  expect(await scalar("select bool_and(state='cancelled' and not auto_enabled) from card_settlement_plans where entry_id in (select id from finance_entries where visit_id=$1)",[v.visit_id])).toBe(true)
 })
 it('RPCs e leitura das tabelas continuam bloqueadas para usuário sem perfil ativo',async()=>{
  await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false)")
  try{
   expect(await scalar('select count(*)::int from card_settlement_plans')).toBe(0)
   await expect(scalar("select card_settlement_report('2026-01-01','2026-12-31')")).rejects.toThrow('administrador ativo')
   await expect(scalar('select card_settlement_details($1)',[visit.visit_id])).rejects.toThrow('administrador ativo')
   await expect(scalar('select card_settlement_exception($1::jsonb)',['{}'])).rejects.toThrow('administrador ativo')
  }finally{await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`)}
 })
 it('detecta versão desatualizada e mantém eventos imutáveis e as políticas antigas',async()=>{
  const e=await entry();await expect(exception({...e,version:0},'hold')).rejects.toThrow('Outro acesso')
  await db.exec('reset role');await expect(db.exec("update card_settlement_events set notes='forjado'")).rejects.toThrow('Exclusão definitiva')
  expect(await scalar('select schedule from cron.job')).toBe('*/15 * * * *')
  expect(await scalar('select command from cron.job')).toBe('select public.process_card_settlements();')
  expect(await scalar("select count(*)::int from pg_class where relnamespace='public'::regnamespace and relrowsecurity")).toBe(24)
  expect(await scalar('select count(*)::int from pg_policies')).toBe(34)
 })
})

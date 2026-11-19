// @vitest-environment node
// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
const db=new PGlite(),admin='00000000-0000-4000-8000-000000000001',inactive='00000000-0000-4000-8000-000000000002'
const scalar=async<T=unknown>(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,T>>(sql,args)).rows[0])[0]
const remove=(table:string,id:string,version=1,confirm=true)=>scalar<{action:string;linked:boolean}>('select manage_record_removal($1,$2,$3,$4)',[table,id,version,confirm])
const patient=()=>scalar<string>("insert into patients(full_name,phone) values('Paciente local','51999990001') returning id")
let professional:string,type:string,method:string,account:string,category:string
const rate=()=>scalar<string>("select finance_command($1::jsonb)->>'id'",[JSON.stringify({request_id:crypto.randomUUID(),action:'save_rate',fields:{method_id:method,acquirer:crypto.randomUUID(),brand:'Teste',installments:1,percentage:'2.5',fixed_fee:'0.10',settlement_days:0,valid_from:'2026-01-01'}})])
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;insert into auth.users values('${admin}'),('${inactive}');`)
 for(const name of ['202610300001_foundation.sql','20261103000100_operational_core.sql','20261104000100_financial_core.sql','20261109000100_safe_catalog_removal.sql'])await db.exec(await readFile(new URL('./migrations/'+name,import.meta.url),'utf8'))
 await db.exec(`insert into users_profile(id,full_name) values('${admin}','Admin local');insert into users_profile(id,full_name,active) values('${inactive}','Inativo local',false);set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);`)
 professional=await scalar<string>("insert into professionals(full_name) values('Profissional local') returning id")
 type=await scalar<string>("insert into appointment_types(name,default_price) values('Consulta local',100) returning id")
 method=await scalar<string>("select id from payment_methods where kind='credit'");account=await scalar<string>('select id from financial_accounts limit 1');category=await scalar<string>("select id from finance_categories where code='other_revenue'")
},30000)
afterAll(()=>db.close())
describe('Migration proposta: exclusão segura somente em PostgreSQL local',()=>{
 it('nega anônimo, administrador inativo e acesso às funções auxiliares',async()=>{
  const id=await patient();await db.exec('reset role;set role anon')
  await expect(remove('patients',id)).rejects.toThrow('permission denied')
  await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${inactive}',false)`)
  await expect(remove('patients',id)).rejects.toThrow('administrador ativo')
  await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`)
  await expect(scalar('select catalog_record_has_links($1,$2)',['patients',id])).rejects.toThrow('permission denied')
 })
 it('preview não altera dados; exclui paciente livre com snapshot e autoria auditáveis',async()=>{
  const id=await patient(),audit=await scalar('select count(*) from audit_log')
  expect(await remove('patients',id,1,false)).toMatchObject({action:'delete',linked:false});expect(await scalar('select count(*) from audit_log')).toBe(audit)
  await expect(db.query('delete from patients where id=$1',[id])).rejects.toThrow('permission denied')
  expect(await remove('patients',id)).toMatchObject({action:'delete'});expect(await scalar('select count(*)::int from patients where id=$1',[id])).toBe(0)
  expect(await scalar('select after_json->>\'deleted\' from audit_log where entity_id=$1 order by created_at desc limit 1',[id])).toBe('true')
  expect(await scalar('select user_id from audit_log where entity_id=$1 and after_json ? \'deleted\'',[id])).toBe(admin)
 })
 it('preserva agendamento cancelado e inativa o paciente com qualquer vínculo',async()=>{
  const id=await patient()
  await db.query("insert into appointments(patient_id,professional_id,appointment_type_id,start_at,status,cancel_reason) values($1,$2,$3,now(),'cancelled','Teste')",[id,professional,type])
  expect(await remove('patients',id)).toMatchObject({action:'deactivate',linked:true})
  expect(await scalar('select active from patients where id=$1',[id])).toBe(false)
  expect(await scalar('select count(*)::int from appointments where patient_id=$1',[id])).toBe(1)
 })
 it('detecta FK futura e preserva versões concorrentes',async()=>{
  const id=await patient();await db.exec('reset role;create table public.future_link(id uuid primary key,patient uuid references patients(id))')
  await db.query('insert into future_link values(gen_random_uuid(),$1)',[id]);await db.exec('set role authenticated')
  expect(await remove('patients',id)).toMatchObject({action:'deactivate'})
  const fresh=await patient();await db.query("update patients set full_name='Nome alterado' where id=$1",[fresh])
  await expect(remove('patients',fresh)).rejects.toThrow('Outro computador')
  await expect(remove('users_profile',admin)).rejects.toThrow('Cadastro inválido')
 })
 it('reavalia vínculo surgido depois do preview e não apaga o paciente',async()=>{
  const id=await patient();expect((await remove('patients',id,1,false)).action).toBe('delete')
  await db.query('insert into appointments(patient_id,professional_id,appointment_type_id,start_at) values($1,$2,$3,now())',[id,professional,type])
  expect((await remove('patients',id)).action).toBe('deactivate')
 })
 it('exclui taxa nunca utilizada e mantém imutabilidade das taxas',async()=>{
  const id=await rate();expect((await remove('card_fee_rules',id)).action).toBe('delete')
  const historical=await rate();await db.exec('reset role')
  await expect(db.query('update card_fee_rules set percentage=90 where id=$1',[historical])).rejects.toThrow('imutáveis')
  await db.exec('set role authenticated')
 })
 it('taxa usada em entrada manual é inativada, sem alterar snapshots/valores financeiros',async()=>{
  const id=await rate()
  const entry=await scalar<Record<string,unknown>>('select finance_command($1::jsonb)',[JSON.stringify({request_id:crypto.randomUUID(),action:'save_entry',fields:{direction:'income',description:'Entrada local',category_id:category,account_id:account,method_id:method,fee_rule_id:id,gross_amount:'100.00',competence:'2026-11-01',due_on:'2026-11-01'}})])
  const before=await scalar('select to_jsonb(e) from finance_entries e where id=$1',[entry.id])
  expect((await remove('card_fee_rules',id)).action).toBe('deactivate')
  expect(await scalar('select active from card_fee_rules where id=$1',[id])).toBe(false)
  expect(await scalar('select to_jsonb(e) from finance_entries e where id=$1',[entry.id])).toEqual(before)
 })
 it('preserva exclusão bloqueada dos demais registros, RLS e ausência de DELETE direto',async()=>{
  expect(await scalar("select count(*)::int from pg_class where relnamespace='public'::regnamespace and relrowsecurity")).toBe(22)
  expect(await scalar('select count(*)::int from pg_policies')).toBe(32)
  await db.exec('reset role');await expect(db.exec('delete from professionals')).rejects.toThrow('Exclusão definitiva')
  await db.exec('set role authenticated');expect(await scalar("select has_table_privilege(current_user,'patients','DELETE')")).toBe(false)
 })
 it('taxa usada em pagamento de atendimento preserva o pagamento e seus valores históricos',async()=>{
  const id=await rate(),p=await patient()
  const result=await scalar<{visit_id:string}>('select finance_command($1::jsonb)',[JSON.stringify({request_id:crypto.randomUUID(),action:'finish_visit',visit_data:{request_id:crypto.randomUUID(),patient_id:p,professional_id:professional,appointment_type_id:type,visit_at:'2026-11-09T12:00:00Z',base_price:'100.00',consultation_discount:'0.00',exams:[]},applied_on:'2026-11-09',complete_financial:true,payments:[{method_id:method,account_id:account,gross_amount:'100.00',installments:1,fee_rule_id:id,received_now:false}]})])
  const previous=await scalar('select to_jsonb(p) from finance_payments p where visit_id=$1',[result.visit_id])
  expect((await remove('card_fee_rules',id)).action).toBe('deactivate')
  expect(await scalar('select to_jsonb(p) from finance_payments p where visit_id=$1',[result.visit_id])).toEqual(previous)
 })
})

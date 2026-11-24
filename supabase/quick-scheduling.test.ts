// @vitest-environment node
// Dados sintéticos de portfólio: nenhum dado do ambiente real.
// Somente banco local descartável e dados sintéticos. Sem acesso ao Supabase real.
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'
const db=new PGlite(),admin='00000000-0000-4000-8000-000000000001',outsider='00000000-0000-4000-8000-000000000002',inactive='00000000-0000-4000-8000-000000000003'
async function scalar<T=string>(sql:string,args:unknown[]=[]):Promise<T>{const {rows}=await db.query<Record<string,T>>(sql,args);return Object.values(rows[0])[0]}
let pro:string,type:string,existing:string,beforeExisting:unknown
const input=(full_name='Ana Exemplo')=>({full_name,professional_id:pro,appointment_type_id:type,start_at:'2030-01-02T17:00:00Z',status:'scheduled',admin_notes:''})
const schedule=(data=input())=>scalar<{id:string;patient_id:string;version:number;status:string}>('select schedule_new_patient($1::jsonb)',[JSON.stringify(data)])
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;insert into auth.users values('${admin}'),('${outsider}'),('${inactive}');`)
 for(const name of ['202610300001_foundation.sql','20261103000100_operational_core.sql','20261104000100_financial_core.sql','20261109000100_safe_catalog_removal.sql','20261111000100_safe_appointment_removal.sql'])await db.exec(await readFile(new URL('./migrations/'+name,import.meta.url),'utf8'))
 await db.exec(`insert into users_profile(id,full_name) values('${admin}','Administrador Exemplo');insert into users_profile(id,full_name,active) values('${inactive}','Inativo Exemplo',false);set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);`)
 existing=await scalar("insert into patients(full_name,phone) values('Paciente Existente Exemplo','51999990001') returning id")
 pro=await scalar("insert into professionals(full_name) values('Profissional Exemplo') returning id")
 type=await scalar("insert into appointment_types(name,default_price) values('Consulta Exemplo',100) returning id")
 beforeExisting=await scalar('select to_jsonb(p) from patients p where id=$1',[existing])
 await db.exec('reset role')
 await db.exec(await readFile(new URL('./migrations/20261123000100_quick_patient_scheduling.sql',import.meta.url),'utf8'))
 await db.exec('set role authenticated')
},30000)
afterAll(async()=>{await db.close()})
describe('Cadastro único e agendamento rápido',()=>{
 it('migration preserva cadastro existente, RLS, permissões e segurança da view',async()=>{
  expect(await scalar('select to_jsonb(p) from patients p where id=$1',[existing])).toEqual({...beforeExisting as object,registration_pending:false})
  expect(await scalar<boolean>("select relrowsecurity from pg_class where oid='public.patients'::regclass")).toBe(true)
  expect(await scalar<string[]>("select reloptions from pg_class where oid='public.appointment_overview'::regclass")).toContain('security_invoker=true')
  expect(await scalar<boolean>("select has_function_privilege('anon','public.schedule_new_patient(jsonb)','execute')")).toBe(false)
 })
 it('nome sozinho cria paciente e agendamento vinculados; dados ausentes são NULL e auditados',async()=>{
  const a=await schedule()
  const patient=await scalar<Record<string,unknown>>('select to_jsonb(p) from patients p where id=$1',[a.patient_id])
  expect(patient).toMatchObject({full_name:'Ana Exemplo',phone:null,phone_digits:null,cpf:null,birth_date:null,active:true,created_by:admin,registration_pending:true})
  expect(await scalar('select patient_id from appointment_overview where id=$1',[a.id])).toBe(a.patient_id)
  expect(await scalar('select patient_registration_pending from appointment_overview where id=$1',[a.id])).toBe(true)
  expect(await scalar<number>("select count(*)::int from audit_log where entity_id in ($1,$2) and action='create'",[a.id,a.patient_id])).toBe(2)
 })
 it('não deixa paciente ou auditoria órfãos quando o agendamento falha',async()=>{
  const count=await scalar<number>('select count(*)::int from patients'),audit=await scalar<number>('select count(*)::int from audit_log')
  await expect(schedule({...input(),professional_id:'00000000-0000-4000-8000-000000000099'})).rejects.toThrow()
  expect(await scalar<number>('select count(*)::int from patients')).toBe(count)
  expect(await scalar<number>('select count(*)::int from audit_log')).toBe(audit)
 })
 it('nome continua obrigatório, telefone informado continua válido e nunca recebe preenchimento fictício',async()=>{
  await expect(schedule(input(' '))).rejects.toThrow()
  await expect(db.exec("insert into patients(full_name,phone) values('Inválido Exemplo','123')")).rejects.toThrow()
  await expect(db.exec("insert into patients(full_name,phone) values('Vazio Exemplo','')")).rejects.toThrow()
  const id=await scalar("insert into patients(full_name) values('Nome Exemplo') returning id")
  expect(await scalar('select phone from patients where id=$1',[id])).toBeNull()
  expect(await scalar('select registration_pending from patients where id=$1',[id])).toBe(false)
 })
 it('telefone informado não conclui um cadastro rápido nem outro campo opcional define pendência',async()=>{
  const a=await schedule(input('Contato Exemplo'))
  await db.query("update patients set phone='51999990003',cpf='00000000000',birth_date='1990-01-01',admin_notes='Exemplo sintético' where id=$1",[a.patient_id])
  expect(await scalar('select registration_pending from patients where id=$1',[a.patient_id])).toBe(true)
  expect(await scalar('select patient_registration_pending from appointment_overview where id=$1',[a.id])).toBe(true)
  await expect(db.query('update patients set registration_pending=null where id=$1',[a.patient_id])).rejects.toThrow()
 })
 it('permite homônimos distintos, pesquisa por nome e telefone, sem fusão automática',async()=>{
  const a=await schedule(input('Homônimo Exemplo')),b=await schedule(input('Homônimo Exemplo'))
  expect(a.patient_id).not.toBe(b.patient_id)
  expect((await db.query("select * from search_patients('Homônimo Exemplo',0,true)")).rows).toHaveLength(2)
  expect((await db.query("select * from search_patients('999990001',0,true)")).rows).toHaveLength(1)
 })
 it('completar edita o mesmo paciente, preserva vínculo e não cria outro nem altera o agendamento',async()=>{
  const a=await schedule(input('Completar Exemplo')),count=await scalar<number>('select count(*)::int from patients')
  const before=await scalar('select to_jsonb(a) from appointments a where id=$1',[a.id])
  await db.query('update patients set registration_pending=false where id=$1 and version=1',[a.patient_id])
  expect(await scalar<number>('select count(*)::int from patients')).toBe(count)
  expect(await scalar('select phone from patients where id=$1',[a.patient_id])).toBeNull()
  expect(await scalar('select patient_registration_pending from appointment_overview where id=$1',[a.id])).toBe(false)
  expect(await scalar('select to_jsonb(a) from appointments a where id=$1',[a.id])).toEqual(before)
  expect(await scalar<number>("select count(*)::int from audit_log where entity_id=$1 and action='update'",[a.patient_id])).toBe(1)
 })
 it('selecionar um paciente existente não cria outro cadastro',async()=>{
  const count=await scalar<number>('select count(*)::int from patients')
  await db.query('insert into appointments(patient_id,professional_id,appointment_type_id,start_at) values($1,$2,$3,$4)',[existing,pro,type,input().start_at])
  expect(await scalar<number>('select count(*)::int from patients')).toBe(count)
 })
 it('inicia atendimento com nome apenas sem gerar pagamento ou movimentação',async()=>{
  const before=await scalar('select jsonb_build_array((select count(*) from finance_payments),(select count(*) from finance_entries),(select count(*) from finance_movements))')
  const a=await schedule(input('Atendimento Exemplo'))
  const visit=await scalar<{patient_id:string;status:string;total_amount:number}>('select start_visit($1)',[a.id])
  expect(visit).toMatchObject({patient_id:a.patient_id,status:'draft',total_amount:100})
  expect(await scalar('select jsonb_build_array((select count(*) from finance_payments),(select count(*) from finance_entries),(select count(*) from finance_movements))')).toEqual(before)
  await expect(db.query('select manage_appointment_removal($1,$2,true)',[a.id,a.version])).rejects.toThrow(/histórico|vínculos/)
 })
 it('cancelamento e exclusão seguros continuam valendo para cadastro pendente',async()=>{
  const cancelled=await schedule(input('Cancelar Exemplo')),removed=await schedule(input('Excluir Exemplo'))
  await db.query("update appointments set status='cancelled',cancel_reason='Cancelamento sintético' where id=$1",[cancelled.id])
  await expect(db.query('select manage_appointment_removal($1,2,true)',[cancelled.id])).rejects.toThrow(/histórico|vínculos/)
  await db.query('select manage_appointment_removal($1,1,true)',[removed.id])
  expect(await scalar<number>('select count(*)::int from appointments where id=$1',[removed.id])).toBe(0)
  expect(await scalar<number>('select count(*)::int from patients where id=$1',[removed.patient_id])).toBe(1)
 })
 it('RLS bloqueia usuário sem perfil e administrador inativo, inclusive criação direta',async()=>{
  for(const id of [outsider,inactive]){
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
   expect(await scalar<number>('select count(*)::int from patients')).toBe(0)
   await expect(schedule()).rejects.toThrow('administrador ativo')
   await expect(db.exec("insert into patients(full_name) values('Bloqueado Exemplo')")).rejects.toThrow(/row-level security/)
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin])
 })
})

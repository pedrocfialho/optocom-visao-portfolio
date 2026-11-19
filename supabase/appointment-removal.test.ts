// @vitest-environment node
// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,afterAll,it,expect} from 'vitest'
const db=new PGlite(),admin='00000000-0000-4000-8000-000000000001',inactive='00000000-0000-4000-8000-000000000002'
const scalar=async<T=unknown>(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,T>>(sql,args)).rows[0])[0]
let patient:string,professional:string,type:string
const add=(date='2099-11-11T17:30:00Z')=>scalar<string>('insert into appointments(patient_id,professional_id,appointment_type_id,start_at) values($1,$2,$3,$4) returning id',[patient,professional,type,date])
const remove=(id:string,version=1,confirm=false)=>scalar<{allowed:boolean;deleted:boolean}>('select manage_appointment_removal($1,$2,$3)',[id,version,confirm])
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;insert into auth.users values('${admin}'),('${inactive}');`)
 for(const name of ['202610300001_foundation.sql','20261103000100_operational_core.sql','20261104000100_financial_core.sql','20261109000100_safe_catalog_removal.sql','20261111000100_safe_appointment_removal.sql'])await db.exec(await readFile(new URL('./migrations/'+name,import.meta.url),'utf8'))
 await db.exec(`insert into users_profile(id,full_name) values('${admin}','Admin local');insert into users_profile(id,full_name,active) values('${inactive}','Inativo local',false);set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false)`)
 patient=await scalar<string>("insert into patients(full_name,phone) values('Paciente local','51999990001') returning id");professional=await scalar<string>("insert into professionals(full_name) values('Profissional local') returning id");type=await scalar<string>("insert into appointment_types(name,default_price) values('Consulta local',100) returning id")
},30000)
afterAll(()=>db.close())
it('cancela consultas futuras e do dia preservando registro e auditoria',async()=>{
 for(const date of ['2099-11-11T17:30:00Z',new Date().toISOString()]){const id=await add(date);await db.query("update appointments set status='cancelled',cancel_reason='Confirmado na agenda' where id=$1",[id]);expect(await scalar('select status from appointments where id=$1',[id])).toBe('cancelled');expect(await scalar("select count(*)::int from audit_log where entity_id=$1 and after_json->>'status'='cancelled'",[id])).toBe(1)}
})
it('Dashboard exclui canceladas e edição normal continua funcionando',async()=>{
 const id=await add(),other=await add();await db.query("update appointments set admin_notes='Edição normal' where id=$1",[id]);expect(await scalar('select version from appointments where id=$1',[id])).toBe(2)
 const before=await scalar<{summary:{scheduled:number}}>("select finance_report('2099-11-11','2099-11-11')");await db.query("update appointments set status='cancelled',cancel_reason='Confirmado na agenda' where id=$1",[other]);const after=await scalar<{summary:{scheduled:number}}>("select finance_report('2099-11-11','2099-11-11')");expect(after.summary.scheduled).toBe(before.summary.scheduled-1)
})
it('preview não altera dados e exclui somente engano sem vínculos, preservando auditoria',async()=>{
 const id=await add(),before=await scalar('select count(*) from audit_log');expect(await remove(id)).toMatchObject({allowed:true,deleted:false});expect(await scalar('select count(*) from audit_log')).toBe(before)
 expect(await remove(id,1,true)).toMatchObject({deleted:true});expect(await scalar('select count(*)::int from appointments where id=$1',[id])).toBe(0)
 expect(await scalar("select count(*)::int from audit_log where entity_id=$1 and after_json->>'deleted'='true' and user_id=$2",[id,admin])).toBe(1)
 expect(await scalar("select count(*)::int from audit_log where entity_id=$1 and action='create'",[id])).toBe(1)
})
it('bloqueia exclusão após edição ou cancelamento',async()=>{
 for(const cancel of [true,false]){const id=await add();await db.query(cancel?"update appointments set status='cancelled',cancel_reason='Teste local' where id=$1":"update appointments set admin_notes='Histórico' where id=$1",[id]);expect((await remove(id,2)).allowed).toBe(false);await expect(remove(id,2,true)).rejects.toThrow('Use Cancelar consulta')}
})
it('bloqueia visita vinculada e vínculo surgido entre preview e confirmação',async()=>{
 const id=await add();expect((await remove(id)).allowed).toBe(true);const visit=await scalar<{id:string}>('select start_visit($1)',[id]);const original=await scalar('select to_jsonb(v) from visits v where id=$1',[visit.id]);expect((await remove(id)).allowed).toBe(false);await expect(remove(id,1,true)).rejects.toThrow('Use Cancelar consulta');expect(await scalar('select to_jsonb(v) from visits v where id=$1',[visit.id])).toEqual(original)
 // A regra existente impede cancelamento pela Agenda de um atendimento iniciado.
 await expect(db.query("update appointments set status='cancelled',cancel_reason='Teste' where id=$1",[id])).rejects.toThrow('atendimento vinculado')
})
it('protege vínculo futuro mesmo sem atendimento e detecta versões antigas',async()=>{
 const id=await add();await db.exec('reset role;create table public.future_appointment_link(id uuid primary key,appointment_id uuid references appointments(id) on delete restrict)');await db.query('insert into future_appointment_link values(gen_random_uuid(),$1)',[id]);await db.exec('set role authenticated');expect((await remove(id)).allowed).toBe(false);await expect(remove(id,1,true)).rejects.toThrow('Use Cancelar consulta')
 const changed=await add();await db.query("update appointments set admin_notes='Mudou' where id=$1",[changed]);await expect(remove(changed,1,true)).rejects.toThrow('Outro computador')
})
it('preserva atendimento concluído, pagamento e movimentos financeiros vinculados',async()=>{
 const instant=new Date().toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date()),id=await add(instant)
 const visit=await scalar<{id:string;version:number}>('select start_visit($1)',[id])
 const method=await scalar<string>("select id from payment_methods where kind='pix'"),account=await scalar<string>('select id from financial_accounts limit 1')
 await scalar('select finance_command($1::jsonb)',[JSON.stringify({request_id:crypto.randomUUID(),action:'finish_visit',visit_data:{id:visit.id,version:visit.version,request_id:crypto.randomUUID(),patient_id:patient,professional_id:professional,appointment_type_id:type,visit_at:instant,base_price:'100.00',consultation_discount:'0',exams:[]},applied_on:date,complete_financial:true,payments:[{method_id:method,account_id:account,gross_amount:'100.00',installments:1,received_now:true}]})])
 const snapshot=()=>scalar("select jsonb_build_object('visits',(select jsonb_agg(to_jsonb(v)) from visits v),'payments',(select jsonb_agg(to_jsonb(p)) from finance_payments p),'movements',(select jsonb_agg(to_jsonb(m)) from finance_movements m))")
 const before=await snapshot();expect((await remove(id,2)).allowed).toBe(false);await expect(remove(id,2,true)).rejects.toThrow('Use Cancelar consulta');expect(await snapshot()).toEqual(before)
})
it('sem DELETE direto, sem RPC para anônimo/inativo e sem acesso aos auxiliares',async()=>{
 const id=await add();await expect(db.query('delete from appointments where id=$1',[id])).rejects.toThrow('permission denied');await expect(scalar('select appointment_has_history($1)',[id])).rejects.toThrow('permission denied')
 await db.exec('reset role;set role anon');await expect(remove(id,1,true)).rejects.toThrow('permission denied');await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${inactive}',false)`);await expect(remove(id,1,true)).rejects.toThrow('administrador ativo');await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`)
 expect(await scalar("select relrowsecurity from pg_class where oid='public.appointments'::regclass")).toBe(true)
})

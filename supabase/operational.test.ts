// @vitest-environment node
// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const admin = '00000000-0000-4000-8000-000000000001'
const outsider = '00000000-0000-4000-8000-000000000002'
let patient: string, professional: string, consultation: string, exam1: string, exam2: string, appointment: string, visit: string
let version: number

async function scalar<T>(sql: string, args: unknown[] = []): Promise<T> {
  const { rows } = await db.query<Record<string, T>>(sql, args)
  return Object.values(rows[0])[0]
}
async function rpc(data: Record<string, unknown>) {
  return scalar<{ id: string; version: number; status: string; total_amount: number }>('select public.save_visit($1::jsonb)', [JSON.stringify(data)])
}
const data = () => ({ id: visit, version, patient_id: patient, professional_id: professional, appointment_type_id: consultation,
  visit_at: '2026-11-03T12:00:00Z', base_price: '180.00', consultation_discount: '20.00',
  exams: [{ exam_id: exam1, unit_price: '80.00' }, { exam_id: exam2, unit_price: '40.00' }], admin_notes: 'Somente administrativo' })

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    insert into auth.users values ('${admin}'),('${outsider}');`)
  for (const name of ['202610300001_foundation.sql', '20261103000100_operational_core.sql']) {
    await db.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8'))
  }
  await db.exec(`insert into users_profile(id,full_name) values('${admin}','Administrador Exemplo');
    set role authenticated; select set_config('request.jwt.claim.sub','${admin}',false);`)
}, 30000)
afterAll(async () => { await db.close() })

describe('Núcleo operacional em PostgreSQL com RLS e RPC reais', () => {
  it('cadastra os registros e grava autoria auditável sem permitir autoria forjada', async () => {
    patient = await scalar<string>(`insert into patients(full_name,phone,created_by) values('Pessoa de teste','(51) 99999-0001','${outsider}') returning id`)
    professional = await scalar<string>("insert into professionals(full_name) values('Profissional de teste') returning id")
    consultation = await scalar<string>("insert into appointment_types(name,default_price) values('Avaliação',180) returning id")
    exam1 = await scalar<string>("insert into exams(name,default_price) values('Exame um',80) returning id")
    exam2 = await scalar<string>("insert into exams(name,default_price) values('Exame dois',40) returning id")
    expect(await scalar('select created_by from patients where id=$1', [patient])).toBe(admin)
    expect(await scalar('select count(*)::integer from audit_log where entity_id=$1', [patient])).toBe(1)
    expect((await db.query('select * from search_patients($1,0)', ['999990001'])).rows).toHaveLength(1)
    expect((await db.query('select * from search_patients($1,0)', ['pessoa'])).rows).toHaveLength(1)
  })
  it('agenda e inicia atendimento uma única vez, já preenchido', async () => {
    appointment = await scalar<string>(`insert into appointments(patient_id,professional_id,appointment_type_id,start_at,status) values($1,$2,$3,'2026-11-03T12:00:00Z','confirmed') returning id`, [patient, professional, consultation])
    const first = await scalar<{ id: string; version: number }>('select start_visit($1)', [appointment])
    visit = first.id; version = first.version
    expect((await scalar<{ id: string }>('select start_visit($1)', [appointment])).id).toBe(visit)
    expect(await scalar('select base_price::text from visits where id=$1', [visit])).toBe('180.00')
    await expect(db.query("update appointments set status='attended' where id=$1", [appointment])).rejects.toThrow('Conclua')
  })
  it('calcula desconto, dois exames e total no banco, ignorando total enviado pelo cliente', async () => {
    const saved = await rpc({ ...data(), total_amount: '0' })
    version = saved.version
    expect(Number(saved.total_amount)).toBe(280)
    expect(await scalar('select consultation_final::text from visits where id=$1', [visit])).toBe('160.00')
    expect(await scalar('select count(*)::integer from visit_exams where visit_id=$1 and active', [visit])).toBe(2)
    await expect(db.query('update visits set total_amount=0')).rejects.toThrow('permission denied')
    await expect(db.query('update visit_exams set unit_price_snapshot=0')).rejects.toThrow('permission denied')
  })
  it('falha atômica não altera atendimento nem itens', async () => {
    const before = await scalar('select count(*)::integer from audit_log')
    await expect(rpc({ ...data(), consultation_discount: '181' })).rejects.toThrow('desconto')
    await expect(rpc({ ...data(), exams: [{ exam_id: exam1, unit_price: '-1' }] })).rejects.toThrow('exame')
    await expect(rpc({ ...data(), exams: [{ exam_id: exam1, unit_price: '1' }, { exam_id: exam1, unit_price: '2' }] })).rejects.toThrow('duas vezes')
    expect(await scalar('select count(*)::integer from audit_log')).toBe(before)
    expect(await scalar('select total_amount::text from visits where id=$1', [visit])).toBe('280.00')
  })
  it('conflito entre computadores preserva a versão mais recente', async () => {
    await expect(rpc({ ...data(), version: version - 1 })).rejects.toThrow('Outro computador')
    expect(await scalar('select version from visits where id=$1', [visit])).toBe(version)
  })
  it('remoção de exame preserva linha inativa e histórico; preços de catálogo não reescrevem o passado', async () => {
    await db.query('update exams set default_price=999,name=$1 where id=$2', ['Exame renomeado', exam1])
    const saved = await rpc({ ...data(), exams: [{ exam_id: exam1, unit_price: '80' }] })
    version = saved.version
    expect(Number(saved.total_amount)).toBe(240)
    expect(await scalar('select active from visit_exams where visit_id=$1 and exam_id=$2', [visit, exam2])).toBe(false)
    expect(await scalar('select exam_name_snapshot from visit_exams where visit_id=$1 and exam_id=$2', [visit, exam1])).toBe('Exame um')
  })
  it('conclusão marca agenda como Atendido e bloqueia reescrita', async () => {
    const saved = await rpc({ ...data(), complete: true })
    version = saved.version
    expect(saved.status).toBe('completed')
    expect(await scalar('select status from appointments where id=$1', [appointment])).toBe('attended')
    await expect(rpc(data())).rejects.toThrow('reescrito')
    await expect(db.query("update appointments set status='no_show' where id=$1", [appointment])).rejects.toThrow('Cancele')
  })
  it('cancelamento exige motivo, preserva atendimento e registra autor', async () => {
    await expect(db.query('select cancel_visit($1,$2,$3)', [visit, version, ''])).rejects.toThrow('motivo')
    await db.query('select cancel_visit($1,$2,$3)', [visit, version, 'Registro lançado incorretamente'])
    expect(await scalar('select status from visits where id=$1', [visit])).toBe('cancelled')
    expect(await scalar('select status from appointments where id=$1', [appointment])).toBe('cancelled')
    expect(await scalar("select count(*)::integer from audit_log where entity_id=$1 and user_id=$2 and after_json->>'status'='cancelled'", [visit, admin])).toBe(1)
  })
  it('retorno gratuito conta como atendimento concluído, com total zero', async () => {
    const input = { ...data(), request_id: '10000000-0000-4000-8000-000000000001', id: null, version: null, base_price: '0', consultation_discount: '0', exams: [], complete: true }
    const free = await rpc(input)
    expect(free.status).toBe('completed')
    expect(Number(free.total_amount)).toBe(0)
    expect((await rpc(input)).id).toBe(free.id)
  })
  it('inativação preserva histórico e bloqueia novos agendamentos; exclusão é negada', async () => {
    await db.query('update patients set active=false where id=$1', [patient])
    await expect(db.query("insert into appointments(patient_id,professional_id,appointment_type_id,start_at) values($1,$2,$3,now())", [patient, professional, consultation])).rejects.toThrow('ativo')
    await expect(db.query('delete from patients where id=$1', [patient])).rejects.toThrow('permission denied')
    expect(await scalar('select count(*)::integer from visits where patient_id=$1', [patient])).toBe(2)
  })
  it('usuário externo, perfil inativo e anônimo não acessam dados nem RPCs', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false)`)
    expect((await db.query('select * from patients')).rows).toHaveLength(0)
    expect((await db.query('select * from visit_overview')).rows).toHaveLength(0)
    await expect(rpc(data())).rejects.toThrow('administrador ativo')
    await db.exec(`reset role; update users_profile set active=false where id='${admin}'; set role authenticated; select set_config('request.jwt.claim.sub','${admin}',false);`)
    expect((await db.query('select * from appointment_overview')).rows).toHaveLength(0)
    await expect(db.query('select start_visit($1)', [appointment])).rejects.toThrow('administrador ativo')
    await db.exec('reset role; set role anon;')
    await expect(db.query('select * from patients')).rejects.toThrow('permission denied')
    await expect(db.query('select start_visit($1)', [appointment])).rejects.toThrow('permission denied')
    await db.exec('reset role;')
    await expect(db.query('delete from patients')).rejects.toThrow('Exclusão definitiva')
  })
})

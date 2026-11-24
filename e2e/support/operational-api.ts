// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { Page } from '@playwright/test'

// Banco descartável de testes. Todas as chamadas Supabase são interceptadas;
// o projeto remoto e os usuários reais nunca recebem os dados destes cenários.
export const testAdmin = '00000000-0000-4000-8000-000000000001'
export async function operationalApi(page: Page,financial=false,usability=false,automation=false,appointmentRemoval=false) {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    insert into auth.users values('${testAdmin}');`)
  for (const file of ['202610300001_foundation.sql', '20261103000100_operational_core.sql',...(financial?['20261104000100_financial_core.sql']:[]),...(usability?['20261109000100_safe_catalog_removal.sql']:[])]) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  if(automation){await db.exec('create schema cron;create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text);create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;');await db.exec(await readFile(new URL('../../supabase/migrations/20261109000200_card_settlement_automation.sql',import.meta.url),'utf8'))}
  if(appointmentRemoval)await db.exec(await readFile(new URL('../../supabase/migrations/20261111000100_safe_appointment_removal.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../../supabase/migrations/20261123000100_quick_patient_scheduling.sql',import.meta.url),'utf8'))
  await db.exec(`insert into users_profile(id,full_name) values('${testAdmin}','Administrador Exemplo');
    set role authenticated; select set_config('request.jwt.claim.sub','${testAdmin}',false);`)
  const user = { id: testAdmin, email: 'admin@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-11-03T12:00:00Z', identities: [] }
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: testAdmin, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`
  const allowedTables = ['users_profile', 'patients', 'professionals', 'appointment_types', 'exams', 'appointments', 'visits', 'visit_exams', 'visit_overview', 'appointment_overview',...(financial?['financial_accounts','payment_methods','card_fee_rules','finance_categories','suppliers','recurring_expenses','loans','visit_finance','finance_payments','finance_entries','finance_movements','daily_closings','finance_visit_balances','finance_entry_overview','finance_receivables','finance_loan_balances','finance_supplier_balances']:[])]
  const unexpected: string[] = []
  const identifier = (value: string) => {
    if (!/^[a-z_]+$/.test(value)) throw new Error('Identificador inválido no adaptador de testes')
    return `"${value}"`
  }
  await page.route(/https:\/\/[^/]+\.supabase\.co\/.*/, async route => {
    const request = route.request(), url = new URL(request.url())
    try {
      if (url.pathname === '/auth/v1/token') {
        await route.fulfill({ json: { access_token: token, refresh_token: 'test-only-refresh-token', token_type: 'bearer', expires_in: 3600, user } }); return
      }
      if (url.pathname === '/auth/v1/user') { await route.fulfill({ json: user }); return }
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.split('/').pop()!, args = request.postDataJSON()
        const definitions: Record<string, [string, unknown[]]> = {
          schedule_new_patient:['select public.schedule_new_patient($1::jsonb) as result',[JSON.stringify(args.p_data)]],
          manage_appointment_removal:['select public.manage_appointment_removal($1,$2,$3) as result',[args.p_id,args.p_version,args.p_confirm??false]],
          search_patients: ['select * from public.search_patients($1,$2,$3)', [args.p_query ?? '', args.p_offset ?? 0, args.p_active_only ?? false]],
          start_visit: ['select public.start_visit($1) as result', [args.p_appointment_id]],
          save_visit: ['select public.save_visit($1::jsonb) as result', [JSON.stringify(args.p_data)]],
          cancel_visit: ['select public.cancel_visit($1,$2,$3) as result', [args.p_id, args.p_version, args.p_reason]],
          finance_catalogs:['select public.finance_catalogs() as result',[]],
          finance_report:['select public.finance_report($1,$2) as result',[args.p_from,args.p_to]],
          finance_command:['select public.finance_command($1::jsonb) as result',[JSON.stringify(args.p_data)]],
          card_settlement_report:['select public.card_settlement_report($1,$2) as result',[args.p_from,args.p_to]],
          card_settlement_details:['select public.card_settlement_details($1) as result',[args.p_entry_id]],
          card_settlement_exception:['select public.card_settlement_exception($1::jsonb) as result',[JSON.stringify(args.p_data)]],
          manage_record_removal:['select public.manage_record_removal($1,$2,$3,$4) as result',[args.p_table,args.p_id,args.p_version,args.p_confirm]],
        }
        if (!definitions[name]) throw new Error('RPC inesperada: ' + name)
        const [sql, values] = definitions[name]
        const { rows } = await db.query<{ result: unknown }>(sql, values)
        await route.fulfill({ json: name === 'search_patients' ? rows : rows[0].result }); return
      }
      const table = url.pathname.split('/').pop()!
      if (!url.pathname.startsWith('/rest/v1/') || (!allowedTables.includes(table) && table !== 'recurring_expenses')) { unexpected.push(url.pathname); await route.abort(); return }
      const values: unknown[] = [], conditions: string[] = []
      for (const [column, filter] of url.searchParams) {
        if (['select', 'order', 'offset', 'limit'].includes(column)) continue
        const dot = filter.indexOf('.'), op = filter.slice(0, dot), value = filter.slice(dot + 1)
        const operators: Record<string, string> = { eq: '=', gte: '>=', lt: '<',lte:'<=',gt:'>',neq:'<>' }
        if (!operators[op]) throw new Error('Filtro não suportado no teste: ' + op)
        values.push(value); conditions.push(`${identifier(column)} ${operators[op]} $${values.length}`)
      }
      const where = conditions.length ? ' where ' + conditions.join(' and ') : ''
      let sql: string
      if (request.method() === 'GET') {
        const order = url.searchParams.get('order')?.split(',').map(p => { const [name, direction] = p.split('.'); return `${identifier(name)} ${direction === 'desc' ? 'desc' : 'asc'}` }).join(',')
        const selected = url.searchParams.get('select') ?? '*'
        const columns = selected === '*' ? '*' : selected.split(',').map(identifier).join(',')
        sql = `select ${columns} from public.${identifier(table)}${where}${order ? ' order by ' + order : ''} limit ${Math.min(1000, Number(url.searchParams.get('limit') ?? 1000))} offset ${Number(url.searchParams.get('offset') ?? 0)}`
      } else if (request.method() === 'POST') {
        const body = request.postDataJSON(), keys = Object.keys(body)
        if (values.length) throw new Error('Filtro inesperado no insert de teste')
        values.push(...keys.map(key => body[key]))
        sql = `insert into public.${identifier(table)}(${keys.map(identifier).join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`
      } else if (request.method() === 'PATCH') {
        const body = request.postDataJSON(), keys = Object.keys(body)
        const setters = keys.map(key => { values.push(body[key]); return `${identifier(key)}=$${values.length}` })
        sql = `update public.${identifier(table)} set ${setters.join(',')}${where} returning *`
      } else throw new Error('Método inesperado de teste')
      const { rows } = await db.query(sql, values)
      const single = request.headers().accept?.includes('vnd.pgrst.object')
      await route.fulfill({ json: single ? rows[0] ?? null : rows })
    } catch (error) {
      const e = error as { code?: string; message: string }
      await route.fulfill({ status: e.code === '42501' ? 403 : 400, json: { code: e.code ?? 'TEST_API_ERROR', message: e.message } })
    }
  })
  return { db, unexpected, async close() { await page.unrouteAll({ behavior: 'ignoreErrors' }); await Promise.race([db.close(),new Promise(resolve=>setTimeout(resolve,3000))]) } }
}

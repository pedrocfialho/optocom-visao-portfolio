// @vitest-environment node
// Dados sintéticos de portfólio: nenhum paciente, fornecedor ou credencial real.
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const adminId = '00000000-0000-0000-0000-000000000001'
const otherId = '00000000-0000-0000-0000-000000000002'
beforeAll(async () => {
  // Simula apenas as interfaces fornecidas pelo Supabase. As tabelas e políticas
  // testadas vêm da migration real, executada pelo motor PostgreSQL.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    insert into auth.users values ('${adminId}'), ('${otherId}');
  `)
  await db.exec(await readFile(new URL('./migrations/202610300001_foundation.sql', import.meta.url), 'utf8'))
  await db.exec(`set role service_role; insert into public.users_profile(id, full_name) values ('${adminId}', 'Administrador Um'); reset role;`)
}, 30000)
afterAll(async () => { await db.close() })

async function asUser<T>(role: string, id: string, action: () => Promise<T>) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${id}', false);`)
  try { return await action() } finally { await db.exec('reset role;') }
}

describe('Migration e RLS executadas em PostgreSQL', () => {
  it('nega acesso anônimo aos perfis e à auditoria', async () => {
    await asUser('anon', '', async () => {
      await expect(db.query('select * from users_profile')).rejects.toThrow('permission denied')
      await expect(db.query('select * from audit_log')).rejects.toThrow('permission denied')
    })
  })
  it('usuário autenticado sem perfil não vê dados e não cria sua permissão', async () => {
    await asUser('authenticated', otherId, async () => {
      expect((await db.query('select * from users_profile')).rows).toHaveLength(0)
      expect((await db.query('select * from audit_log')).rows).toHaveLength(0)
      await expect(db.query(`insert into users_profile(id, full_name) values ('${otherId}', 'Invasor')`)).rejects.toThrow('permission denied')
    })
  })
  it('administrador ativo lê os perfis e o evento de provisionamento', async () => {
    await asUser('authenticated', adminId, async () => {
      expect((await db.query('select * from users_profile')).rows).toHaveLength(1)
      const { rows } = await db.query<{ action: string; user_id: string | null }>('select action, user_id from audit_log')
      expect(rows).toEqual([{ action: 'create', user_id: null }])
    })
  })
  it('nem o administrador edita permissões, exclui perfis ou altera auditoria pelo cliente', async () => {
    await asUser('authenticated', adminId, async () => {
      await expect(db.query('update users_profile set active = false')).rejects.toThrow('permission denied')
      await expect(db.query('delete from users_profile')).rejects.toThrow('permission denied')
      await expect(db.query('delete from audit_log')).rejects.toThrow('permission denied')
    })
  })
  it('restrições impedem papel inválido e exclusão do usuário com histórico', async () => {
    await expect(db.query(`update users_profile set role = 'viewer'`)).rejects.toThrow('check constraint')
    await expect(db.query(`delete from auth.users where id = '${adminId}'`)).rejects.toThrow('foreign key constraint')
  })
  it('desativação é auditada e bloqueia acesso mesmo com token ainda válido', async () => {
    await asUser('service_role', '', () => db.query('update users_profile set active = false'))
    const { rows } = await db.query<{ action: string }>("select action from audit_log where action = 'deactivate'")
    expect(rows).toHaveLength(1)
    await asUser('authenticated', adminId, async () => {
      expect((await db.query('select * from users_profile')).rows).toHaveLength(0)
      expect((await db.query('select * from audit_log')).rows).toHaveLength(0)
    })
  })
})

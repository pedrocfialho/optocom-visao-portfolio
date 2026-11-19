-- Somente leitura. Executar após aplicar a migration pelo CLI.
-- Não contém criação de schema nem inserção de perfis.
select to_regclass('public.users_profile') as users_profile;

select version
from supabase_migrations.schema_migrations
where version = '202610300001';

select c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'users_profile';

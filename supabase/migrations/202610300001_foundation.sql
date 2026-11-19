-- Fase 1: somente identidade, autorização e auditoria de perfis.
begin;

create table public.users_profile (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  role text not null default 'admin' check (role = 'admin'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

-- Esta base pressupõe um projeto Supabase exclusivo da clínica.
create function public.is_active_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.users_profile
    where id = (select auth.uid()) and active and role = 'admin'
  );
$$;
revoke all on function public.is_active_admin() from public, anon;
grant execute on function public.is_active_admin() to authenticated;

alter table public.users_profile enable row level security;
revoke all on public.users_profile from anon, authenticated;
grant select on public.users_profile to authenticated;
grant select, insert, update on public.users_profile to service_role;
-- Mesmo administradores não editam autorização no navegador.
create policy profiles_read_active_admin on public.users_profile
for select to authenticated using ((select public.is_active_admin()));

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('create', 'update', 'deactivate')),
  before_json jsonb,
  after_json jsonb not null,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id, created_at);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
create policy audit_read_active_admin on public.audit_log
for select to authenticated using ((select public.is_active_admin()));

create function public.stamp_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
create trigger stamp_profile before insert or update on public.users_profile
for each row execute function public.stamp_profile();

create function public.audit_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(user_id, entity_type, entity_id, action, before_json, after_json)
  values (auth.uid(), 'users_profile', new.id,
    case when tg_op = 'INSERT' then 'create'
         when old.active and not new.active then 'deactivate' else 'update' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new));
  return new;
end;
$$;
revoke all on function public.stamp_profile() from public, anon, authenticated;
revoke all on function public.audit_profile() from public, anon, authenticated;
create trigger audit_profile after insert or update on public.users_profile
for each row execute function public.audit_profile();

comment on table public.users_profile is 'Provisionamento administrativo externo; sem cadastro público ou promoção pelo cliente.';
comment on table public.audit_log is 'Fase 1: alterações de perfis. user_id nulo identifica operação privilegiada de provisionamento. Expansão nas fases seguintes.';
commit;

-- Fase 2: núcleo operacional. Sem pagamentos, recebíveis ou lançamentos financeiros.
begin;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  phone text not null check (length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15),
  phone_digits text generated always as (regexp_replace(phone, '[^0-9]', '', 'g')) stored,
  birth_date date check (birth_date is null or birth_date <= current_date),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  admin_notes text not null default '' check (length(admin_notes) <= 2000),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create index patients_name_idx on public.patients(lower(full_name));
create index patients_phone_idx on public.patients(phone_digits);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  default_price numeric(12,2) not null default 0 check (default_price >= 0 and default_price <> 'NaN'::numeric),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  default_price numeric(12,2) not null default 0 check (default_price >= 0 and default_price <> 'NaN'::numeric),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  appointment_type_id uuid not null references public.appointment_types(id) on delete restrict,
  start_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','attended','cancelled','no_show')),
  admin_notes text not null default '' check (length(admin_notes) <= 2000),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  check (status <> 'cancelled' or length(trim(cancel_reason)) > 0 and cancel_reason is not null)
);
create index appointments_day_idx on public.appointments(start_at);
create index appointments_patient_idx on public.appointments(patient_id, start_at desc);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  appointment_type_id uuid not null references public.appointment_types(id) on delete restrict,
  appointment_id uuid unique references public.appointments(id) on delete restrict,
  visit_at timestamptz not null,
  consultation_name_snapshot text not null,
  base_price numeric(12,2) not null check (base_price >= 0 and base_price <> 'NaN'::numeric),
  consultation_discount numeric(12,2) not null default 0 check (consultation_discount >= 0 and consultation_discount <= base_price and consultation_discount <> 'NaN'::numeric),
  consultation_final numeric(12,2) generated always as (base_price - consultation_discount) stored,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  status text not null default 'draft' check (status in ('draft','completed','cancelled')),
  admin_notes text not null default '' check (length(admin_notes) <= 2000),
  cancel_reason text,
  cancelled_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  check (status <> 'cancelled' or (length(trim(cancel_reason)) > 0 and cancel_reason is not null and cancelled_at is not null))
);
create index visits_patient_idx on public.visits(patient_id, visit_at desc);
create index visits_date_idx on public.visits(visit_at desc);
create table public.visit_exams (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete restrict,
  exam_id uuid not null references public.exams(id) on delete restrict,
  exam_name_snapshot text not null,
  unit_price_snapshot numeric(12,2) not null check (unit_price_snapshot >= 0 and unit_price_snapshot <> 'NaN'::numeric),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  unique (visit_id, exam_id)
);

create function public.stamp_operational() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := auth.uid(); new.version := 1;
  else
    new.created_at := old.created_at; new.created_by := old.created_by;
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
create function public.audit_operational() returns trigger
language plpgsql security definer set search_path = '' as $$
declare previous jsonb;
begin
  if tg_op = 'UPDATE' then previous := to_jsonb(old); end if;
  insert into public.audit_log(user_id,entity_type,entity_id,action,before_json,after_json)
  values(auth.uid(),tg_table_name,new.id,
    case when tg_op='INSERT' then 'create'
      when previous->>'active'='true' and to_jsonb(new)->>'active'='false' then 'deactivate'
      else 'update' end, previous, to_jsonb(new));
  return new;
end;
$$;
create function public.prevent_operational_delete() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Exclusão definitiva indisponível. Inative ou cancele o registro.'; end;
$$;

-- Somente os novos objetos são configurados. A fundação de autenticação permanece intacta.
do $$
declare t text;
begin
  foreach t in array array['patients','professionals','appointment_types','exams','appointments','visits','visit_exams'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated, service_role',t);
    execute format('grant select on public.%I to authenticated, service_role',t);
    execute format('create policy active_admin_read on public.%I for select to authenticated using ((select public.is_active_admin()))',t);
    if t not in ('visits','visit_exams') then
      execute format('grant insert, update on public.%I to authenticated, service_role',t);
      execute format('create policy active_admin_insert on public.%I for insert to authenticated with check ((select public.is_active_admin()))',t);
      execute format('create policy active_admin_update on public.%I for update to authenticated using ((select public.is_active_admin())) with check ((select public.is_active_admin()))',t);
    end if;
    execute format('create trigger stamp_operational before insert or update on public.%I for each row execute function public.stamp_operational()',t);
    execute format('create trigger audit_operational after insert or update on public.%I for each row execute function public.audit_operational()',t);
    execute format('create trigger prevent_operational_delete before delete on public.%I for each row execute function public.prevent_operational_delete()',t);
  end loop;
end;
$$;

create function public.guard_appointment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' or new.patient_id is distinct from old.patient_id then
    if not exists(select 1 from public.patients where id=new.patient_id and active) then raise exception 'Selecione um paciente ativo.'; end if;
  end if;
  if tg_op='INSERT' or new.professional_id is distinct from old.professional_id then
    if not exists(select 1 from public.professionals where id=new.professional_id and active) then raise exception 'Selecione um profissional ativo.'; end if;
  end if;
  if tg_op='INSERT' or new.appointment_type_id is distinct from old.appointment_type_id then
    if not exists(select 1 from public.appointment_types where id=new.appointment_type_id and active) then raise exception 'Selecione um tipo de consulta ativo.'; end if;
  end if;
  if new.status='attended' and not exists(select 1 from public.visits where appointment_id=new.id and status='completed') then
    raise exception 'Conclua o atendimento para marcar como Atendido.';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.visits where appointment_id=old.id) then
    if row(new.patient_id,new.professional_id,new.appointment_type_id,new.start_at) is distinct from row(old.patient_id,old.professional_id,old.appointment_type_id,old.start_at) then
      raise exception 'Este agendamento já tem atendimento. Preserve seus vínculos e consulte o histórico.';
    end if;
    if exists(select 1 from public.visits where appointment_id=old.id and status in ('draft','completed')) and new.status in ('cancelled','no_show') then
      raise exception 'Cancele o atendimento vinculado antes de alterar esse status.';
    end if;
    if old.status='attended' and new.status not in ('attended','cancelled') then raise exception 'Um atendimento concluído deve ser preservado ou cancelado com motivo.'; end if;
  end if;
  return new;
end;
$$;
create trigger guard_appointment before insert or update on public.appointments
for each row execute function public.guard_appointment();

create function public.search_patients(p_query text default '', p_offset integer default 0, p_active_only boolean default false)
returns setof public.patients language sql stable security invoker set search_path = '' as $$
  select * from public.patients
  where (not p_active_only or active) and (strpos(lower(full_name), lower(left(trim(p_query),100)))>0
    or (regexp_replace(p_query,'[^0-9]','','g')<>'' and strpos(phone_digits,regexp_replace(p_query,'[^0-9]','','g'))>0))
  order by full_name,id limit 21 offset greatest(0,p_offset);
$$;

create function public.start_visit(p_appointment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; v public.visits; consultation public.appointment_types;
begin
  if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
  select * into a from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  select * into v from public.visits where appointment_id=a.id;
  if found then return to_jsonb(v); end if;
  if a.status not in ('scheduled','confirmed') then raise exception 'Somente agendamentos ativos podem iniciar atendimento.'; end if;
  if not exists(select 1 from public.patients where id=a.patient_id and active) or not exists(select 1 from public.professionals where id=a.professional_id and active) then raise exception 'Paciente e profissional devem estar ativos.'; end if;
  select * into consultation from public.appointment_types where id=a.appointment_type_id and active;
  if not found then raise exception 'Tipo de consulta inativo.'; end if;
  insert into public.visits(patient_id,professional_id,appointment_type_id,appointment_id,visit_at,consultation_name_snapshot,base_price,total_amount)
  values(a.patient_id,a.professional_id,a.appointment_type_id,a.id,a.start_at,consultation.name,consultation.default_price,consultation.default_price) returning * into v;
  return to_jsonb(v);
end;
$$;

create function public.save_visit(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits; a public.appointments; item jsonb; exam public.exams;
  target_id uuid := nullif(p_data->>'id','')::uuid;
  patient uuid := (p_data->>'patient_id')::uuid;
  professional uuid := (p_data->>'professional_id')::uuid;
  consultation_id uuid := (p_data->>'appointment_type_id')::uuid;
  consultation_name text;
  base numeric(12,2) := (p_data->>'base_price')::numeric;
  discount numeric(12,2) := (p_data->>'consultation_discount')::numeric;
  exams_total numeric(12,2) := 0;
  exam_price numeric(12,2);
  completed boolean := coalesce((p_data->>'complete')::boolean,false);
  previous_version integer;
begin
  if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
  -- Repetição da mesma criação após falha de rede não duplica o atendimento.
  if target_id is null and nullif(p_data->>'request_id','') is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_data->>'request_id',0));
    select * into v from public.visits where request_id=(p_data->>'request_id')::uuid;
    if found then return to_jsonb(v); end if;
  end if;
  if jsonb_typeof(p_data->'exams') is distinct from 'array' or jsonb_array_length(p_data->'exams')>100 then raise exception 'Lista de exames inválida.'; end if;
  if base is null or discount is null or base='NaN'::numeric or discount='NaN'::numeric or base<0 or discount<0 or discount>base then raise exception 'O desconto deve estar entre zero e o valor da consulta.'; end if;
  if target_id is not null then
    select * into v from public.visits where id=target_id for update;
    if not found then raise exception 'Atendimento não encontrado.'; end if;
    if v.status<>'draft' then raise exception 'Atendimento concluído ou cancelado não pode ser reescrito.'; end if;
    previous_version := (p_data->>'version')::integer;
    if previous_version is distinct from v.version then raise exception 'Outro computador alterou este atendimento. Recarregue antes de salvar.' using errcode='40001'; end if;
  end if;
  if target_id is null or patient is distinct from v.patient_id then
    if not exists(select 1 from public.patients where id=patient and active) then raise exception 'Selecione um paciente ativo.'; end if;
  end if;
  if target_id is null or professional is distinct from v.professional_id then
    if not exists(select 1 from public.professionals where id=professional and active) then raise exception 'Selecione um profissional ativo.'; end if;
  end if;
  select name into consultation_name from public.appointment_types where id=consultation_id;
  if not found then raise exception 'Tipo de consulta não encontrado.'; end if;
  if (target_id is null or consultation_id is distinct from v.appointment_type_id) and not exists(select 1 from public.appointment_types where id=consultation_id and active) then raise exception 'Selecione um tipo de consulta ativo.'; end if;
  if v.appointment_id is not null then
    select * into a from public.appointments where id=v.appointment_id for update;
    if a.status not in ('scheduled','confirmed') or row(patient,professional,consultation_id,(p_data->>'visit_at')::timestamptz) is distinct from row(a.patient_id,a.professional_id,a.appointment_type_id,a.start_at) then raise exception 'Preserve os dados do agendamento vinculado.'; end if;
  end if;
  if (select count(*) from jsonb_array_elements(p_data->'exams')) <> (select count(distinct x->>'exam_id') from jsonb_array_elements(p_data->'exams') x) then raise exception 'Um exame não pode ser adicionado duas vezes.'; end if;
  for item in select * from jsonb_array_elements(p_data->'exams') loop
    exam_price := (item->>'unit_price')::numeric;
    if exam_price is null or exam_price='NaN'::numeric or exam_price<0 then raise exception 'Valor do exame inválido.'; end if;
    select * into exam from public.exams where id=(item->>'exam_id')::uuid;
    if not found then raise exception 'Exame não encontrado.'; end if;
    if not exam.active and not exists(select 1 from public.visit_exams where visit_id=target_id and exam_id=exam.id and active) then raise exception 'Selecione um exame ativo.'; end if;
    exams_total := exams_total + exam_price;
  end loop;
  if target_id is null then
    insert into public.visits(request_id,patient_id,professional_id,appointment_type_id,visit_at,consultation_name_snapshot,base_price,consultation_discount,total_amount,admin_notes,status)
    values(coalesce(nullif(p_data->>'request_id','')::uuid,gen_random_uuid()),patient,professional,consultation_id,(p_data->>'visit_at')::timestamptz,consultation_name,base,discount,base-discount+exams_total,coalesce(p_data->>'admin_notes',''),case when completed then 'completed' else 'draft' end) returning * into v;
    target_id := v.id;
  else
    update public.visits set patient_id=patient,professional_id=professional,appointment_type_id=consultation_id,
      visit_at=(p_data->>'visit_at')::timestamptz,
      consultation_name_snapshot=case when appointment_type_id=consultation_id then consultation_name_snapshot else consultation_name end,
      base_price=base,consultation_discount=discount,total_amount=base-discount+exams_total,
      admin_notes=coalesce(p_data->>'admin_notes',''),status=case when completed then 'completed' else 'draft' end
    where id=target_id returning * into v;
  end if;
  -- Remover um item significa inativá-lo, preservando a linha e sua auditoria.
  update public.visit_exams set active=false where visit_id=target_id and active and exam_id not in (select (x->>'exam_id')::uuid from jsonb_array_elements(p_data->'exams') x);
  for item in select * from jsonb_array_elements(p_data->'exams') loop
    select * into exam from public.exams where id=(item->>'exam_id')::uuid;
    insert into public.visit_exams(visit_id,exam_id,exam_name_snapshot,unit_price_snapshot)
    values(target_id,exam.id,exam.name,(item->>'unit_price')::numeric)
    on conflict(visit_id,exam_id) do update set unit_price_snapshot=excluded.unit_price_snapshot,active=true;
  end loop;
  if completed and v.appointment_id is not null then update public.appointments set status='attended' where id=v.appointment_id; end if;
  return to_jsonb(v);
end;
$$;

create function public.cancel_visit(p_id uuid,p_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.visits;
begin
  if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
  if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Informe um motivo de cancelamento entre 3 e 500 caracteres.'; end if;
  select * into v from public.visits where id=p_id for update;
  if not found then raise exception 'Atendimento não encontrado.'; end if;
  if v.version is distinct from p_version then raise exception 'Outro computador alterou este atendimento. Recarregue.' using errcode='40001'; end if;
  if v.status='cancelled' then raise exception 'Este atendimento já está cancelado.'; end if;
  update public.visits set status='cancelled',cancelled_at=now(),cancel_reason=trim(p_reason) where id=p_id returning * into v;
  if v.appointment_id is not null then update public.appointments set status='cancelled',cancel_reason=trim(p_reason) where id=v.appointment_id; end if;
  return to_jsonb(v);
end;
$$;

create view public.appointment_overview with (security_invoker=true) as
select a.*,p.full_name as patient_name,r.full_name as professional_name,t.name as consultation_name,v.id as visit_id,v.status as visit_status
from public.appointments a join public.patients p on p.id=a.patient_id join public.professionals r on r.id=a.professional_id
join public.appointment_types t on t.id=a.appointment_type_id left join public.visits v on v.appointment_id=a.id;
create view public.visit_overview with (security_invoker=true) as
select v.*,p.full_name as patient_name,r.full_name as professional_name
from public.visits v join public.patients p on p.id=v.patient_id join public.professionals r on r.id=v.professional_id;
revoke all on public.appointment_overview,public.visit_overview from public,anon,authenticated,service_role;
grant select on public.appointment_overview,public.visit_overview to authenticated,service_role;

revoke all on function public.stamp_operational(),public.audit_operational(),public.prevent_operational_delete(),public.guard_appointment() from public,anon,authenticated,service_role;
revoke all on function public.search_patients(text,integer,boolean),public.start_visit(uuid),public.save_visit(jsonb),public.cancel_visit(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.search_patients(text,integer,boolean),public.start_visit(uuid),public.save_visit(jsonb),public.cancel_visit(uuid,integer,text) to authenticated;

comment on table public.visits is 'Núcleo operacional. Pagamentos serão vinculados em fase futura; total e status são validados nas funções transacionais.';
commit;

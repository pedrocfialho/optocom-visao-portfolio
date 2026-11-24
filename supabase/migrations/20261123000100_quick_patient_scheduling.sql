-- Cadastro único de pacientes: telefone opcional e agendamento rápido atômico.
-- Não atualiza nem remove registros existentes; preserva RLS, autoria e auditoria.
begin;

-- A CHECK existente continua validando telefones informados; NULL representa ausência.
alter table public.patients alter column phone drop not null;

-- Estado explícito, independente dos campos opcionais. O DEFAULT considera todos
-- os pacientes anteriores completos, sem UPDATE de dados ou mudança de identidade.
alter table public.patients add column registration_pending boolean not null default false;

-- A coluna nova é acrescentada ao fim, preservando o contrato e permissões da view.
create or replace view public.appointment_overview with (security_invoker=true) as
select a.*,p.full_name as patient_name,r.full_name as professional_name,t.name as consultation_name,
       v.id as visit_id,v.status as visit_status,p.registration_pending as patient_registration_pending
from public.appointments a
join public.patients p on p.id=a.patient_id
join public.professionals r on r.id=a.professional_id
join public.appointment_types t on t.id=a.appointment_type_id
left join public.visits v on v.appointment_id=a.id;

-- SECURITY INVOKER: além da checagem explícita, INSERTs passam pelas RLS existentes.
-- Sem correspondência automática por nome: homônimos são pacientes distintos.
create function public.schedule_new_patient(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare patient public.patients; appointment public.appointments;
begin
  if not public.is_active_admin() then
    raise exception 'Acesso restrito a administrador ativo.' using errcode='42501';
  end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' then
    raise exception 'Informe o nome e os dados do agendamento.';
  end if;
  if coalesce(p_data->>'status','scheduled') not in ('scheduled','confirmed') then
    raise exception 'Um novo paciente deve ser agendado ou confirmado.';
  end if;
  insert into public.patients(full_name,phone,registration_pending)
  values(trim(p_data->>'full_name'),null,true) returning * into patient;
  insert into public.appointments(patient_id,professional_id,appointment_type_id,start_at,status,admin_notes)
  values(patient.id,(p_data->>'professional_id')::uuid,(p_data->>'appointment_type_id')::uuid,
    (p_data->>'start_at')::timestamptz,coalesce(p_data->>'status','scheduled'),coalesce(p_data->>'admin_notes',''))
  returning * into appointment;
  return to_jsonb(appointment);
end;
$$;
revoke all on function public.schedule_new_patient(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.schedule_new_patient(jsonb) to authenticated;

commit;

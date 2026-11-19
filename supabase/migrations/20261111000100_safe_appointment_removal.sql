-- Proposta local: exclusão auditada somente de agendamento criado por engano.
-- Não exclui dados na instalação; não altera RLS, visitas ou financeiro.
begin;
create function public.appointment_has_history(p_id uuid) returns boolean
language plpgsql set search_path='' as $$
declare fk record; column_name name; linked boolean;
begin
 if exists(select 1 from public.appointments where id=p_id and (status<>'scheduled' or version<>1)) then return true;end if;
 -- A auditoria de criação é preservada, mas edições/cancelamentos já são história.
 if exists(select 1 from public.audit_log where entity_type='appointments' and entity_id=p_id and action<>'create') then return true;end if;
 for fk in select * from pg_catalog.pg_constraint where contype='f' and confrelid='public.appointments'::regclass loop
  if cardinality(fk.conkey)<>1 or cardinality(fk.confkey)<>1 or not exists(select 1 from pg_catalog.pg_attribute where attrelid=fk.confrelid and attnum=fk.confkey[1] and attname='id') then return true;end if;
  select attname into column_name from pg_catalog.pg_attribute where attrelid=fk.conrelid and attnum=fk.conkey[1];
  execute format('select exists(select 1 from %s where %I=$1)',fk.conrelid::regclass,column_name) into linked using p_id;
  if linked then return true;end if;
 end loop;
 return false;
end;$$;

create function public.guard_safe_appointment_delete() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name<>'appointments' or current_user is distinct from pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid=tg_relid)) or not public.is_active_admin() then
  raise exception 'Acesso restrito a administrador ativo.' using errcode='42501';
 end if;
 if public.appointment_has_history(old.id) then raise exception 'Este agendamento possui histórico ou vínculos. Use Cancelar consulta.';end if;
 insert into public.audit_log(user_id,entity_type,entity_id,action,before_json,after_json)
 values(auth.uid(),'appointments',old.id,'update',to_jsonb(old),jsonb_build_object('deleted',true,'record',to_jsonb(old)));
 return old;
end;$$;

-- Substituição pontual do bloqueio nesta tabela por proteção auditada equivalente.
drop trigger prevent_operational_delete on public.appointments;
create trigger prevent_operational_delete before delete on public.appointments for each row execute function public.guard_safe_appointment_delete();

create function public.manage_appointment_removal(p_id uuid,p_version integer,p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.appointments; linked boolean;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501';end if;
 if p_id is null or p_version is null or p_confirm is null then raise exception 'Informe agendamento, versão e confirmação.';end if;
 -- Conflita com INSERT de vínculos FK e com início/edição do atendimento.
 select * into a from public.appointments where id=p_id for update;
 if not found then raise exception 'Agendamento não encontrado. Atualize a agenda.';end if;
 if a.version is distinct from p_version then raise exception 'Outro computador alterou o agendamento. Atualize a agenda.' using errcode='40001';end if;
 linked:=public.appointment_has_history(a.id);
 if p_confirm then
  if linked then raise exception 'Este agendamento possui histórico ou vínculos. Use Cancelar consulta.';end if;
  begin
   delete from public.appointments where id=a.id;
  exception when foreign_key_violation then
   raise exception 'Este agendamento recebeu um vínculo. Use Cancelar consulta.';
  end;
 end if;
 return jsonb_build_object('allowed',not linked,'deleted',p_confirm,'version',a.version,'reason',case when linked then 'Este agendamento possui histórico ou vínculos. Use Cancelar consulta.' else '' end);
end;$$;
revoke all on function public.appointment_has_history(uuid),public.guard_safe_appointment_delete(),public.manage_appointment_removal(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.manage_appointment_removal(uuid,integer,boolean) to authenticated;
commit;

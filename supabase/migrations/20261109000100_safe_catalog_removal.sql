-- Usabilidade: exclusão auditada somente de pacientes/taxas sem vínculos.
-- PROPOSTA LOCAL. Aplicação remota depende de aprovação explícita.
-- Não exclui dados ao aplicar; ajusta somente dois triggers e cria funções.
begin;

create function public.catalog_record_has_links(p_table text,p_id uuid) returns boolean
language plpgsql set search_path='' as $$
declare target regclass; fk record; column_name name; found_link boolean;
begin
 if p_table not in ('patients','card_fee_rules') then raise exception 'Cadastro inválido.'; end if;
 target:=format('public.%I',p_table)::regclass;
 -- Considera todas as FKs existentes, inclusive vínculos futuros. Relação não
 -- reconhecida é conservadoramente tratada como histórica, nunca removida.
 for fk in select * from pg_catalog.pg_constraint where contype='f' and confrelid=target loop
  if cardinality(fk.conkey)<>1 or cardinality(fk.confkey)<>1
   or not exists(select 1 from pg_catalog.pg_attribute where attrelid=target and attnum=fk.confkey[1] and attname='id') then return true; end if;
  select attname into column_name from pg_catalog.pg_attribute where attrelid=fk.conrelid and attnum=fk.conkey[1];
  execute format('select exists(select 1 from %s where %I=$1)',fk.conrelid::regclass,column_name) into found_link using p_id;
  if found_link then return true; end if;
 end loop;
 return false;
end; $$;

create function public.guard_safe_catalog_delete() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name not in ('patients','card_fee_rules') then raise exception 'Exclusão indisponível.'; end if;
 -- Nenhum DELETE é concedido ao frontend. O chamador deve estar dentro da RPC
 -- privilegiada (owner da tabela) E representar um administrador ativo.
 if current_user is distinct from pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid=tg_relid))
  or not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 if public.catalog_record_has_links(tg_table_name,old.id) then raise exception 'Registro possui histórico. Inative o cadastro.' using errcode='23503'; end if;
 -- O enum de auditoria existente permanece intacto. O evento update registra
 -- explicitamente deleted=true e mantém o snapshot do registro excluído.
 insert into public.audit_log(user_id,entity_type,entity_id,action,before_json,after_json)
 values(auth.uid(),tg_table_name,old.id,'update',to_jsonb(old),jsonb_build_object('deleted',true,'record',to_jsonb(old)));
 return old;
end; $$;

-- Troca pontual dos bloqueios de DELETE SOMENTE nestes dois cadastros.
-- Proteções de atendimentos/financeiro e os triggers de imutabilidade permanecem.
drop trigger prevent_operational_delete on public.patients;
create trigger prevent_operational_delete before delete on public.patients for each row execute function public.guard_safe_catalog_delete();
drop trigger prevent_finance_delete on public.card_fee_rules;
create trigger prevent_finance_delete before delete on public.card_fee_rules for each row execute function public.guard_safe_catalog_delete();

create function public.manage_record_removal(p_table text,p_id uuid,p_version integer,p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare original jsonb; linked boolean; outcome text; label text;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 if p_table not in ('patients','card_fee_rules') then raise exception 'Cadastro inválido.'; end if;
 if p_id is null or p_version is null or p_confirm is null then raise exception 'Informe registro, versão e confirmação.'; end if;
 -- FOR UPDATE conflita com KEY SHARE de novos vínculos FK: a decisão e a
 -- exclusão são atômicas mesmo quando outros computadores estão em uso.
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',p_table) into original using p_id;
 if original is null then raise exception 'Registro não encontrado. Recarregue os dados.'; end if;
 if (original->>'version')::integer is distinct from p_version then raise exception 'Outro computador alterou este cadastro. Recarregue.' using errcode='40001'; end if;
 linked:=public.catalog_record_has_links(p_table,p_id);
 label:=case p_table when 'patients' then original->>'full_name' else (original->>'acquirer')||' · '||(original->>'brand') end;
 outcome:=case when linked then 'deactivate' else 'delete' end;
 if p_confirm then
  if not linked then
   begin
    execute format('delete from public.%I where id=$1',p_table) using p_id;
   exception when foreign_key_violation then
    -- FK acrescentada/alterada concorrentemente: falha conservadora. A tentativa
    -- e seu evento de exclusão são revertidos antes de inativar.
    linked:=true;outcome:='deactivate';
   end;
  end if;
  if linked and (original->>'active')::boolean then
   execute format('update public.%I set active=false where id=$1',p_table) using p_id;
  end if;
 end if;
 return jsonb_build_object('action',outcome,'name',label,'linked',linked,'version',p_version);
end; $$;

revoke all on function public.catalog_record_has_links(text,uuid),public.guard_safe_catalog_delete(),public.manage_record_removal(text,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.manage_record_removal(text,uuid,integer,boolean) to authenticated;
comment on function public.manage_record_removal(text,uuid,integer,boolean) is 'Admin ativo: preview ou exclusão auditada de cadastro sem vínculos; registros históricos são somente inativados. Sem DELETE direto ou mudança de RLS.';
commit;

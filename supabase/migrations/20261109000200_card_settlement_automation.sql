-- PROPOSTA LOCAL: requer aprovação e Supabase Cron habilitado antes da aplicação.
-- Nenhum backfill: pagamentos/parcelas existentes não são migrados para automação.
begin;
create table public.card_settlement_plans (
 id uuid primary key default gen_random_uuid(),entry_id uuid not null unique references public.finance_entries(id),
 original_due_on date not null,expected_on date not null,auto_enabled boolean not null default true,
 state text not null default 'scheduled' check(state in ('scheduled','held','automatic','manual','cancelled')),
 exception_kind text,version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),updated_by uuid references auth.users(id)
);
create index card_settlement_pending_idx on public.card_settlement_plans(expected_on) where auto_enabled and state='scheduled';
create table public.card_settlement_events (
 id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.card_settlement_plans(id),
 movement_id uuid unique references public.finance_movements(id),kind text not null check(kind in ('automatic','manual','reversal','hold','not_received','chargeback','reschedule','difference','cancelled')),
 source text check(source in ('automatic','manual')),notes text not null default '' check(length(notes)<=1000),
 expected_on date,net_difference numeric(12,2) not null default 0,
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),updated_by uuid references auth.users(id)
);
do $$declare t text;begin
 foreach t in array array['card_settlement_plans','card_settlement_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy card_admin_read on public.%I for select to authenticated using ((select public.is_active_admin()))',t);
  execute format('create trigger stamp_card before insert or update on public.%I for each row execute function public.stamp_operational()',t);
  execute format('create trigger audit_card after insert or update on public.%I for each row execute function public.audit_operational()',t);
  execute format('create trigger prevent_card_delete before delete on public.%I for each row execute function public.prevent_operational_delete()',t);
 end loop;
end;$$;
create trigger immutable_card_event before update on public.card_settlement_events for each row execute function public.prevent_operational_delete();

create function public.track_card_entry() returns trigger language plpgsql security definer set search_path='' as $$
declare plan public.card_settlement_plans;
begin
 if tg_op='INSERT' then
  if new.origin='visit_payment' and new.method_kind_snapshot in ('credit','debit') then
   insert into public.card_settlement_plans(entry_id,original_due_on,expected_on) values(new.id,new.due_on,new.due_on);
  end if;
 else
  select * into plan from public.card_settlement_plans where entry_id=new.id for update;
  if not found then return new;end if;
  if new.status='cancelled' and old.status<>'cancelled' then
   update public.card_settlement_plans set auto_enabled=false,state='cancelled' where id=plan.id;
   insert into public.card_settlement_events(plan_id,kind,notes) values(plan.id,'cancelled','Parcela cancelada; histórico preservado.');
  elsif new.due_on is distinct from old.due_on then
   update public.card_settlement_plans set expected_on=new.due_on where id=plan.id;
   insert into public.card_settlement_events(plan_id,kind,expected_on,notes) values(plan.id,'reschedule',new.due_on,'Data prevista alterada; data original preservada.');
  end if;
 end if;
 return new;
end;$$;
create trigger track_card_entry after insert or update on public.finance_entries for each row execute function public.track_card_entry();

create function public.track_card_movement() returns trigger language plpgsql security definer set search_path='' as $$
declare plan public.card_settlement_plans;mode text;event_kind text;
begin
 select * into plan from public.card_settlement_plans where entry_id=new.entry_id for update;
 if not found then return new;end if;
 if new.reversal_of is not null then
  select source into mode from public.card_settlement_events where movement_id=new.reversal_of;
  mode:=coalesce(mode,'manual');event_kind:='reversal';
 else
  mode:=case when auth.uid() is null and new.reason='Liquidação automática pela data prevista; não é conciliação bancária.' then 'automatic' else 'manual' end;
  event_kind:=mode;
 end if;
 insert into public.card_settlement_events(plan_id,movement_id,kind,source,notes,expected_on)
 values(plan.id,new.id,event_kind,mode,new.reason,plan.expected_on);
 update public.card_settlement_plans set auto_enabled=false,state=case when new.reversal_of is not null then 'held' else mode end,
  exception_kind=case when new.reversal_of is not null then 'reversal' else null end where id=plan.id;
 return new;
end;$$;
create trigger track_card_movement after insert on public.finance_movements for each row execute function public.track_card_movement();

create function public.process_card_settlements(p_cutoff date default (now() at time zone 'America/Sao_Paulo')::date,p_limit integer default 500) returns integer
language plpgsql security definer set search_path='' as $$
declare candidate record;e public.finance_entries;plan public.card_settlement_plans;done integer:=0;
begin
 -- Privada: somente o owner/Cron. Não usa nem falsifica identidade de administrador.
 if p_cutoff is null or p_cutoff>(now() at time zone 'America/Sao_Paulo')::date or p_limit not between 1 and 1000 then raise exception 'Limite/data de processamento inválidos.';end if;
 for candidate in select p.entry_id,x.visit_id from public.card_settlement_plans p join public.finance_entries x on x.id=p.entry_id where p.auto_enabled and p.state='scheduled' and p.expected_on<=p_cutoff and x.status='pending' order by x.visit_id,p.entry_id limit p_limit loop
  -- Mesma ordem de locks das operações financeiras existentes: visita, parcela, plano.
  perform 1 from public.visits where id=candidate.visit_id for update skip locked;
  if not found then continue;end if;
  select * into e from public.finance_entries where id=candidate.entry_id for update skip locked;
  if not found or e.status<>'pending' then continue;end if;
  select * into plan from public.card_settlement_plans where entry_id=e.id for update skip locked;
  if not found or not plan.auto_enabled or plan.state<>'scheduled' or plan.expected_on>p_cutoff then continue;end if;
  if not exists(select 1 from public.finance_payments where id=e.payment_id and status='active') or not exists(select 1 from public.visits where id=e.visit_id and status='completed') then continue;end if;
  if not exists(select 1 from public.financial_accounts where id=e.account_id and active) then
   update public.card_settlement_plans set auto_enabled=false,state='held',exception_kind='account_inactive' where id=plan.id;
   insert into public.card_settlement_events(plan_id,kind,notes) values(plan.id,'hold','Conta inativa. Revise antes de receber.');continue;
  end if;
  insert into public.finance_movements(entry_id,direction,occurred_on,gross_amount,fee_amount,account_id,method_id,method_name_snapshot,method_kind_snapshot,impact_snapshot,category_name_snapshot,reason)
  values(e.id,e.direction,plan.expected_on,e.gross_amount,e.fee_amount,e.account_id,e.method_id,e.method_name_snapshot,e.method_kind_snapshot,e.impact_snapshot,e.category_name_snapshot,'Liquidação automática pela data prevista; não é conciliação bancária.');
  update public.finance_entries set status='settled',settled_on=plan.expected_on where id=e.id;
  done:=done+1;
 end loop;
 return done;
end;$$;

create function public.card_settlement_details(p_entry_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501';end if;
 return (select jsonb_build_object('plan',to_jsonb(p),'events',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]') from public.card_settlement_events t where t.plan_id=p.id)) from public.card_settlement_plans p where entry_id=p_entry_id);
end;$$;
create function public.card_settlement_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'Período inválido.';end if;
 return jsonb_build_object('expected_net',(select coalesce(sum(e.net_amount),0) from public.card_settlement_plans p join public.finance_entries e on e.id=p.entry_id where e.status='pending' and e.due_on between p_from and p_to),
 'automatic_net',(select coalesce(sum(case m.direction when 'income' then m.net_amount else -m.net_amount end),0) from public.card_settlement_events t join public.finance_movements m on m.id=t.movement_id where t.source='automatic' and m.occurred_on between p_from and p_to),
 'manual_net',(select coalesce(sum(case m.direction when 'income' then m.net_amount else -m.net_amount end),0) from public.card_settlement_events t join public.finance_movements m on m.id=t.movement_id where t.source='manual' and m.occurred_on between p_from and p_to),
 'difference_net',(select coalesce(sum((case when m.direction=e.direction then 1 else -1 end)*(m.net_amount-e.net_amount)),0) from public.card_settlement_events t join public.finance_movements m on m.id=t.movement_id join public.finance_entries e on e.id=m.entry_id where t.source='manual' and m.occurred_on between p_from and p_to),
 'held_count',(select count(*) from public.card_settlement_plans where state='held'),
 'notice','Liquidação pela previsão. Não é conciliação bancária. Valores manuais incluem ajustes e estornos.');
end;$$;

create function public.card_settlement_exception(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<exception_command>>
declare e public.finance_entries;plan public.card_settlement_plans;parent uuid;req public.finance_requests;rid uuid:=(p_data->>'request_id')::uuid;
 action text:=p_data->>'action';reason text:=trim(coalesce(p_data->>'reason',''));dt date:=(p_data->>'date')::date;actual numeric;result jsonb;payment_date date;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501';end if;
 if rid is null or action not in ('hold','not_received','chargeback','reschedule','difference','reverse') or action is null or length(reason) not between 3 and 500 then raise exception 'Selecione uma exceção e informe o motivo.';end if;
 insert into public.finance_requests(id,action,payload_hash) values(rid,'card_settlement_exception',md5(p_data::text)) on conflict(id) do nothing;
 select * into req from public.finance_requests where id=rid for update;
 if req.created_by is distinct from auth.uid() or req.payload_hash<>md5(p_data::text) or req.action<>'card_settlement_exception' then raise exception 'Identificador de operação já utilizado.';end if;
 if req.result is not null then return req.result;end if;
 select visit_id into parent from public.finance_entries where id=(p_data->>'entry_id')::uuid;
 perform 1 from public.visits where id=parent for update;
 select * into e from public.finance_entries where id=(p_data->>'entry_id')::uuid for update;
 select * into plan from public.card_settlement_plans where entry_id=e.id for update;
 if e.id is null or plan.id is null or e.status='cancelled' then raise exception 'Parcela automática disponível não encontrada.';end if;
 if e.version is distinct from (p_data->>'version')::integer or plan.version is distinct from (p_data->>'plan_version')::integer then raise exception 'Outro acesso alterou a parcela. Recarregue.' using errcode='40001';end if;
 select applied_on into payment_date from public.finance_payments where id=e.payment_id and status='active';
 if payment_date is null then raise exception 'Pagamento cancelado.';end if;
 if dt is null or dt<payment_date or (action<>'reschedule' and dt>(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Data inválida para esta operação.';end if;
 if action='reschedule' then
  if e.status<>'pending' or dt<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Altere somente parcelas pendentes, para hoje ou uma data futura.';end if;
  update public.finance_entries set due_on=dt where id=e.id;
  update public.card_settlement_plans set auto_enabled=true,state='scheduled',exception_kind=null where id=plan.id;
  insert into public.card_settlement_events(plan_id,kind,expected_on,notes) values(plan.id,'reschedule',dt,reason);
 else
  if e.status='settled' then perform public.finance_settle(e.id,e.version,dt,true,reason);select * into e from public.finance_entries where id=e.id;end if;
  if action='difference' then
   actual:=public.finance_money(p_data->>'net_amount');
   if actual<=0 then raise exception 'Informe líquido positivo; para ausência de recebimento, use Não recebido.';end if;
   -- Movimento MANUAL efetivo; bruto/taxa/líquido contratados do pagamento e
   -- parcela nunca são reescritos. Mantém a taxa contratada e registra a diferença
   -- do líquido em evento próprio, sem inventar conciliação ou categoria de custo.
   insert into public.finance_movements(entry_id,direction,occurred_on,gross_amount,fee_amount,account_id,method_id,method_name_snapshot,method_kind_snapshot,impact_snapshot,category_name_snapshot,reason)
   values(e.id,e.direction,dt,actual+e.fee_amount,e.fee_amount,e.account_id,e.method_id,e.method_name_snapshot,e.method_kind_snapshot,e.impact_snapshot,e.category_name_snapshot,'Ajuste manual: '||reason);
   update public.finance_entries set status='settled',settled_on=dt where id=e.id;
   insert into public.card_settlement_events(plan_id,kind,source,net_difference,notes) values(plan.id,'difference','manual',actual-e.net_amount,reason);
  else
   update public.card_settlement_plans set auto_enabled=false,state='held',exception_kind=action where id=plan.id;
   insert into public.card_settlement_events(plan_id,kind,notes) values(plan.id,case when action='reverse' then 'hold' else action end,reason);
  end if;
 end if;
 result:=public.card_settlement_details(e.id);
 update public.finance_requests set result=exception_command.result where id=rid;
 return result;
end;$$;
revoke all on function public.track_card_entry(),public.track_card_movement(),public.process_card_settlements(date,integer),public.card_settlement_details(uuid),public.card_settlement_report(date,date),public.card_settlement_exception(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.card_settlement_details(uuid),public.card_settlement_report(date,date),public.card_settlement_exception(jsonb) to authenticated;

-- O job roda NO SERVIDOR, a cada 15 minutos, usando data da clínica. Não depende
-- de navegador/PC ligado. pg_cron ausente aborta TODA a migration, sem aplicação parcial.
do $cron$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is null then raise exception 'Habilite Supabase Cron (pg_cron) antes de aplicar esta migration aprovada.';end if;
 if exists(select 1 from cron.job where jobname='optocom-card-settlements') then raise exception 'Job já existente. Revise antes de substituir.';end if;
 perform cron.schedule('optocom-card-settlements','*/15 * * * *','select public.process_card_settlements();');
end;$cron$;
commit;

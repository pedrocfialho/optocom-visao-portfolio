-- Fase 3: financeiro. Migration separada; aplicação remota exige aprovação.
begin;

create table public.financial_accounts (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120),
 kind text not null check(kind in ('cash','bank')), active boolean not null default true,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.payment_methods (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120),
 kind text not null check(kind in ('cash','pix','debit','credit','other')), active boolean not null default true,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.card_fee_rules (
 id uuid primary key default gen_random_uuid(), method_id uuid not null references public.payment_methods(id),
 acquirer text not null check(length(trim(acquirer)) between 2 and 120), brand text not null check(length(trim(brand)) between 2 and 80),
 installments integer not null check(installments between 1 and 36), percentage numeric(7,4) not null check(percentage between 0 and 100),
 fixed_fee numeric(12,2) not null default 0 check(fixed_fee>=0 and fixed_fee<>'NaN'::numeric),
 settlement_days integer not null check(settlement_days between 0 and 730), interval_days integer not null default 30 check(interval_days between 1 and 365),
 valid_from date not null, active boolean not null default true,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
 unique(method_id,acquirer,brand,installments,valid_from)
);
create table public.finance_categories (
 id uuid primary key default gen_random_uuid(), code text unique, name text not null check(length(trim(name)) between 2 and 120),
 direction text not null check(direction in ('income','expense')), impact text not null check(impact in ('revenue','expense','fee','financing')),
 active boolean not null default true, check((direction='income' and impact in ('revenue','financing')) or (direction='expense' and impact in ('expense','fee','financing'))),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.suppliers (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 160), trade_name text not null default '',
 document text check(document is null or document ~ '^([0-9]{11}|[0-9]{14})$'), phone text not null default '' check(length(phone)<=30),
 email text not null default '' check(length(email)<=254), notes text not null default '' check(length(notes)<=2000), active boolean not null default true,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.recurring_expenses (
 id uuid primary key default gen_random_uuid(), description text not null check(length(trim(description)) between 2 and 250),
 supplier_id uuid references public.suppliers(id), category_id uuid not null references public.finance_categories(id), account_id uuid not null references public.financial_accounts(id), method_id uuid not null references public.payment_methods(id),
 amount numeric(12,2) not null check(amount>0 and amount<>'NaN'::numeric), day_of_month integer not null check(day_of_month between 1 and 31),
 start_month date not null, end_month date, notes text not null default '' check(length(notes)<=2000), active boolean not null default true,
 check(end_month is null or end_month>=start_month),
 check(extract(day from start_month)=1 and (end_month is null or extract(day from end_month)=1)),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.loans (
 id uuid primary key default gen_random_uuid(), institution text not null check(length(trim(institution)) between 2 and 160),
 original_amount numeric(12,2) not null check(original_amount>0 and original_amount<>'NaN'::numeric), received_on date not null,
 installment_count integer not null check(installment_count between 1 and 120), installment_amount numeric(12,2) not null check(installment_amount>0 and installment_amount<>'NaN'::numeric), first_due_on date not null,
 account_id uuid not null references public.financial_accounts(id), method_id uuid not null references public.payment_methods(id),
 notes text not null default '' check(length(notes)<=2000), status text not null default 'active' check(status in ('active','cancelled')), cancel_reason text,
 check(first_due_on>=received_on),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.visit_finance (
 id uuid primary key default gen_random_uuid(), visit_id uuid not null unique references public.visits(id), due_on date not null,
 status text not null default 'pending' check(status in ('pending','partial','completed','void')),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.finance_payments (
 id uuid primary key default gen_random_uuid(), visit_id uuid not null references public.visits(id), method_id uuid not null references public.payment_methods(id), account_id uuid not null references public.financial_accounts(id),
 method_name_snapshot text not null, method_kind_snapshot text not null, applied_on date not null,
 gross_amount numeric(12,2) not null check(gross_amount>0 and gross_amount<>'NaN'::numeric), fee_amount numeric(12,2) not null check(fee_amount>=0 and fee_amount<=gross_amount),
 net_amount numeric(12,2) generated always as (gross_amount-fee_amount) stored,
 installments integer not null check(installments between 1 and 36), fee_rule_id uuid references public.card_fee_rules(id),
 percentage_snapshot numeric(7,4) not null, fixed_fee_snapshot numeric(12,2) not null, acquirer_snapshot text, brand_snapshot text,
 status text not null default 'active' check(status in ('active','cancelled')), cancel_reason text, cancelled_on date, retained_fee numeric(12,2) not null default 0 check(retained_fee>=0 and retained_fee<=fee_amount),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.finance_entries (
 id uuid primary key default gen_random_uuid(), direction text not null check(direction in ('income','expense')),
 origin text not null check(origin in ('manual','visit_payment','loan_receipt','loan_installment','recurrence','retained_fee')),
 visit_id uuid references public.visits(id), payment_id uuid references public.finance_payments(id), supplier_id uuid references public.suppliers(id), loan_id uuid references public.loans(id), recurring_id uuid references public.recurring_expenses(id),
 installment_no integer, recurrence_period date,
 description text not null check(length(trim(description)) between 2 and 250), category_id uuid references public.finance_categories(id),
 category_name_snapshot text not null, impact_snapshot text not null check(impact_snapshot in ('revenue','expense','fee','financing')),
 account_id uuid not null references public.financial_accounts(id), method_id uuid not null references public.payment_methods(id), method_name_snapshot text not null, method_kind_snapshot text not null,
 competence date not null, due_on date not null, settled_on date,
 gross_amount numeric(12,2) not null check(gross_amount>0 and gross_amount<>'NaN'::numeric), fee_amount numeric(12,2) not null default 0 check(fee_amount>=0 and fee_amount<=gross_amount),
 fee_rule_id uuid references public.card_fee_rules(id), percentage_snapshot numeric(7,4) not null default 0, fixed_fee_snapshot numeric(12,2) not null default 0,
 net_amount numeric(12,2) generated always as (gross_amount-fee_amount) stored,
 status text not null default 'pending' check(status in ('pending','settled','cancelled')), notes text not null default '' check(length(notes)<=2000), cancel_reason text,
 check((status='settled' and settled_on is not null) or status<>'settled'), check((origin='visit_payment' and payment_id is not null and visit_id is not null) or origin<>'visit_payment'),
 unique(payment_id,installment_no), unique(loan_id,installment_no), unique(recurring_id,recurrence_period),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create index finance_entries_due_idx on public.finance_entries(status,direction,due_on);
create index finance_entries_supplier_idx on public.finance_entries(supplier_id,competence);
create index finance_payments_visit_idx on public.finance_payments(visit_id);
create table public.finance_movements (
 id uuid primary key default gen_random_uuid(), entry_id uuid not null references public.finance_entries(id), reversal_of uuid unique references public.finance_movements(id),
 direction text not null check(direction in ('income','expense')), occurred_on date not null,
 gross_amount numeric(12,2) not null check(gross_amount>0), fee_amount numeric(12,2) not null check(fee_amount>=0 and fee_amount<=gross_amount), net_amount numeric(12,2) generated always as (gross_amount-fee_amount) stored,
 account_id uuid not null references public.financial_accounts(id), method_id uuid not null references public.payment_methods(id), method_name_snapshot text not null, method_kind_snapshot text not null,
 impact_snapshot text not null, category_name_snapshot text not null, reason text not null default '',
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create index finance_movements_date_idx on public.finance_movements(occurred_on);
create table public.daily_closings (
 id uuid primary key default gen_random_uuid(), closed_on date not null unique, expected_snapshot jsonb not null, actual_by_method jsonb not null,
 difference numeric(12,2) not null, notes text not null default '' check(length(notes)<=2000), needs_review boolean not null default false,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table public.finance_requests (
 id uuid primary key, action text not null, payload_hash text not null, result jsonb,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);

create function public.finance_money(p_value text,p_signed boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
begin
 if p_value is null or p_value !~ (case when p_signed then '^-?[0-9]{1,10}(\.[0-9]{1,2})?$' else '^[0-9]{1,10}(\.[0-9]{1,2})?$' end) then raise exception 'Valor monetário inválido. Use até duas casas decimais.'; end if;
 return p_value::numeric(12,2);
end; $$;

create function public.finance_catalog(p_table text,p_fields jsonb,p_id uuid default null,p_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare allowed text[]; fields jsonb; cols text; setters text; current_version integer; result jsonb;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 allowed:=case p_table
 when 'financial_accounts' then array['name','kind','active'] when 'payment_methods' then array['name','kind','active']
 when 'finance_categories' then array['name','direction','impact','active'] when 'suppliers' then array['name','trade_name','document','phone','email','notes','active']
 when 'recurring_expenses' then array['description','supplier_id','category_id','account_id','method_id','amount','day_of_month','start_month','end_month','notes','active'] end;
 if allowed is null or jsonb_typeof(p_fields)<>'object' then raise exception 'Cadastro financeiro inválido.'; end if;
 select jsonb_object_agg(key,value),string_agg(format('%I',key),','),string_agg(format('%1$I=r.%1$I',key),',') into fields,cols,setters from jsonb_each(p_fields) where key=any(allowed);
 if fields is null then raise exception 'Informe os campos do cadastro.'; end if;
 if p_table='recurring_expenses' then perform public.finance_money(fields->>'amount'); end if;
 if p_table='recurring_expenses' and coalesce((fields->>'active')::boolean,true) then
  if not exists(select 1 from public.finance_categories where id=(fields->>'category_id')::uuid and direction='expense' and active)
   or not exists(select 1 from public.financial_accounts where id=(fields->>'account_id')::uuid and active)
   or not exists(select 1 from public.payment_methods where id=(fields->>'method_id')::uuid and active) then raise exception 'Recorrência exige categoria, conta e forma ativas.'; end if;
 end if;
 if p_id is null then
  execute format('insert into public.%1$I as t(%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) r returning to_jsonb(t)',p_table,cols) into result using fields;
 else
  execute format('select version from public.%I where id=$1 for update',p_table) into current_version using p_id;
  if current_version is null then raise exception 'Cadastro não encontrado.'; end if;
  if current_version is distinct from p_version then raise exception 'Outro computador alterou este cadastro. Recarregue.' using errcode='40001'; end if;
  if p_table='payment_methods' and fields ? 'kind' and exists(select 1 from public.payment_methods where id=p_id and kind is distinct from fields->>'kind')
   and (exists(select 1 from public.finance_entries where method_id=p_id) or exists(select 1 from public.card_fee_rules where method_id=p_id)) then raise exception 'Modalidade já utilizada. Inative e cadastre outra forma para preservar o histórico.'; end if;
  if p_table='finance_categories' and exists(select 1 from public.finance_categories where id=p_id and code in ('loan_income','capital','loan_payment','bank_fees','card_fees')
   and ((fields ? 'impact' and impact is distinct from fields->>'impact') or (fields ? 'direction' and direction is distinct from fields->>'direction'))) then raise exception 'Esta categoria preserva a classificação de empréstimos, aportes ou taxas. Altere somente nome/status.'; end if;
  execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) r where t.id=$2 returning to_jsonb(t)',p_table,setters) into result using fields,p_id;
 end if;
 return result;
end; $$;

create function public.finance_generate_recurring(p_months integer default 3,p_rule_id uuid default null) returns integer language plpgsql security definer set search_path='' as $$
declare r public.recurring_expenses; c public.finance_categories; m public.payment_methods; period date; due date; i integer; count_added integer:=0; added integer;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 if p_months not between 1 and 12 then raise exception 'Gere entre 1 e 12 períodos por vez.'; end if;
 for r in select * from public.recurring_expenses where active and (p_rule_id is null or id=p_rule_id) order by id for update loop
  select * into c from public.finance_categories where id=r.category_id and active and direction='expense';
  select * into m from public.payment_methods where id=r.method_id and active;
  if c.id is null or m.id is null or not exists(select 1 from public.financial_accounts where id=r.account_id and active) then raise exception 'Revise a categoria, forma e conta da recorrência %.',r.description; end if;
  for i in 0..p_months-1 loop
   period:=(date_trunc('month',now() at time zone 'America/Sao_Paulo')+make_interval(months=>i))::date;
   if period<date_trunc('month',r.start_month)::date or (r.end_month is not null and period>date_trunc('month',r.end_month)::date) then continue; end if;
   due:=period+least(r.day_of_month,extract(day from period+interval '1 month - 1 day')::integer)-1;
   insert into public.finance_entries(direction,origin,supplier_id,recurring_id,recurrence_period,description,category_id,category_name_snapshot,impact_snapshot,account_id,method_id,method_name_snapshot,method_kind_snapshot,competence,due_on,gross_amount,notes)
    values('expense','recurrence',r.supplier_id,r.id,period,r.description,c.id,c.name,c.impact,r.account_id,m.id,m.name,m.kind,due,due,r.amount,r.notes)
    on conflict(recurring_id,recurrence_period) do nothing;
   get diagnostics added=row_count; count_added:=count_added+added;
  end loop;
 end loop;
 return count_added;
end; $$;

create function public.finance_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='finance_movements' and tg_op='UPDATE' then raise exception 'Movimentos são imutáveis. Registre um estorno vinculado.'; end if;
 if tg_table_name='card_fee_rules' and tg_op='UPDATE' and (to_jsonb(new)-array['active','version','updated_at','updated_by']) is distinct from (to_jsonb(old)-array['active','version','updated_at','updated_by']) then raise exception 'Taxas históricas são imutáveis. Cadastre uma nova vigência.'; end if;
 if tg_table_name='finance_payments' and tg_op='UPDATE' and (to_jsonb(new)-array['net_amount','status','cancel_reason','cancelled_on','retained_fee','version','updated_at','updated_by']) is distinct from (to_jsonb(old)-array['net_amount','status','cancel_reason','cancelled_on','retained_fee','version','updated_at','updated_by']) then raise exception 'Pagamento imutável. Estorne e registre novamente.'; end if;
 return new;
end; $$;

-- Tabelas financeiras: leitura com RLS; gravações exclusivamente pelas RPC transacionais.
do $$ declare t text; begin
 foreach t in array array['financial_accounts','payment_methods','card_fee_rules','finance_categories','suppliers','recurring_expenses','loans','visit_finance','finance_payments','finance_entries','finance_movements','daily_closings','finance_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy finance_active_admin_read on public.%I for select to authenticated using ((select public.is_active_admin()))',t);
  execute format('create trigger stamp_finance before insert or update on public.%I for each row execute function public.stamp_operational()',t);
  execute format('create trigger audit_finance after insert or update on public.%I for each row execute function public.audit_operational()',t);
  execute format('create trigger prevent_finance_delete before delete on public.%I for each row execute function public.prevent_operational_delete()',t);
 end loop;
end; $$;
create trigger immutable_fee_rule before update on public.card_fee_rules for each row execute function public.finance_guard();
create trigger immutable_payment before update on public.finance_payments for each row execute function public.finance_guard();
create trigger immutable_movement before update on public.finance_movements for each row execute function public.finance_guard();

-- Somente referências de negócio; nenhuma transação, usuário ou taxa fictícia.
insert into public.financial_accounts(name,kind) values ('Caixa','cash'),('Banco','bank');
insert into public.payment_methods(name,kind) values ('Dinheiro','cash'),('PIX','pix'),('Cartão de débito','debit'),('Cartão de crédito','credit'),('Outras formas','other');
insert into public.finance_categories(code,name,direction,impact) values
 ('other_revenue','Outras receitas','income','revenue'),('reimbursement','Reembolsos','income','revenue'),('loan_income','Empréstimos recebidos','income','financing'),('capital','Aportes','income','financing'),
 ('suppliers','Fornecedores','expense','expense'),('rent','Aluguel','expense','expense'),('water','Água','expense','expense'),('electricity','Luz','expense','expense'),('internet','Telefone/internet','expense','expense'),
 ('salaries','Salários','expense','expense'),('accountant','Contador','expense','expense'),('taxes','Impostos','expense','expense'),('bank_fees','Taxas bancárias','expense','fee'),('card_fees','Taxas de cartão','expense','fee'),
 ('materials','Materiais','expense','expense'),('equipment','Equipamentos','expense','expense'),('maintenance','Manutenção','expense','expense'),('cleaning','Limpeza','expense','expense'),('marketing','Marketing','expense','expense'),
 ('loan_payment','Pagamento de empréstimos','expense','financing'),('honoraria','Honorários','expense','expense'),('other_expense','Despesas diversas','expense','expense');

create view public.finance_visit_balances with(security_invoker=true) as
select v.id as visit_id,v.patient_id,p.full_name as patient_name,v.visit_at,v.status as visit_status,v.version as visit_version,v.total_amount,v.consultation_final,
 coalesce(f.version,0) as finance_version,coalesce(f.due_on,(v.visit_at at time zone 'America/Sao_Paulo')::date) as due_on,
 coalesce(sum(pay.gross_amount) filter(where pay.status='active'),0)::numeric(12,2) as allocated_amount,
 (v.total_amount-coalesce(sum(pay.gross_amount) filter(where pay.status='active'),0))::numeric(12,2) as pending_amount,
 case when v.status='cancelled' then 'void' when v.status<>'completed' then 'draft'
 when coalesce(sum(pay.gross_amount) filter(where pay.status='active'),0)=v.total_amount then 'completed'
 when coalesce(sum(pay.gross_amount) filter(where pay.status='active'),0)>0 then 'partial' else 'pending' end as financial_status
from public.visits v join public.patients p on p.id=v.patient_id left join public.visit_finance f on f.visit_id=v.id left join public.finance_payments pay on pay.visit_id=v.id
group by v.id,p.id,f.id;
create view public.finance_entry_overview with(security_invoker=true) as
select e.*,s.name as supplier_name,a.name as account_name,p.full_name as patient_name
from public.finance_entries e join public.financial_accounts a on a.id=e.account_id left join public.suppliers s on s.id=e.supplier_id left join public.visits v on v.id=e.visit_id left join public.patients p on p.id=v.patient_id;
create view public.finance_loan_balances with(security_invoker=true) as
select l.*,count(e.id) filter(where e.origin='loan_installment' and e.status='settled')::integer as paid_installments,
 coalesce(sum(e.gross_amount) filter(where e.origin='loan_installment' and e.status='pending'),0)::numeric(12,2) as remaining_amount,
 case when l.status='cancelled' then 'cancelled' when count(e.id) filter(where e.origin='loan_installment' and e.status='pending')=0 then 'settled' else 'active' end as loan_status
from public.loans l left join public.finance_entries e on e.loan_id=l.id group by l.id;
create view public.finance_receivables with(security_invoker=true) as
select e.id,'entry'::text as source_type,e.visit_id,e.patient_name,e.description,e.gross_amount,e.fee_amount,e.net_amount,e.due_on,e.settled_on,e.status,e.version,e.method_name_snapshot,e.account_name
from public.finance_entry_overview e where e.direction='income'
union all
select b.visit_id,'balance',b.visit_id,b.patient_name,'Saldo do atendimento',b.pending_amount,0,b.pending_amount,b.due_on,null::date,'pending',b.finance_version,null::text,null::text
from public.finance_visit_balances b where b.visit_status='completed' and b.pending_amount>0;
create view public.finance_supplier_balances with(security_invoker=true) as
select s.*,coalesce(sum(e.gross_amount) filter(where e.status='settled'),0)::numeric(12,2) as paid_amount,
 coalesce(sum(e.gross_amount) filter(where e.status='pending'),0)::numeric(12,2) as pending_amount,max(e.settled_on) filter(where e.status='settled') as last_payment
from public.suppliers s left join public.finance_entries e on e.supplier_id=s.id and e.direction='expense' group by s.id;

create function public.finance_visit_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_when='BEFORE' and new.status='cancelled' and old.status is distinct from new.status and exists(select 1 from public.finance_payments where visit_id=new.id and status='active') then raise exception 'Estorne os pagamentos antes de cancelar o atendimento.'; end if;
 if tg_when='AFTER' then
  if new.status='completed' then insert into public.visit_finance(visit_id,due_on,status) values(new.id,(new.visit_at at time zone 'America/Sao_Paulo')::date,case when new.total_amount=0 then 'completed' else 'pending' end) on conflict(visit_id) do nothing; end if;
  if new.status='cancelled' then update public.visit_finance set status='void' where visit_id=new.id; end if;
 end if;
 return new;
end; $$;
create trigger guard_financial_visit_cancel before update on public.visits for each row execute function public.finance_visit_sync();
create trigger sync_financial_visit after insert or update on public.visits for each row execute function public.finance_visit_sync();

create function public.finance_mark_closing() returns trigger language plpgsql security definer set search_path='' as $$
declare n jsonb:=to_jsonb(new); o jsonb; dates date[]:=array[]::date[]; affected date;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 if tg_table_name='visits' then dates:=array[(n->>'visit_at')::timestamptz at time zone 'America/Sao_Paulo',(o->>'visit_at')::timestamptz at time zone 'America/Sao_Paulo'];
 elsif tg_table_name='finance_payments' then dates:=array[(n->>'applied_on')::date,(n->>'cancelled_on')::date,(o->>'applied_on')::date];
 elsif tg_table_name='finance_movements' then dates:=array[(n->>'occurred_on')::date];
 else dates:=array[(n->>'competence')::date,(o->>'competence')::date]; end if;
 -- Quem fecha e quem altera o dia compartilham o mesmo lock. Se a alteração
 -- ocorrer durante o fechamento, ela aguarda e sinaliza revisão após o commit.
 for affected in select distinct d from unnest(dates) d where d is not null order by d loop
  perform pg_advisory_xact_lock(hashtext('optocom-closing-'||affected::text));
 end loop;
 update public.daily_closings set needs_review=true where closed_on=any(dates) and not needs_review;
 return new;
end; $$;
create trigger review_closing_visit after insert or update on public.visits for each row execute function public.finance_mark_closing();
create trigger review_closing_payment after insert or update on public.finance_payments for each row execute function public.finance_mark_closing();
create trigger review_closing_entry after insert or update on public.finance_entries for each row execute function public.finance_mark_closing();
create trigger review_closing_movement after insert on public.finance_movements for each row execute function public.finance_mark_closing();

create function public.finance_settle(p_id uuid,p_version integer,p_date date,p_reverse boolean default false,p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.finance_entries; m public.finance_movements; parent uuid;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 if p_date is null or p_date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe uma data de liquidação válida, sem data futura.'; end if;
 select visit_id into parent from public.finance_entries where id=p_id;
 if parent is not null then perform 1 from public.visits where id=parent for update; end if;
 select * into e from public.finance_entries where id=p_id for update;
 if not found then raise exception 'Lançamento não encontrado.'; end if;
 if e.version is distinct from p_version then raise exception 'Outro computador alterou este lançamento. Recarregue.' using errcode='40001'; end if;
 if p_reverse then
  if e.status<>'settled' then raise exception 'Somente uma liquidação existente pode ser estornada.'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Informe o motivo do estorno.'; end if;
  select * into m from public.finance_movements x where x.entry_id=e.id and x.reversal_of is null and not exists(select 1 from public.finance_movements r where r.reversal_of=x.id) order by x.created_at desc limit 1 for update;
  if not found or p_date<m.occurred_on then raise exception 'Estorno inválido ou anterior à liquidação.'; end if;
  insert into public.finance_movements(entry_id,reversal_of,direction,occurred_on,gross_amount,fee_amount,account_id,method_id,method_name_snapshot,method_kind_snapshot,impact_snapshot,category_name_snapshot,reason)
   values(e.id,m.id,case when m.direction='income' then 'expense' else 'income' end,p_date,m.gross_amount,m.fee_amount,m.account_id,m.method_id,m.method_name_snapshot,m.method_kind_snapshot,m.impact_snapshot,m.category_name_snapshot,trim(p_reason));
  update public.finance_entries set status='pending',settled_on=null where id=e.id returning * into e;
 else
  if e.status<>'pending' then raise exception 'Lançamento já liquidado ou cancelado.'; end if;
  if not exists(select 1 from public.financial_accounts where id=e.account_id and active) or (e.origin<>'visit_payment' and not exists(select 1 from public.payment_methods where id=e.method_id and active)) then raise exception 'Conta ou forma de pagamento inativa. Revise o lançamento antes de liquidar.'; end if;
  insert into public.finance_movements(entry_id,direction,occurred_on,gross_amount,fee_amount,account_id,method_id,method_name_snapshot,method_kind_snapshot,impact_snapshot,category_name_snapshot)
   values(e.id,e.direction,p_date,e.gross_amount,e.fee_amount,e.account_id,e.method_id,e.method_name_snapshot,e.method_kind_snapshot,e.impact_snapshot,e.category_name_snapshot);
  update public.finance_entries set status='settled',settled_on=p_date where id=e.id returning * into e;
 end if;
 return to_jsonb(e);
end; $$;

create function public.finance_post_visit(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.visits; f public.visit_finance; item jsonb; method public.payment_methods; rule public.card_fee_rules; pay public.finance_payments;
 e public.finance_entries; gross numeric; fee numeric; registered numeric; added numeric:=0; dt date; parts integer; i integer; gc bigint; fc bigint; expected integer;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 select * into v from public.visits where id=(p_data->>'visit_id')::uuid for update;
 if not found or v.status<>'completed' then raise exception 'Conclua o atendimento antes de registrar seu recebimento.'; end if;
 if v.version is distinct from (p_data->>'visit_version')::integer then raise exception 'Outro computador alterou o atendimento. Recarregue.' using errcode='40001'; end if;
 select * into f from public.visit_finance where visit_id=v.id for update;
 expected:=coalesce(f.version,0);
 if expected is distinct from (p_data->>'finance_version')::integer then raise exception 'Outro computador alterou o financeiro. Recarregue.' using errcode='40001'; end if;
 if f.id is null then insert into public.visit_finance(visit_id,due_on) values(v.id,(v.visit_at at time zone 'America/Sao_Paulo')::date) returning * into f; end if;
 dt:=(p_data->>'applied_on')::date;
 if dt is null or dt>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe uma data válida para os pagamentos.'; end if;
 if jsonb_typeof(p_data->'payments') is distinct from 'array' then raise exception 'Informe a lista de formas de pagamento.'; end if;
 if jsonb_array_length(p_data->'payments')>20 then raise exception 'Informe até 20 formas de pagamento.'; end if;
 select coalesce(sum(gross_amount),0) into registered from public.finance_payments where visit_id=v.id and status='active';
 for item in select * from jsonb_array_elements(p_data->'payments') loop
  gross:=public.finance_money(item->>'gross_amount'); if gross<=0 then raise exception 'Valor do pagamento deve ser positivo.'; end if;
  added:=added+gross;
  if registered+added>v.total_amount then raise exception 'A soma dos pagamentos ultrapassa o total do atendimento.'; end if;
  select * into method from public.payment_methods where id=(item->>'method_id')::uuid and active;
  if not found or not exists(select 1 from public.financial_accounts where id=(item->>'account_id')::uuid and active) then raise exception 'Selecione forma e conta ativas.'; end if;
  parts:=coalesce((item->>'installments')::integer,1); rule:=null; fee:=0;
  if method.kind in ('debit','credit') then
   select * into rule from public.card_fee_rules where id=(item->>'fee_rule_id')::uuid and active and method_id=method.id and installments=parts and valid_from<=dt;
   if not found or (method.kind='debit' and parts<>1) then raise exception 'Configure e selecione uma taxa de cartão vigente para a modalidade e parcelas.'; end if;
   if exists(select 1 from public.card_fee_rules r where r.method_id=method.id and r.acquirer=rule.acquirer and r.brand=rule.brand and r.installments=parts and r.active and r.valid_from<=dt and r.valid_from>rule.valid_from) then raise exception 'Existe uma taxa mais recente para esta data. Recarregue as taxas.'; end if;
   fee:=round(gross*rule.percentage/100+rule.fixed_fee,2);
  elsif parts<>1 then raise exception 'Parcelas são exclusivas do cartão de crédito.';
  end if;
  if fee>gross or parts not between 1 and 36 or gross*100<parts then raise exception 'Taxa ou quantidade de parcelas incompatível com o valor.'; end if;
  if parts>1 and coalesce((item->>'received_now')::boolean,false) then raise exception 'Liquide cada parcela na data efetiva, pela tela A receber.'; end if;
  insert into public.finance_payments(visit_id,method_id,account_id,method_name_snapshot,method_kind_snapshot,applied_on,gross_amount,fee_amount,installments,fee_rule_id,percentage_snapshot,fixed_fee_snapshot,acquirer_snapshot,brand_snapshot)
   values(v.id,method.id,(item->>'account_id')::uuid,method.name,method.kind,dt,gross,fee,parts,rule.id,coalesce(rule.percentage,0),coalesce(rule.fixed_fee,0),rule.acquirer,rule.brand) returning * into pay;
  gc:=(gross*100)::bigint;fc:=(fee*100)::bigint;
  for i in 1..parts loop
   insert into public.finance_entries(direction,origin,visit_id,payment_id,installment_no,description,category_name_snapshot,impact_snapshot,account_id,method_id,method_name_snapshot,method_kind_snapshot,competence,due_on,gross_amount,fee_amount)
    values('income','visit_payment',v.id,pay.id,i,'Atendimento · parcela '||i||'/'||parts,'Consulta e exames','revenue',pay.account_id,method.id,method.name,method.kind,dt,
      dt+coalesce(rule.settlement_days,0)+(i-1)*coalesce(rule.interval_days,30),
      (gc/parts+case when i<=gc%parts then 1 else 0 end)::numeric/100,(fc/parts+case when i<=fc%parts then 1 else 0 end)::numeric/100) returning * into e;
   if coalesce((item->>'received_now')::boolean,false) then perform public.finance_settle(e.id,e.version,dt); end if;
  end loop;
 end loop;
 if coalesce((p_data->>'complete_financial')::boolean,false) and registered+added<>v.total_amount then raise exception 'Para concluir o financeiro, a soma deve ser igual ao total do atendimento. Use recebimento parcial ou pendente.'; end if;
 update public.visit_finance set status=case when registered+added=v.total_amount then 'completed' when registered+added>0 then 'partial' else 'pending' end,
  due_on=coalesce(nullif(p_data->>'balance_due_on','')::date,due_on) where id=f.id returning * into f;
 return (select to_jsonb(b) from public.finance_visit_balances b where b.visit_id=v.id);
end; $$;

create function public.finance_command(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<cmd>>
declare action text:=p_data->>'action'; rid uuid:=(p_data->>'request_id')::uuid; req public.finance_requests; result jsonb;
 c public.finance_categories; m public.payment_methods; e public.finance_entries; item public.finance_entries; pay public.finance_payments; l public.loans; f public.visit_finance;
 r public.card_fee_rules; closing public.daily_closings; v jsonb; payload jsonb; dt date; amount numeric; retained numeric; i integer; n integer; actual jsonb; difference numeric:=0; one jsonb; has_difference boolean:=false;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 if rid is null or action is null then raise exception 'Identificador da operação obrigatório.'; end if;
 insert into public.finance_requests(id,action,payload_hash) values(rid,action,md5(p_data::text)) on conflict(id) do nothing;
 select * into req from public.finance_requests where id=rid for update;
 if req.created_by is distinct from auth.uid() or req.action<>action or req.payload_hash<>md5(p_data::text) then raise exception 'Identificador já usado em outra operação.'; end if;
 if req.result is not null then return req.result; end if;
 case action
 when 'save_catalog' then
  result:=public.finance_catalog(p_data->>'table',p_data->'fields',nullif(p_data->>'id','')::uuid,(p_data->>'version')::integer);
 when 'save_rate' then
  payload:=p_data->'fields';
  select * into m from public.payment_methods where id=(payload->>'method_id')::uuid and active and kind in ('debit','credit');
  if not found or (m.kind='debit' and (payload->>'installments')::integer<>1) then raise exception 'Selecione uma modalidade de cartão ativa e parcelas válidas.'; end if;
  if coalesce(payload->>'percentage','') !~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' then raise exception 'Taxa percentual inválida.'; end if;
  insert into public.card_fee_rules(method_id,acquirer,brand,installments,percentage,fixed_fee,settlement_days,interval_days,valid_from)
   values(m.id,trim(payload->>'acquirer'),trim(payload->>'brand'),(payload->>'installments')::integer,(payload->>'percentage')::numeric,public.finance_money(coalesce(payload->>'fixed_fee','0')),(payload->>'settlement_days')::integer,coalesce((payload->>'interval_days')::integer,30),(payload->>'valid_from')::date) returning * into r;
  result:=to_jsonb(r);
 when 'toggle_rate' then
  select * into r from public.card_fee_rules where id=(p_data->>'id')::uuid for update;
  if not found or r.version is distinct from (p_data->>'version')::integer then raise exception 'Taxa alterada por outro computador. Recarregue.' using errcode='40001'; end if;
  update public.card_fee_rules set active=(p_data->>'active')::boolean where id=r.id returning * into r;result:=to_jsonb(r);
 when 'register_visit' then result:=public.finance_post_visit(p_data);
 when 'finish_visit' then
  v:=public.save_visit((p_data->'visit_data')||jsonb_build_object('complete',true));
  select * into f from public.visit_finance where visit_id=(v->>'id')::uuid;
  result:=public.finance_post_visit(p_data||jsonb_build_object('visit_id',v->>'id','visit_version',(v->>'version')::integer,'finance_version',f.version));
  result:=result||jsonb_build_object('visit',v);
 when 'save_entry' then
  payload:=p_data->'fields';
  if nullif(p_data->>'id','') is not null then
   select * into e from public.finance_entries where id=(p_data->>'id')::uuid for update;
   if not found or e.version is distinct from (p_data->>'version')::integer then raise exception 'Outro computador alterou este lançamento. Recarregue.' using errcode='40001'; end if;
   if e.origin not in ('manual','recurrence') or e.status<>'pending' then raise exception 'Somente lançamentos manuais ou recorrentes pendentes podem ser editados. Estorne liquidações antes.'; end if;
  end if;
  select * into c from public.finance_categories where id=(payload->>'category_id')::uuid and active;
  select * into m from public.payment_methods where id=(payload->>'method_id')::uuid and active;
  if c.id is null or m.id is null or not exists(select 1 from public.financial_accounts where id=(payload->>'account_id')::uuid and active) then raise exception 'Selecione categoria, forma e conta ativas.'; end if;
  if c.direction is distinct from coalesce(e.direction,payload->>'direction') then raise exception 'Categoria incompatível com entrada/saída.'; end if;
  if nullif(payload->>'supplier_id','') is not null and not exists(select 1 from public.suppliers where id=(payload->>'supplier_id')::uuid and active) then raise exception 'Selecione fornecedor ativo.'; end if;
  amount:=public.finance_money(payload->>'gross_amount');r:=null;retained:=0;
  if c.direction='income' and m.kind in ('debit','credit') then
   select * into r from public.card_fee_rules where id=(payload->>'fee_rule_id')::uuid and method_id=m.id and installments=1 and active and valid_from<=(payload->>'competence')::date;
   if not found or exists(select 1 from public.card_fee_rules x where x.method_id=m.id and x.acquirer=r.acquirer and x.brand=r.brand and x.installments=1 and x.active and x.valid_from<=(payload->>'competence')::date and x.valid_from>r.valid_from) then raise exception 'Entrada manual com cartão exige taxa vigente de parcela única.'; end if;
   retained:=round(amount*r.percentage/100+r.fixed_fee,2);
   if retained>amount then raise exception 'Taxa ultrapassa o valor da entrada.'; end if;
  end if;
  if e.id is null then
   insert into public.finance_entries(direction,origin,description,category_id,category_name_snapshot,impact_snapshot,supplier_id,account_id,method_id,method_name_snapshot,method_kind_snapshot,competence,due_on,gross_amount,fee_amount,fee_rule_id,percentage_snapshot,fixed_fee_snapshot,notes)
    values(c.direction,'manual',trim(payload->>'description'),c.id,c.name,c.impact,nullif(payload->>'supplier_id','')::uuid,(payload->>'account_id')::uuid,m.id,m.name,m.kind,(payload->>'competence')::date,case when r.id is not null then (payload->>'competence')::date+r.settlement_days else (payload->>'due_on')::date end,amount,retained,r.id,coalesce(r.percentage,0),coalesce(r.fixed_fee,0),coalesce(payload->>'notes','')) returning * into e;
  else
   update public.finance_entries set description=trim(payload->>'description'),category_id=c.id,category_name_snapshot=c.name,impact_snapshot=c.impact,supplier_id=nullif(payload->>'supplier_id','')::uuid,
    account_id=(payload->>'account_id')::uuid,method_id=m.id,method_name_snapshot=m.name,method_kind_snapshot=m.kind,competence=(payload->>'competence')::date,due_on=case when r.id is not null then (payload->>'competence')::date+r.settlement_days else (payload->>'due_on')::date end,gross_amount=amount,fee_amount=retained,fee_rule_id=r.id,percentage_snapshot=coalesce(r.percentage,0),fixed_fee_snapshot=coalesce(r.fixed_fee,0),notes=coalesce(payload->>'notes','') where id=e.id returning * into e;
  end if;
  if coalesce((p_data->>'settle_now')::boolean,false) then result:=public.finance_settle(e.id,e.version,(p_data->>'settled_on')::date); else result:=to_jsonb(e); end if;
 when 'settle_entry' then
  select * into e from public.finance_entries where id=(p_data->>'id')::uuid;
  if e.visit_id is not null then perform 1 from public.visits where id=e.visit_id for update; end if;
  select * into e from public.finance_entries where id=(p_data->>'id')::uuid for update;
  if not found or e.version is distinct from (p_data->>'version')::integer then raise exception 'Outro computador alterou este lançamento. Recarregue.' using errcode='40001'; end if;
  if e.status<>'pending' then raise exception 'Lançamento já liquidado ou cancelado.'; end if;
  if nullif(p_data->>'method_id','') is not null and (p_data->>'method_id')::uuid<>e.method_id then
   if e.origin='visit_payment' then raise exception 'Para trocar a forma do atendimento, estorne o pagamento e registre novamente.'; end if;
   select * into m from public.payment_methods where id=(p_data->>'method_id')::uuid and active;
   if not found then raise exception 'Forma de pagamento inativa.'; end if;
   if e.direction='income' and (e.method_kind_snapshot in ('credit','debit') or m.kind in ('credit','debit')) then raise exception 'Para trocar uma entrada de/para cartão, edite o lançamento pendente e selecione a taxa antes de liquidar.'; end if;
   update public.finance_entries set method_id=m.id,method_name_snapshot=m.name,method_kind_snapshot=m.kind where id=e.id returning * into e;
  end if;
  if nullif(p_data->>'account_id','') is not null and (p_data->>'account_id')::uuid<>e.account_id then
   if not exists(select 1 from public.financial_accounts where id=(p_data->>'account_id')::uuid and active) then raise exception 'Conta inativa.'; end if;
   update public.finance_entries set account_id=(p_data->>'account_id')::uuid where id=e.id returning * into e;
  end if;
  result:=public.finance_settle(e.id,e.version,(p_data->>'date')::date);
 when 'reverse_entry' then result:=public.finance_settle((p_data->>'id')::uuid,(p_data->>'version')::integer,(p_data->>'date')::date,true,p_data->>'reason');
 when 'cancel_entry' then
  select * into e from public.finance_entries where id=(p_data->>'id')::uuid;
  if e.visit_id is not null then perform 1 from public.visits where id=e.visit_id for update; end if;
  select * into e from public.finance_entries where id=(p_data->>'id')::uuid for update;
  if not found or e.version is distinct from (p_data->>'version')::integer then raise exception 'Outro computador alterou este lançamento. Recarregue.' using errcode='40001'; end if;
  if e.origin not in ('manual','recurrence','retained_fee') or e.status='cancelled' then raise exception 'Cancele o pagamento ou empréstimo de origem, preservando seus vínculos.'; end if;
  if length(trim(coalesce(p_data->>'reason','')))<3 then raise exception 'Informe o motivo do cancelamento.'; end if;
  if e.status='settled' then perform public.finance_settle(e.id,e.version,(p_data->>'date')::date,true,p_data->>'reason'); end if;
  update public.finance_entries set status='cancelled',cancel_reason=trim(p_data->>'reason') where id=e.id returning * into e;result:=to_jsonb(e);
 when 'cancel_payment' then
  select * into pay from public.finance_payments where id=(p_data->>'id')::uuid;
  perform 1 from public.visits where id=pay.visit_id for update;
  select * into pay from public.finance_payments where id=(p_data->>'id')::uuid for update;
  if not found or pay.version is distinct from (p_data->>'version')::integer then raise exception 'Pagamento alterado por outro computador. Recarregue.' using errcode='40001'; end if;
  dt:=(p_data->>'date')::date;retained:=public.finance_money(coalesce(p_data->>'retained_fee','0'));
  if pay.status<>'active' or length(trim(coalesce(p_data->>'reason','')))<3 or dt is null or dt<pay.applied_on or dt>(now() at time zone 'America/Sao_Paulo')::date or retained>pay.fee_amount then raise exception 'Revise data, motivo e taxa efetivamente retida no estorno.'; end if;
  for item in select * from public.finance_entries where payment_id=pay.id order by id for update loop
   if item.status='settled' then perform public.finance_settle(item.id,item.version,dt,true,p_data->>'reason'); end if;
   update public.finance_entries set status='cancelled',cancel_reason=trim(p_data->>'reason') where id=item.id;
  end loop;
  update public.finance_payments set status='cancelled',cancelled_on=dt,retained_fee=retained,cancel_reason=trim(p_data->>'reason') where id=pay.id;
  if retained>0 then
   select * into c from public.finance_categories where code='card_fees';
   insert into public.finance_entries(direction,origin,description,category_id,category_name_snapshot,impact_snapshot,account_id,method_id,method_name_snapshot,method_kind_snapshot,competence,due_on,gross_amount,notes)
    values('expense','retained_fee','Taxa efetivamente retida no estorno',c.id,c.name,'fee',pay.account_id,pay.method_id,pay.method_name_snapshot,pay.method_kind_snapshot,dt,dt,retained,'Pagamento '||pay.id||': '||(p_data->>'reason')) returning * into e;
   -- Valor explicitamente informado como já debitado pela operadora; sem assumir devolução de taxa.
   insert into public.finance_movements(entry_id,direction,occurred_on,gross_amount,fee_amount,account_id,method_id,method_name_snapshot,method_kind_snapshot,impact_snapshot,category_name_snapshot)
    values(e.id,'expense',dt,retained,0,e.account_id,e.method_id,e.method_name_snapshot,e.method_kind_snapshot,'fee',e.category_name_snapshot);
   update public.finance_entries set status='settled',settled_on=dt where id=e.id;
  end if;
  select coalesce(sum(gross_amount),0) into amount from public.finance_payments where visit_id=pay.visit_id and status='active';
  update public.visit_finance set status=case when amount=0 then 'pending' else 'partial' end where visit_id=pay.visit_id;
  result:=jsonb_build_object('visit_id',pay.visit_id,'status','cancelled');
 when 'save_recurring' then
  result:=public.finance_catalog('recurring_expenses',p_data->'fields',nullif(p_data->>'id','')::uuid,(p_data->>'version')::integer);
  perform public.finance_generate_recurring(3,(result->>'id')::uuid);
 when 'generate_recurring' then result:=jsonb_build_object('generated',public.finance_generate_recurring(coalesce((p_data->>'months')::integer,3)));
 when 'create_loan' then
  payload:=p_data->'fields';
  select * into m from public.payment_methods where id=(payload->>'method_id')::uuid and active;
  if m.id is null or not exists(select 1 from public.financial_accounts where id=(payload->>'account_id')::uuid and active) then raise exception 'Selecione forma e conta ativas.'; end if;
  dt:=(payload->>'received_on')::date;
  if dt is null or dt>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe a data efetiva do empréstimo recebido.'; end if;
  insert into public.loans(institution,original_amount,received_on,installment_count,installment_amount,first_due_on,account_id,method_id,notes)
   values(trim(payload->>'institution'),public.finance_money(payload->>'original_amount'),dt,(payload->>'installment_count')::integer,public.finance_money(payload->>'installment_amount'),(payload->>'first_due_on')::date,(payload->>'account_id')::uuid,m.id,coalesce(payload->>'notes','')) returning * into l;
  select * into c from public.finance_categories where code='loan_income';
  insert into public.finance_entries(direction,origin,loan_id,description,category_id,category_name_snapshot,impact_snapshot,account_id,method_id,method_name_snapshot,method_kind_snapshot,competence,due_on,gross_amount)
   values('income','loan_receipt',l.id,'Empréstimo recebido: '||l.institution,c.id,c.name,'financing',l.account_id,m.id,m.name,m.kind,dt,dt,l.original_amount) returning * into e;
  perform public.finance_settle(e.id,e.version,dt);
  select * into c from public.finance_categories where code='loan_payment';
  for i in 1..l.installment_count loop
   dt:=(l.first_due_on+make_interval(months=>i-1))::date;
   insert into public.finance_entries(direction,origin,loan_id,installment_no,description,category_id,category_name_snapshot,impact_snapshot,account_id,method_id,method_name_snapshot,method_kind_snapshot,competence,due_on,gross_amount)
    values('expense','loan_installment',l.id,i,'Empréstimo '||l.institution||' · '||i||'/'||l.installment_count,c.id,c.name,'financing',l.account_id,m.id,m.name,m.kind,dt,dt,l.installment_amount);
  end loop;result:=to_jsonb(l);
 when 'cancel_loan' then
  select * into l from public.loans where id=(p_data->>'id')::uuid for update;
  if not found or l.version is distinct from (p_data->>'version')::integer then raise exception 'Empréstimo alterado por outro computador. Recarregue.' using errcode='40001'; end if;
  if l.status='cancelled' or length(trim(coalesce(p_data->>'reason','')))<3 then raise exception 'Informe motivo de cancelamento/devolução.'; end if;
  if exists(select 1 from public.finance_entries where loan_id=l.id and origin='loan_installment' and status='settled') then raise exception 'Existem parcelas pagas. Estorne suas liquidações antes de cancelar/devolver o empréstimo.'; end if;
  for item in select * from public.finance_entries where loan_id=l.id order by id for update loop
   if item.status='settled' then perform public.finance_settle(item.id,item.version,(p_data->>'date')::date,true,p_data->>'reason'); end if;
   update public.finance_entries set status='cancelled',cancel_reason=trim(p_data->>'reason') where id=item.id;
  end loop;
  update public.loans set status='cancelled',cancel_reason=trim(p_data->>'reason') where id=l.id returning * into l;result:=to_jsonb(l);
 when 'close_daily' then
  dt:=(p_data->>'date')::date;
  if dt is null or dt>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Fechamento exige um dia válido, sem data futura.'; end if;
  -- Serializa fechamentos do mesmo dia, inclusive a primeira gravação.
  perform pg_advisory_xact_lock(hashtext('optocom-closing-'||dt::text));
  select * into closing from public.daily_closings where closed_on=dt for update;
  if coalesce(closing.version,0) is distinct from (p_data->>'version')::integer then raise exception 'Fechamento alterado por outro computador. Recarregue.' using errcode='40001'; end if;
  v:=public.finance_report(dt,dt);actual:=p_data->'actual_by_method';
  if jsonb_typeof(actual)<>'object' then raise exception 'Informe os valores conferidos.'; end if;
  for one in select * from jsonb_array_elements(v->'by_method') loop
   if not (actual ? (one->>'id')) then raise exception 'Informe a conferência de todas as formas movimentadas.'; end if;
   amount:=public.finance_money(actual->>(one->>'id'),true)-(one->>'net')::numeric;
   difference:=difference+amount;if amount<>0 then has_difference:=true; end if;
  end loop;
  for one in select jsonb_build_object('key',key,'value',value) from jsonb_each_text(actual) loop
   if not exists(select 1 from public.payment_methods where id=(one->>'key')::uuid) then raise exception 'Forma inválida na conferência.'; end if;
   if not exists(select 1 from jsonb_array_elements(v->'by_method') x where x->>'id'=one->>'key') then amount:=public.finance_money(one->>'value',true);difference:=difference+amount;if amount<>0 then has_difference:=true;end if; end if;
  end loop;
  if (has_difference or closing.id is not null) and length(trim(coalesce(p_data->>'notes','')))<3 then raise exception 'Justifique a divergência por forma ou revisão do fechamento.'; end if;
  if closing.id is null then
   insert into public.daily_closings(closed_on,expected_snapshot,actual_by_method,difference,notes) values(dt,v,actual,difference,coalesce(p_data->>'notes','')) returning * into closing;
  else update public.daily_closings set expected_snapshot=v,actual_by_method=actual,difference=cmd.difference,notes=coalesce(p_data->>'notes',''),needs_review=false where id=closing.id returning * into closing; end if;
  result:=to_jsonb(closing);
 else raise exception 'Operação financeira desconhecida.';
 end case;
 update public.finance_requests set result=cmd.result where id=rid;
 return result;
end; $$;

create function public.finance_catalogs() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 return jsonb_build_object(
 'accounts',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.financial_accounts t),
 'methods',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.payment_methods t),
 'categories',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.finance_categories t),
 'suppliers',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from public.suppliers t),
 'rates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.valid_from desc,t.created_at desc),'[]') from public.card_fee_rules t),
 'recurring',(select coalesce(jsonb_agg(to_jsonb(t) order by t.description),'[]') from public.recurring_expenses t));
end; $$;

create function public.finance_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if not public.is_active_admin() then raise exception 'Acesso restrito a administrador ativo.' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'Informe um período válido de até dez anos.'; end if;
 with visits_in_period as (
  select * from public.visits where status='completed' and (visit_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
 ), entries_in_period as (
  select * from public.finance_entries where status<>'cancelled' and competence between p_from and p_to
 ), moves as (
  select * from public.finance_movements where occurred_on between p_from and p_to
 ), earned as (
  select coalesce(sum(consultation_final),0) as consultations_revenue,coalesce(sum(total_amount-consultation_final),0) as exams_revenue,coalesce(sum(total_amount),0) as visits_revenue,count(*) as consultations,count(distinct patient_id) as patients from visits_in_period
 ), entries_total as (
  select coalesce(sum(gross_amount) filter(where direction='income' and impact_snapshot='revenue' and origin='manual'),0) as other_revenue,
   coalesce(sum(gross_amount) filter(where direction='expense' and impact_snapshot='expense'),0) as expenses,
   coalesce(sum(gross_amount) filter(where impact_snapshot='fee'),0)+coalesce(sum(fee_amount) filter(where origin='manual' and direction='income'),0) as manual_fees from entries_in_period
 ), fees as (
  select coalesce(sum(fee_amount) filter(where applied_on between p_from and p_to),0)-coalesce(sum(fee_amount) filter(where cancelled_on between p_from and p_to),0) as card_fees from public.finance_payments
 ), cash as (
  select coalesce(sum(case when direction='income' then net_amount else -net_amount end),0) as variation,
   coalesce(sum(case when direction='income' then gross_amount else -gross_amount end) filter(where impact_snapshot='revenue'),0) as revenue_gross,
   coalesce(sum(case when direction='expense' then gross_amount else -gross_amount end) filter(where impact_snapshot='expense'),0) as expenses_paid,
   coalesce(sum(case when reversal_of is null then fee_amount else -fee_amount end),0)+coalesce(sum(case when direction='expense' then gross_amount else -gross_amount end) filter(where impact_snapshot='fee'),0) as fees_paid,
   coalesce(sum(case when direction='income' then net_amount else -net_amount end) filter(where impact_snapshot='financing'),0) as financing,
   coalesce(sum(net_amount) filter(where direction='income'),0) as cash_in,
   coalesce(sum(net_amount) filter(where direction='expense'),0) as cash_out from moves
 )
 select jsonb_build_object('from',p_from,'to',p_to,'summary',jsonb_build_object(
  'scheduled',(select count(*) from public.appointments where status in ('scheduled','confirmed') and (start_at at time zone 'America/Sao_Paulo')::date between p_from and p_to),
  'consultations',earned.consultations,'patients',earned.patients,'exams',(select count(*) from public.visit_exams x join visits_in_period v on v.id=x.visit_id where x.active),
  'consultations_revenue',earned.consultations_revenue,'exams_revenue',earned.exams_revenue,'other_revenue',entries_total.other_revenue,
  'gross_revenue',earned.visits_revenue+entries_total.other_revenue,'fees',fees.card_fees+entries_total.manual_fees,
  'net_revenue',earned.visits_revenue+entries_total.other_revenue-fees.card_fees-entries_total.manual_fees,
  'expenses',entries_total.expenses,'result',earned.visits_revenue+entries_total.other_revenue-fees.card_fees-entries_total.manual_fees-entries_total.expenses,
  'average_ticket',case when earned.consultations=0 then 0 else round(earned.visits_revenue/earned.consultations,2) end,
  'receivable',(select coalesce(sum(net_amount),0) from public.finance_receivables where status='pending'),
  'payable_7',(select coalesce(sum(gross_amount),0) from public.finance_entries where direction='expense' and status='pending' and due_on between today and today+7),
  'payable_overdue',(select coalesce(sum(gross_amount),0) from public.finance_entries where direction='expense' and status='pending' and due_on<today),
  'cash_variation',cash.variation,'cash_in',cash.cash_in,'cash_out',cash.cash_out,'cash_revenue_gross',cash.revenue_gross,'expenses_paid',cash.expenses_paid,'fees_paid',cash.fees_paid,
  'cash_operating_result',cash.revenue_gross-cash.expenses_paid-cash.fees_paid,'financing_cash',cash.financing,
  'paid_count',(select count(*) from public.finance_entries where status='settled' and due_on between p_from and p_to),
  'pending_count',(select count(*) from public.finance_entries where status='pending' and due_on between p_from and p_to)),
 'by_method',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from (
  select method_id as id,max(method_name_snapshot) as name,max(method_kind_snapshot) as kind,
   sum(case when direction='income' then gross_amount else -gross_amount end) as gross,
   sum(case when reversal_of is null then fee_amount else -fee_amount end) as fees,
   sum(case when direction='income' then net_amount else -net_amount end) as net
  from moves group by method_id) t),
 'by_category',(select coalesce(jsonb_agg(to_jsonb(t) order by t.category),'[]') from (
  select category_name_snapshot as category,impact_snapshot as impact,direction,sum(gross_amount) as amount from entries_in_period where origin<>'visit_payment' group by category_name_snapshot,impact_snapshot,direction) t),
 'by_account',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from (
  select a.id,a.name,sum(case when m.direction='income' then m.net_amount else -m.net_amount end) as net from moves m join public.financial_accounts a on a.id=m.account_id group by a.id) t))
 into result from earned cross join entries_total cross join fees cross join cash;
 return result;
end; $$;

-- Views invoker: preservam as mesmas políticas das tabelas-base.
revoke all on public.finance_visit_balances,public.finance_entry_overview,public.finance_loan_balances,public.finance_receivables,public.finance_supplier_balances from public,anon,authenticated,service_role;
grant select on public.finance_visit_balances,public.finance_entry_overview,public.finance_loan_balances,public.finance_receivables,public.finance_supplier_balances to authenticated;

revoke all on function public.finance_money(text,boolean),public.finance_guard(),public.finance_catalog(text,jsonb,uuid,integer),public.finance_generate_recurring(integer,uuid),public.finance_visit_sync(),public.finance_mark_closing(),public.finance_settle(uuid,integer,date,boolean,text),public.finance_post_visit(jsonb),public.finance_command(jsonb),public.finance_catalogs(),public.finance_report(date,date) from public,anon,authenticated,service_role;
grant execute on function public.finance_command(jsonb),public.finance_catalogs(),public.finance_report(date,date) to authenticated;

comment on table public.finance_movements is 'Liquidações e movimentos inversos imutáveis. Não apagar ou reescrever histórico de caixa.';
comment on table public.finance_payments is 'Alocação do atendimento com taxa vigente congelada. Receita do atendimento é contada uma vez, a partir de visits.';
comment on table public.finance_entries is 'Obrigações e parcelas. Alterações de status não removem os movimentos efetivos já registrados.';
comment on table public.finance_requests is 'Idempotência por usuário, conteúdo e identificador da operação.';
commit;

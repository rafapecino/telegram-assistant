-- Single-owner workspace. All access continues through the authorized Edge Functions.
alter table public.tasks add column due_on date,
 add column duration_minutes integer check (duration_minutes between 5 and 480);
alter table public.expenses add column payment_method text not null default 'unknown'
 check (payment_method in ('unknown','cash','card')),
 add column duplicate_of bigint references public.expenses(id) on delete set null;
create unique index expenses_one_manual_per_bank on public.expenses(duplicate_of) where duplicate_of is not null;
alter table public.expenses add constraint expenses_not_own_duplicate check (duplicate_of is null or duplicate_of<>id);
create table public.expense_duplicate_dismissals (
 manual_id bigint references public.expenses(id) on delete cascade,
 bank_id bigint references public.expenses(id) on delete cascade,
 primary key(manual_id,bank_id)
);
create table public.expense_category_rules (
 id bigint generated always as identity primary key,
 merchant text not null unique check(char_length(merchant) between 1 and 200),
 label text not null check(char_length(label) between 1 and 200),
 category text not null check(category in ('Supermercado','Restaurantes','Transporte','Hogar','Suscripciones','Ocio','Salud','Compras','Otros')),
 created_at timestamptz not null default now()
);
create table public.quick_captures (
 id bigint generated always as identity primary key,
 label text not null check(char_length(label) between 1 and 60),
 resource text not null check(resource in ('expenses','tasks','notes')),
 values jsonb not null check(jsonb_typeof(values)='object'),
 created_at timestamptz not null default now()
);
insert into public.quick_captures(label,resource,values) values
 ('Energética · 1,20 €','expenses','{"description":"ENERGÉTICA x1 (apuntado a mano)","amount":1.2,"category":"Otros","payment_method":"unknown"}'),
 ('Tabaco · indicar importe','expenses','{"description":"TABACO (apuntado a mano)","category":"Otros","payment_method":"unknown"}'),
 ('Tarea para esta semana','tasks','{"text":"","period":"week"}');
create table public.pending_captures (
 id uuid primary key default gen_random_uuid(),
 channel text not null check(channel in ('panel','telegram')),
 values jsonb not null check(jsonb_typeof(values)='object'),
 version integer not null default 1,
 status text not null default 'pending' check(status in ('pending','saved','cancelled')),
 expires_at timestamptz not null default now()+interval '20 minutes',
 created_at timestamptz not null default now()
);
create index pending_captures_channel on public.pending_captures(channel,created_at desc);
-- Row lock makes repeated/parallel confirmations safe. No client-supplied expense is committed here.
create function public.confirm_personal_capture(capture_id uuid, capture_channel text, expected_version integer)
returns text language plpgsql security invoker set search_path='' as $$
declare op public.pending_captures%rowtype; v jsonb;
begin
 select * into op from public.pending_captures where id=capture_id and channel=capture_channel for update;
 if not found then raise exception 'Propuesta no encontrada'; end if;
 if op.status='saved' then return 'already_saved'; end if;
 if op.status<>'pending' or op.expires_at<=now() or op.version<>expected_version then raise exception 'Propuesta caducada o modificada'; end if;
 v=op.values;
 if v->>'_resource'='tasks' then
  if coalesce(v->>'text','')='' or char_length(v->>'text')>300 or v->>'scheduled_on' is null then raise exception 'Tarea incompleta'; end if;
  insert into public.tasks(text,scheduled_on) values(v->>'text',(v->>'scheduled_on')::date);
 elsif v->>'_resource'='notes' then
  if coalesce(v->>'text','')='' or char_length(v->>'text')>1000 then raise exception 'Nota incompleta'; end if;
  insert into public.notes(text) values(v->>'text');
 else
 if coalesce(v->>'description','')='' or char_length(v->>'description')>200
 or (v->>'amount')::numeric<=0 or (v->>'amount')::numeric>100000 or v->>'amount' is null
 or (v->>'date')::date>(now() at time zone 'Europe/Madrid')::date or (v->>'date')::date<(now() at time zone 'Europe/Madrid')::date-365
 or v->>'date' is null then raise exception 'Datos incompletos'; end if;
 insert into public.expenses(account_uid,transaction_key,booking_date,amount,currency,description,category,payment_method)
 values('manual','capture|'||op.id,(v->>'date')::date,(v->>'amount')::numeric,'EUR',v->>'description',coalesce(v->>'category','Otros'),coalesce(v->>'payment_method','unknown'));
 end if;
 update public.pending_captures set status='saved' where id=op.id;
 return 'saved';
end $$;
-- Both ids are checked inside the same transaction, never a silent destructive merge.
create function public.review_expense_duplicate(manual_expense_id bigint, bank_expense_id bigint, decision text)
returns void language plpgsql security invoker set search_path='' as $$
declare m public.expenses%rowtype; b public.expenses%rowtype;
begin
 -- Consistent lock order for concurrent decisions.
 perform id from public.expenses where id in (manual_expense_id,bank_expense_id) order by id for update;
 select * into strict m from public.expenses where id=manual_expense_id;
 select * into strict b from public.expenses where id=bank_expense_id;
 if m.account_uid<>'manual' or b.account_uid='manual' or b.duplicate_of is not null then raise exception 'Origen no válido'; end if;
 if decision='unlink' then
  update public.expenses set duplicate_of=null where id=m.id and duplicate_of=b.id;
 elsif decision='dismiss' then
  insert into public.expense_duplicate_dismissals values(m.id,b.id) on conflict do nothing;
 elsif decision='link' then
  if m.payment_method='cash' or m.amount<>b.amount or m.currency<>b.currency or abs(m.booking_date-b.booking_date)>7 then raise exception 'No cumplen los criterios de revisión'; end if;
  if m.duplicate_of is not null and m.duplicate_of<>b.id then raise exception 'El manual ya está vinculado'; end if;
  if exists(select 1 from public.debts where expense_id in (m.id,b.id)) then raise exception 'Revisa primero la deuda asociada'; end if;
  update public.expenses set duplicate_of=b.id where id=m.id;
  delete from public.expense_duplicate_dismissals where manual_id=m.id and bank_id=b.id;
 else raise exception 'Decisión no válida'; end if;
end $$;
create function public.correct_expense_category(expense_id bigint, new_category text, rule_merchant text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.expenses%rowtype;
begin
 if new_category not in ('Supermercado','Restaurantes','Transporte','Hogar','Suscripciones','Ocio','Salud','Compras','Otros') then raise exception 'Categoría no válida'; end if;
 select * into strict e from public.expenses where id=expense_id for update;
 update public.expenses set category=new_category where id=e.id;
 if rule_merchant is not null then
  insert into public.expense_category_rules(merchant,label,category) values(rule_merchant,e.description,new_category)
  on conflict(merchant) do update set category=excluded.category,label=excluded.label;
 end if;
end $$;
do $$ declare t text; begin
 foreach t in array array['expense_duplicate_dismissals','expense_category_rules','quick_captures','pending_captures'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.expense_category_rules_id_seq,public.quick_captures_id_seq to service_role;
revoke all on function public.confirm_personal_capture(uuid,text,integer),public.review_expense_duplicate(bigint,bigint,text),public.correct_expense_category(bigint,text,text) from public,anon,authenticated;
grant execute on function public.confirm_personal_capture(uuid,text,integer),public.review_expense_duplicate(bigint,bigint,text),public.correct_expense_category(bigint,text,text) to service_role;

-- Hidden manual duplicates must not reconcile another debt.
create or replace function public.reconcile_personal_debts() returns integer
language plpgsql security invoker set search_path='' as $$
declare candidate record; matched integer:=0;
begin
 perform pg_advisory_xact_lock(72619452);
 for candidate in
  with movements as (
   select 'receivable'::text direction,id,booking_date,amount,description,currency from public.incomes
   union all select 'payable',id,booking_date,amount,description,currency from public.expenses where duplicate_of is null
  ), pairs as (
   select d.id debt_id,m.id movement_id,m.direction,
    count(*) over(partition by d.id) movement_count,
    count(*) over(partition by m.direction,m.id) debt_count
   from public.debts d join movements m on m.direction=d.direction and m.amount=d.amount
    and m.currency='EUR' and m.booking_date>=d.incurred_on
    and m.booking_date<=(now() at time zone 'Europe/Madrid')::date
    and m.description ~* '^BIZUM\s+'
    and public.debt_bank_person(m.description)=public.debt_bank_person(coalesce(d.bank_name,d.person))
   where d.status='open'
    and not exists(select 1 from public.debts used where (m.direction='receivable' and used.income_id=m.id) or (m.direction='payable' and used.expense_id=m.id))
  ) select * from pairs where movement_count=1 and debt_count=1
 loop
  update public.debts set status='settled',settled_at=now(),
   income_id=case when candidate.direction='receivable' then candidate.movement_id else null end,
   expense_id=case when candidate.direction='payable' then candidate.movement_id else null end
  where id=candidate.debt_id and status='open';
  if found then matched:=matched+1;end if;
 end loop;
 return matched;
end
$$;
revoke all on function public.reconcile_personal_debts() from public,anon,authenticated;
grant execute on function public.reconcile_personal_debts() to service_role;

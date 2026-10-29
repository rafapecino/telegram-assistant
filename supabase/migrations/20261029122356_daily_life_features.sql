-- Single personal workspace: authenticated clients use the existing owner-checked panel-api.
create table public.tasks (
 id bigint generated always as identity primary key,
 text text not null check(char_length(text) between 1 and 300),
 scheduled_on date not null default current_date,
 completed_at timestamptz,
 created_at timestamptz not null default now()
);
create index tasks_pending on public.tasks(scheduled_on) where completed_at is null;
create table public.debts (
 id bigint generated always as identity primary key,
 person text not null check(char_length(person) between 1 and 100),
 bank_name text check(char_length(bank_name) between 1 and 150),
 description text not null check(char_length(description) between 1 and 200),
 direction text not null check(direction in ('receivable','payable')),
 amount numeric(12,2) not null check(amount>0 and amount<=100000),
 incurred_on date not null default current_date,
 status text not null default 'open' check(status in ('open','settled')),
 income_id bigint unique references public.incomes(id) on delete set null,
 expense_id bigint unique references public.expenses(id) on delete set null,
 settled_at timestamptz,
 created_at timestamptz not null default now(),
 check(not (income_id is not null and expense_id is not null))
);
create table public.consumption_goals (
 item text primary key check(item in ('tobacco','energy')),
 weekly_limit integer not null check(weekly_limit between 0 and 1000)
);
create table public.review_deliveries (
 key text primary key,
 status text not null check(status in ('sending','sent','failed')),
 sent_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.price_drops (
 id bigint generated always as identity primary key,
 watch_id bigint references public.price_watches(id) on delete cascade,
 query text not null,
 old_price numeric(12,2) not null,
 new_price numeric(12,2) not null,
 observed_at timestamptz not null default now(),
 check(new_price>0 and new_price<old_price),
 unique(watch_id,observed_at)
);
alter table public.tasks enable row level security;
alter table public.debts enable row level security;
alter table public.consumption_goals enable row level security;
alter table public.review_deliveries enable row level security;
alter table public.price_drops enable row level security;
revoke all on public.tasks, public.debts, public.consumption_goals, public.review_deliveries, public.price_drops from anon,authenticated;
grant all on public.tasks, public.debts, public.consumption_goals, public.review_deliveries, public.price_drops to service_role;
grant usage,select on sequence public.tasks_id_seq,public.debts_id_seq,public.price_drops_id_seq to service_role;

-- Only an exact normalized counterparty name is accepted, never a substring or a guessed first name.
create function public.debt_bank_person(description text) returns text
language sql immutable security invoker set search_path='' as $$
 select trim(regexp_replace(lower(translate(
 regexp_replace(regexp_replace(description,'^BIZUM\s+(DE|A FAVOR DE|A)\s+','','i'),'\s+CONCEPTO.*$','','i'),
 'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')), '\s+', ' ', 'g'))
$$;
revoke all on function public.debt_bank_person(text) from public,anon,authenticated;
grant execute on function public.debt_bank_person(text) to service_role;
create function public.reconcile_personal_debts() returns integer
language plpgsql security invoker set search_path='' as $$
declare candidate record; matched integer:=0;
begin
 perform pg_advisory_xact_lock(72619452);
 for candidate in
  with movements as (
   select 'receivable'::text direction,id,booking_date,amount,description,currency from public.incomes
   union all select 'payable',id,booking_date,amount,description,currency from public.expenses
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

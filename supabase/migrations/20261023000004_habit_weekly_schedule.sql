alter table public.habits add column if not exists scheduled_days integer[] not null default array[1,2,3,4,5,6,7];
alter table public.habits add constraint habits_scheduled_days_valid check (cardinality(scheduled_days) between 1 and 7 and scheduled_days <@ array[1,2,3,4,5,6,7] and array_position(scheduled_days, null) is null);

-- Aviso previo opcional: 0 significa que solo se avisa a la hora (útil en los recordatorios diarios).
alter table public.reminders drop constraint reminders_advance_minutes_check;
alter table public.reminders add constraint reminders_advance_minutes_check check (advance_minutes in (0, 30, 1440));

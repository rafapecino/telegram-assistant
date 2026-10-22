alter table public.reminders
  add column advance_minutes smallint not null default 30
    check (advance_minutes in (30, 1440));

-- Los avisos existentes de largo plazo conservan el día anterior; los demás pasan a media hora.
update public.reminders
set advance_minutes = case
      when text ~* '(cumple|aniversario|viaje|vacaciones|concierto)' or
           (remind_at - created_at >= interval '7 days' and text !~* '(reuni[oó]n|cita|llamada|videollamada|clase)')
      then 1440 else 30 end,
    advance_at = case
      when sent_at is not null then null
      when text ~* '(cumple|aniversario|viaje|vacaciones|concierto)' or
           (remind_at - created_at >= interval '7 days' and text !~* '(reuni[oó]n|cita|llamada|videollamada|clase)')
      then case when remind_at >= now() + interval '1 day' then remind_at - interval '1 day' else null end
      else case when remind_at >= now() + interval '30 minutes' then remind_at - interval '30 minutes' else null end
    end
where sent_at is null;

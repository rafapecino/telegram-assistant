-- Tareas programadas. Requiere el secreto "project_url" en Vault con la URL del proyecto
-- (https://<ref>.supabase.co), que se crea aparte porque cambia en cada proyecto.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;

-- Llama a la función scheduled-jobs con el secreto interno. También sirve para lanzar una tarea a mano:
-- select private.call_scheduled_job('weekly-summary');
create function private.call_scheduled_job(job_name text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/scheduled-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_jobs_secret')
    ),
    body := jsonb_build_object('job', job_name),
    -- La importación de gastos llama al banco y a Groq: el límite por defecto de 5 s se queda corto.
    timeout_milliseconds := 60000
  );
$$;

revoke execute on function private.call_scheduled_job(text) from public;

select cron.schedule('send-due-reminders', '* * * * *', $$ select private.call_scheduled_job('reminders') $$);
select cron.schedule('hourly-jobs', '0 * * * *', $$ select private.call_scheduled_job('hourly') $$);

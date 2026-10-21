# telegram-assistant

Bot personal de Telegram que:

- Crea recordatorios a partir de frases normales ("recuérdame llamar a Juan el jueves a las 17:00").
- Importa cada día a las 8:00 los gastos de la cuenta bancaria y los clasifica por categoría.
- Envía un resumen de gastos los domingos a las 20:00.

Funciona en Supabase (Edge Functions, Postgres y pg_cron). Las frases y las categorías las interpreta
`openai/gpt-oss-120b`, un modelo open source, a través de Groq. Los movimientos del banco llegan por open banking con
Enable Banking.

## Cómo está organizado

```
supabase/
  migrations/            tablas, secretos internos y tareas programadas
  functions/
    telegram-webhook/    recibe los mensajes de Telegram
    bank-callback/       vuelta desde el banco tras autorizar el acceso
    scheduled-jobs/      tareas que lanza pg_cron (recordatorios, importación, resumen)
    _shared/             una pieza por funcionalidad (reminders.ts, expenses.ts, ...) y utilidades comunes
```

Para añadir una funcionalidad: crea su módulo en `_shared/`, añade su comando en `buildReply`
(`telegram-webhook/index.ts`) y, si debe ejecutarse sola, su tarea en `runJob` (`scheduled-jobs/index.ts`).

## Puesta en marcha

1. Secretos de las funciones (Supabase → Edge Functions → Secrets):

   | Secreto                      | De dónde sale                                                   |
   | ---------------------------- | --------------------------------------------------------------- |
   | `TELEGRAM_BOT_TOKEN`         | @BotFather → `/newbot`                                          |
   | `TELEGRAM_USER_ID`           | @userinfobot. El bot solo responde a este usuario               |
   | `GROQ_API_KEY`               | console.groq.com/keys                                           |
   | `ENABLE_BANKING_APP_ID`      | ID de la aplicación en enablebanking.com/cp/applications        |
   | `ENABLE_BANKING_PRIVATE_KEY` | Contenido del `.pem` que se descarga al registrar la aplicación |

2. En Enable Banking, la aplicación (entorno Production) debe tener como redirect URL
   `https://<ref>.supabase.co/functions/v1/bank-callback`.

3. Crea en Vault la URL del proyecto, que usan las tareas programadas:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   ```

4. Aplica las migraciones y despliega las funciones:

   ```bash
   supabase db push
   supabase functions deploy
   ```

5. Conecta Telegram con la función:

   ```sql
   select private.call_scheduled_job('setup-telegram-webhook');
   ```

6. En Telegram, escribe `/conectar_banco` al bot y autoriza el acceso desde el banco.

## Lanzar una tarea a mano

```sql
select private.call_scheduled_job('import-expenses');  -- o 'weekly-summary', 'reminders'
select status_code, content from net._http_response order by id desc limit 1;
```

## Pruebas

```bash
deno task test
```

# telegram-assistant

Bot personal de Telegram que:

- Crea recordatorios a partir de frases normales ("recuérdame llamar a Juan el jueves a las 17:00"), también
  recurrentes ("cada lunes a las 9 sacar la basura"). Cada aviso trae botones: Hecho, +1 h y Mañana 9:00.
- Responde preguntas sobre tus gastos ("¿cuánto he gastado esta semana en restaurantes?") y tu balance ("¿cuánto he
  ahorrado este mes?").
- Guarda presupuestos mensuales ("pon un límite de 200 € al mes en restaurantes") y avisa al pasar del 80 % y del 100 %.
- Entiende notas de voz.
- Importa cada día a las 8:00 los movimientos de la cuenta bancaria: clasifica los gastos por categoría y guarda los
  ingresos para el balance.
- Envía un resumen de gastos los domingos a las 20:00.

Funciona en Supabase (Edge Functions, Postgres y pg_cron). Las frases y las categorías las interpreta
`openai/gpt-oss-120b`, un modelo open source, a través de Groq, que también transcribe las notas de voz
(`whisper-large-v3-turbo`). Los movimientos del banco llegan por open banking con Enable Banking.

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

Cada mensaje pasa por `_shared/message-intent.ts`: el modelo decide qué pide (recordatorio, consulta de gastos,
presupuesto, balance o nada) y
cada funcionalidad valida sus propios datos. Para añadir una funcionalidad: crea su módulo en `_shared/` con su formato
y su validación, regístralo en `buildIntentPrompt` y `parseMessageIntent`, y responde en `replyToMessage`
(`telegram-webhook/index.ts`). Si debe ejecutarse sola, añade su tarea en `runJob` (`scheduled-jobs/index.ts`).

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

   Para cortar el acceso, escribe `/desconectar_banco`: cierra la sesión en Enable Banking, que pide al banco retirar
   el permiso, y borra la conexión guardada. Los gastos ya importados se quedan.

## Actualizar un bot ya en marcha

Cuando cambian las migraciones o las funciones, repite el paso 4. Si cambia qué recibe el webhook (por ejemplo, los
botones de los recordatorios necesitan `callback_query`), repite también el paso 5.

## Datos que salen de Supabase

A Groq van el texto de tus mensajes, las notas de voz para transcribirlas y las descripciones de los gastos para
clasificarlas. Los números de tarjeta se ocultan antes (`****1234`).

## Lanzar una tarea a mano

```sql
select private.call_scheduled_job('import-expenses');  -- o 'weekly-summary', 'reminders'
select status_code, content from net._http_response order by id desc limit 1;
```

## Pruebas

```bash
deno task test
```

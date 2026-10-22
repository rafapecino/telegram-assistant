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
- Lleva la lista de la compra ("añade leche y pan"), con un botón por cosa para tacharla.
- Guarda notas sueltas ("apunta que la talla de Marta es la 38") y responde preguntas sobre ellas.
- Recuerda cumpleaños y avisa el día antes y el mismo día.
- Sigue hábitos diarios: cada noche a las 21:00 pregunta si los has hecho, con botones Sí/No, y lleva la racha.
- Consulta y crea eventos en Google Calendar ("¿qué tengo mañana?").
- Responde preguntas generales, como un chat normal, cuando el mensaje no es de ninguna de sus funciones.
- Cada día a las 8:00 manda un resumen: tiempo, recordatorios y eventos del día, cumpleaños y lista de la compra.

Funciona en Supabase (Edge Functions, Postgres y pg_cron). Las frases y las categorías las interpreta
`openai/gpt-oss-120b`, un modelo open source, a través de Groq, que también transcribe las notas de voz
(`whisper-large-v3-turbo`). Los movimientos del banco llegan por open banking con Enable Banking, y el tiempo, de
Open-Meteo.

## Cómo está organizado

```
supabase/
  migrations/            tablas, secretos internos y tareas programadas
  functions/
    telegram-webhook/    recibe los mensajes de Telegram
    bank-callback/       vuelta desde el banco tras autorizar el acceso
    google-callback/     vuelta desde Google tras autorizar el calendario
    scheduled-jobs/      tareas que lanza pg_cron (recordatorios, importación, resúmenes, hábitos)
    _shared/             una pieza por funcionalidad (reminders.ts, expenses.ts, ...) y utilidades comunes
```

Cada mensaje pasa por `_shared/message-intent.ts`: el modelo decide qué pide (recordatorio, consulta de gastos,
presupuesto, balance, compra, nota, cumpleaños, hábito, calendario o nada) y cada funcionalidad valida sus propios
datos. Para añadir una funcionalidad: crea su módulo en `_shared/` con su formato y su validación, regístralo en
`buildIntentPrompt` y `parseMessageIntent`, y responde en `replyToMessage` (`telegram-webhook/index.ts`). Si debe
ejecutarse sola, añade su tarea en `runJob` (`scheduled-jobs/index.ts`).

## Puesta en marcha

1. Secretos de las funciones (Supabase → Edge Functions → Secrets):

   | Secreto                      | De dónde sale                                                   |
   | ---------------------------- | --------------------------------------------------------------- |
   | `TELEGRAM_BOT_TOKEN`         | @BotFather → `/newbot`                                          |
   | `TELEGRAM_USER_ID`           | @userinfobot. El bot solo responde a este usuario               |
   | `GROQ_API_KEY`               | console.groq.com/keys                                           |
   | `ENABLE_BANKING_APP_ID`      | ID de la aplicación en enablebanking.com/cp/applications        |
   | `ENABLE_BANKING_PRIVATE_KEY` | Contenido del `.pem` que se descarga al registrar la aplicación |
   | `GOOGLE_CLIENT_ID`           | Cliente OAuth de Google Cloud (paso 3). Solo para el calendario |
   | `GOOGLE_CLIENT_SECRET`       | El secreto de ese mismo cliente                                 |
   | `WEATHER_CITY`               | Opcional. Ciudad del tiempo del resumen; por defecto, Madrid    |

2. En Enable Banking, la aplicación (entorno Production) debe tener como redirect URL
   `https://<ref>.supabase.co/functions/v1/bank-callback`.

3. Para el calendario, en console.cloud.google.com:
   - Activa la API de Google Calendar.
   - En la pantalla de consentimiento OAuth, tipo de usuario Externo, añade el permiso
     `https://www.googleapis.com/auth/calendar.events` y publica la aplicación (estado En producción). En estado de
     prueba, Google retira el acceso a los 7 días. Al autorizar verás el aviso «Google no ha verificado esta
     aplicación»: es tu propia aplicación, pulsa Configuración avanzada → Ir a la aplicación.
   - Crea un ID de cliente OAuth de tipo Aplicación web con URI de redirección
     `https://<ref>.supabase.co/functions/v1/google-callback`.

4. Crea en Vault la URL del proyecto, que usan las tareas programadas:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   ```

5. Aplica las migraciones y despliega las funciones:

   ```bash
   supabase db push
   supabase functions deploy
   ```

6. Conecta Telegram con la función:

   ```sql
   select private.call_scheduled_job('setup-telegram-webhook');
   ```

7. En Telegram, escribe `/conectar_banco` al bot y autoriza el acceso desde el banco. Para el calendario,
   `/conectar_calendario`.

   Para cortar el acceso, escribe `/desconectar_banco`: cierra la sesión en Enable Banking, que pide al banco retirar el
   permiso, y borra la conexión guardada. Los gastos ya importados se quedan. `/desconectar_calendario` retira el
   permiso en Google y borra la conexión.

## Actualizar un bot ya en marcha

Cuando cambian las migraciones o las funciones, repite el paso 5. Si cambia qué recibe el webhook (por ejemplo, los
botones necesitan `callback_query`), repite también el paso 6.

## Datos que salen de Supabase

A Groq van el texto de tus mensajes, las notas de voz para transcribirlas, las descripciones de los gastos para
clasificarlas y tus notas cuando les haces una pregunta o pides borrar una. Los números de tarjeta se ocultan antes
(`****1234`). A Google van los eventos que creas y las fechas que consultas; a Open-Meteo, solo el nombre de la ciudad.

## Lanzar una tarea a mano

```sql
select private.call_scheduled_job('import-expenses');  -- o 'weekly-summary', 'reminders', 'morning-summary', 'habits'
select status_code, content from net._http_response order by id desc limit 1;
```

## Pruebas

```bash
deno task test
```


## Panel web personal

La carpeta `frontend/` contiene un panel responsive para consultar y gestionar ingresos, gastos, presupuestos,
recordatorios, lista de la compra, notas, cumpleaños, hábitos y eventos del calendario. Comparte los datos del bot:
las operaciones pasan por la función `panel-api`, que valida la clave del panel y accede a Supabase con la clave
secreta solo en el servidor. No pongas `SUPABASE_SECRET_KEYS` ni `PANEL_TOKEN` en variables `VITE_`.

1. En Supabase → Edge Functions → Secrets, crea `PANEL_TOKEN` con una cadena aleatoria larga y
   `PANEL_ORIGINS` con el origen exacto del panel (por ejemplo `https://panel.ejemplo.com`; separa varios con comas).
2. Despliega la función con `supabase functions deploy panel-api` tras aplicar las migraciones con `supabase db push`.
3. Copia `frontend/.env.example` a `frontend/.env` y sustituye la URL del proyecto en `VITE_PANEL_API_URL`.
4. Desde `frontend/`, ejecuta `npm ci` y `npm run dev`. Abre la URL que muestra Vite. Para producción,
   ejecuta `npm run build` y publica `frontend/dist` en un alojamiento web con HTTPS; añade su origen a
   `PANEL_ORIGINS`. Durante desarrollo, añade `http://localhost:5173` a esa lista.
5. Introduce `PANEL_TOKEN` en la pantalla de acceso. Se mantiene solo en la sesión de esa pestaña.

En el Inicio hay un chat con el asistente: entiende lo mismo que el bot de Telegram (gastos, compra, recordatorios…)
y contesta preguntas generales con el mismo modelo de Groq, teniendo en cuenta los últimos mensajes de la conversación.
La conversación no se guarda: desaparece al recargar la página.

La conexión con Google Calendar utiliza el mismo flujo OAuth del bot. El panel muestra los próximos 14 días.
El periodo de finanzas se elige entre 7, 30 y 90 días; los presupuestos siempre corresponden al mes actual.

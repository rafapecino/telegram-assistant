# telegram-assistant

Bot personal de Telegram que:

- Crea recordatorios a partir de frases normales ("recuérdame llamar a Juan el jueves a las 17:00").
- Importa cada día a las 8:00 los gastos de la cuenta bancaria y los clasifica por categoría.
- Envía un resumen de gastos los domingos a las 20:00.

Incluye además un panel web para ver los gastos y los recordatorios pendientes, crear recordatorios y preguntar por
los gastos en un chat ("¿cuánto llevo en restaurantes este mes?"). En el chat, la IA solo interpreta la pregunta
(periodo, categoría, comercio y orden): las cifras salen de la base de datos.

La API está hecha con FastAPI y guarda los datos en Postgres (puede ser el de Supabase). Las frases y las
categorías las interpreta `openai/gpt-oss-120b`, un modelo open source, a través de Groq. Los movimientos del banco
llegan por open banking con Enable Banking.

## Cómo está organizado

```
api/
  main.py              endpoints de FastAPI (webhook de Telegram, vuelta del banco, tareas, datos del panel)
  models.py            modelos Pydantic: validan lo que llega de Telegram, del banco, de la IA y de la API
  db.py                conexión con Postgres y creación de tablas
  bot.py               respuesta a cada mensaje de Telegram
  jobs.py              tareas programadas (recordatorios, importación, resumen semanal)
  reminders.py         recordatorios
  expenses.py          gastos: importación, categorías y resumen
  expense_questions.py preguntas del chat del panel: interpretación con la IA y consulta a la base de datos
  balance.py           balance del panel: ingresos frente a gastos de cada mes
  bank_connection.py   enlace de autorización del banco y sesión activa
  enable_banking.py    cliente de Enable Banking
  groq.py              cliente de Groq
  telegram.py          cliente de Telegram
  madrid_time.py       conversión de horas de Madrid
  config.py            variables de entorno
  logging_config.py    formato de los logs, ID de petición y ocultación de secretos
frontend/              panel web en React + TypeScript (Vite)
  src/App.tsx          página principal
  src/components/      acceso con token, panel de gastos, balance, chat de gastos y panel de recordatorios
  src/api.ts           llamadas a la API y sus tipos
  src/format.ts        euros y horas de Madrid
  src/categoryColors.ts color fijo de cada categoría
  src/assets/          logo de Stratesys
  src/styles.css       estilos con la identidad de Stratesys (modo claro y oscuro)
test/                  tests unitarios (pytest)
requirements.txt
```

Para añadir una funcionalidad: crea su módulo en `api/`, añade su comando en `build_reply` (`api/bot.py`) y, si
debe ejecutarse sola, su tarea en `JOBS` y en `build_scheduler` (`api/jobs.py`).

## Puesta en marcha

Los comandos son para la consola `cmd` de Windows, ejecutados desde la carpeta del proyecto. En los ejemplos,
`https://tu-api.example.com` es tu `PUBLIC_BASE_URL` y `TU_INTERNAL_SECRET` el valor de `INTERNAL_SECRET`.

1. Instala las dependencias (Python 3.11 o superior):

   ```bat
   python -m venv .venv
   .venv\Scripts\activate.bat
   pip install -r requirements.txt
   ```

   Cada vez que abras una consola nueva para la API, vuelve a ejecutar `.venv\Scripts\activate.bat`.

2. Crea el `.env` a partir del ejemplo y rellénalo:

   ```bat
   copy .env.example .env
   notepad .env
   ```

   | Variable                     | De dónde sale                                                        |
   | ---------------------------- | -------------------------------------------------------------------- |
   | `TELEGRAM_BOT_TOKEN`         | @BotFather → `/newbot`                                               |
   | `TELEGRAM_USER_ID`           | @userinfobot. El bot solo responde a este usuario                    |
   | `TELEGRAM_WEBHOOK_SECRET`    | Cadena aleatoria. Telegram la envía en cada mensaje                  |
   | `INTERNAL_SECRET`            | Cadena aleatoria. Protege `/jobs/*` y `/telegram/setup-webhook`      |
   | `PANEL_TOKEN`                | Cadena aleatoria. Es la contraseña del panel web                     |
   | `GROQ_API_KEY`               | console.groq.com/keys                                                |
   | `ENABLE_BANKING_APP_ID`      | ID de la aplicación en enablebanking.com/cp/applications             |
   | `ENABLE_BANKING_PRIVATE_KEY` | Contenido del `.pem` de la aplicación (vale en una línea con `\n`)   |
   | `DATABASE_URL`               | Cadena de conexión de Postgres (en Supabase, la de "Session pooler") |
   | `PUBLIC_BASE_URL`            | URL pública donde se publica la API, por ejemplo `https://bot.ejemplo.com` |

   Para generar las cadenas aleatorias: `python -c "import secrets; print(secrets.token_hex(32))"`. Al arrancar, la
   API avisa en los logs si alguna falta o tiene menos de 32 caracteres.

   Opcionales: `LOG_LEVEL` (por defecto `INFO`; `DEBUG` muestra más detalle) y `ENABLE_DOCS` (por defecto `false`;
   con `true` activa la documentación interactiva en `/docs`).

3. Arranca la API. Al arrancar crea las tablas si no existen y programa las tareas:

   ```bat
   uvicorn api.main:app --host 0.0.0.0 --port 8000
   ```

   Usa un único proceso: con varios workers o réplicas las tareas se ejecutarían varias veces. Si necesitas más, deja
   `ENABLE_SCHEDULER=true` solo en uno.

4. En Enable Banking, la aplicación (entorno Production) debe tener como redirect URL
   `https://tu-api.example.com/bank/callback`.

5. Conecta Telegram con la API (`curl` viene incluido en Windows 10 y 11):

   ```bat
   curl -X POST https://tu-api.example.com/telegram/setup-webhook -H "X-Internal-Secret: TU_INTERNAL_SECRET"
   ```

6. En Telegram, escribe `/conectar_banco` al bot y autoriza el acceso desde el banco.

7. Arranca el panel web en otra consola, con la API ya arrancada (necesita Node.js 18 o superior):

   ```bat
   cd frontend
   npm install
   npm run dev
   ```

   Abre http://localhost:5173 y escribe el valor de `PANEL_TOKEN`. Mientras desarrollas, los cambios en `frontend\src` se ven al instante, y las llamadas
   a `/expenses` y `/reminders` se reenvían a la API en `http://localhost:8000`.

   Para usarlo sin `npm run dev`, compílalo una vez. La API sirve entonces la web en su propia dirección
   (http://localhost:8000, o tu `PUBLIC_BASE_URL`):

   ```bat
   cd frontend
   npm run build
   ```

   Después de compilar, reinicia `uvicorn` para que encuentre la carpeta `frontend\dist`.

   Si `pip install` falla con `WinError 206` (ruta demasiado larga), crea el entorno virtual en una carpeta más corta,
   por ejemplo `python -m venv C:\venvs\asistente`, y actívalo con `C:\venvs\asistente\Scripts\activate.bat`.

## Seguridad

Qué datos son sensibles y cómo se protegen:

| Dato                                                        | Protección                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Gastos (importes, comercios, fechas) y cuentas del banco     | Panel con `PANEL_TOKEN`; tablas con RLS y sin permisos para los roles públicos de Supabase      |
| Sesión del banco y código de autorización                   | `state` de un solo uso que caduca en 30 minutos; la URL de vuelta no se registra con su query   |
| Texto de los mensajes y de los recordatorios                | Solo responde a `TELEGRAM_USER_ID`; los logs registran el comando o la longitud, nunca el texto |
| Claves (`.env`, `.pem`) y cadena de conexión                 | Fuera de git (`.gitignore`); se ocultan automáticamente en los logs y en los avisos             |

Medidas aplicadas en la API ([api/main.py](api/main.py)):

- Los secretos se comparan en tiempo constante (`hmac.compare_digest`). Si falta uno, su endpoint responde 503: queda
  cerrado, nunca abierto. Cada intento con una credencial incorrecta queda en los logs con la IP.
- El navegador nunca ve el detalle de un error interno: lo recibe el dueño por Telegram y queda en los logs.
- `/bank/callback` es pública, así que solo avisa por Telegram si llega con un `state` válido. Así nadie puede usarla
  para enviarte mensajes con el texto que quiera.
- Cabeceras de seguridad en todas las respuestas: `Content-Security-Policy`, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` y `Cache-Control: no-store`.
- `/docs` está apagado salvo con `ENABLE_DOCS=true`.
- Pydantic valida todo lo que entra: mensajes de Telegram, respuestas del banco y de la IA, y datos del panel.

Ten en cuenta que el texto de tus mensajes, las preguntas del chat y las descripciones de los gastos se envían a Groq
para interpretarlos.

Recomendaciones al publicarla: sírvela solo por HTTPS y cambia los secretos si alguna vez se filtran (en Telegram,
`/revoke` en @BotFather).

## Logs

Salen por la consola de `uvicorn` con este formato:

```
2026-10-21 08:00:02,113 INFO    [-] api.expenses: Importación de gastos: 1 cuenta(s), 12 cargos en los últimos 7 días, 3 nuevos
2026-10-21 10:15:40,201 INFO    [4d3dd0e5] api.main: Mensaje recibido: texto libre (42 caracteres)
2026-10-21 10:15:41,050 INFO    [4d3dd0e5] api.main: POST /telegram/webhook -> 200 (849 ms)
```

Entre corchetes va el ID de la petición, para seguir todo lo que pasa en una misma llamada. Las tareas programadas
llevan `-`. Se registran el arranque, cada petición (método, ruta, estado y duración), los mensajes del bot, las
llamadas a Groq y a Enable Banking, la conexión con el banco, la importación de gastos, el envío de recordatorios, el
resumen semanal y todos los errores con su traza.

## Lanzar una tarea a mano

Cambia `import-expenses` por `weekly-summary` o `reminders` según la tarea:

```bat
curl -X POST https://tu-api.example.com/jobs/import-expenses -H "X-Internal-Secret: TU_INTERNAL_SECRET"
```

## Pruebas

Con el entorno virtual activado:

```bat
pytest
```

Las del frontend usan el runner de Node (hace falta Node 22.18 o superior), sin dependencias extra:

```bat
cd frontend
npm test
```

La documentación interactiva de la API está en http://localhost:8000/docs si arrancas con `ENABLE_DOCS=true`.

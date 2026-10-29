# CLAUDE.md

Guía para trabajar en este repositorio. Qué hace cada función y cómo se instala está en `README.md`. Este fichero
recoge cómo está montado, cómo se prueba y despliega, las reglas que no se rompen y las trampas ya conocidas.

## Qué es

Asistente personal de **un solo usuario**: un bot de Telegram y un panel web (`frontend/`) que comparten datos y
lógica. El backend son Edge Functions de Supabase (Deno) con Postgres y `pg_cron`. Groq interpreta los mensajes en
lenguaje natural y transcribe las notas de voz. Todo el producto, el código, los comentarios y los textos de
interfaz están en español de España.

- Producción web: https://telegram-assistant-preview.vercel.app (Vercel compila `frontend/` al fusionar en `main`).
- Proyecto Supabase: `znzyzstvfqsrilhzyqub`.
- Repositorio **público**: nunca subas datos personales, correos, claves ni capturas con datos reales.

## Cómo trabajar aquí

- Responde y escribe en español, directo y sin relleno. Lo importante primero.
- Para tareas de más de un paso, presenta antes el plan con cómo se verificará cada paso.
- Si algo es ambiguo, haz una sola pregunta concreta. Si hay una opción mejor o más simple, dilo antes de hacerlo.
- Cambia solo lo necesario: sin funciones «por si acaso» ni refactorizar lo que no está roto. Respeta el estilo de
  cada fichero. Limpia lo que tus cambios dejen huérfano, pero no borres código muerto que ya existía: menciónalo.
- **Para y pide confirmación** antes de migraciones, desplegar funciones, fusionar en `main` (publica la web), modificar
  datos persistentes o cambiar ajustes de Supabase, salvo que el usuario ya haya dicho «publícalo».
- Prueba siempre con datos ficticios. No leas datos personales de la base de datos: para comprobaciones, usa
  recuentos o la configuración.
- Varias sesiones trabajan a la vez sobre `main`. Antes de empezar, `git fetch origin main` y crea la rama desde ahí.
  Antes de desplegar, comprueba qué versión está en producción.

## Mapa del repositorio

```
supabase/
  migrations/          esquema, RLS, secretos internos y pg_cron (prefijo de fecha AAAAMMDDhhmmss)
  config.toml          verify_jwt = false en todas las funciones (cada una se autentica sola)
  functions/
    telegram-webhook/  mensajes y botones de Telegram (comprueba el secret_token del webhook)
    panel-api/         única puerta del panel web a los datos (sesión, lista de acceso, límites)
    scheduled-jobs/    tareas de pg_cron; exige la cabecera x-internal-secret
    bank-callback/     vuelta de Enable Banking tras autorizar el banco
    google-callback/   vuelta de Google OAuth (Calendar y Gmail de solo lectura)
    _shared/           un módulo por funcionalidad + su *_test.ts, y utilidades comunes
frontend/              React 19 + Vite + TypeScript; casi toda la interfaz está en src/App.tsx
  src/navigation.ts    rutas ?section=… y última sección guardada
  src/LifePanels.tsx   tareas sin hora, deudas, objetivos, repaso semanal, pedidos
  src/ExperiencePanels.tsx  notas, deshacer borrados, frescura de datos, propuestas editables del chat
  vercel.json          CSP y cabeceras de seguridad
  tests/               pruebas Node (node --test) y de interfaz con jsdom
```

### Flujo de un mensaje (Telegram y chat del panel)

1. `commands.ts` resuelve los comandos (`/conectar_banco`…).
2. `message-intent.ts` pide a Groq que clasifique el mensaje. `buildIntentPrompt` junta el `*_INTENT_FORMAT` de cada
   módulo y `parseMessageIntent` delega la validación en el `parse…Request` de ese módulo.
3. `assistant.ts` (`replyToText`) responde a finanzas y recordatorios; `personal-replies.ts` (`replyToPersonalIntent`),
   al resto. Lo que no es ninguna funcionalidad lo contesta `answerGeneralQuestion`, una conversación normal que nunca
   ve datos del usuario.
4. El chat del panel (`panel-chat.ts`) guarda la conversación en `chat_messages`; Telegram no la guarda.
5. Un «sí» o un «no» sueltos contestan la última pregunta de sí o no pendiente (`chat-questions.ts`), sin llamar a Groq.

**Para añadir una funcionalidad:** crea `_shared/<nombre>.ts` con su `…_INTENT_FORMAT`, su tipo de petición, su
`parse…` y su `replyTo…`. Regístrala en `message-intent.ts` (tipo, prompt y parse) y en `personal-replies.ts`, añade
la capacidad a `CAPABILITIES` en `assistant.ts` y escribe su `*_test.ts`. Si debe ejecutarse sola, añádela a
`scheduled-jobs/index.ts`.

### panel-api

- Lectura: `GET ?resource=…` pasa por `readResource`; un recurso desconocido devuelve 404. `resource=dashboard` agrupa
  en una sola petición todo lo del arranque (`DASHBOARD_RESOURCES`), porque una petición por recurso provocaba
  errores 429 de Supabase.
- Escritura: `POST` y `DELETE` con el cuerpo validado en el servidor. Borrar datos personales exige `confirm=BORRAR`.
- Para cada petición: CORS limitado a producción, previsualizaciones de Vercel y `localhost` → sesión de Supabase Auth
  → el usuario debe estar en `panel_users` y ser la única fila (si hubiera más, responde 409) → límite de peticiones.
- Límites: 300 peticiones por minuto en general y 10 por minuto en las que gastan cuota externa (chat, transcripción,
  saludo, precios). Se cuentan con la RPC `count_panel_request`.

### Tareas programadas

`pg_cron` llama cada minuto a `reminders` y cada hora a `hourly`. Las horas se comprueban en hora de Madrid dentro de
la función (`madridClock`), así el cambio de horario no las desplaza:

| Hora (Madrid) | Tarea |
|---|---|
| Cada hora | Avisos de AEMET |
| 8:00 | Resumen de la mañana; importación del banco, presupuestos y conciliación de deudas |
| 10:00 | Vigilancia de precios (SerpApi) |
| 21:00 | Pregunta de hábitos |
| Domingo 20:00 | Importación del banco y repaso semanal (`sendLifeWeeklyReview`: gastos, hábitos, agenda, cumpleaños, deudas y bajadas de precio) |

A mano: `select private.call_scheduled_job('<tarea>');` (ver `README.md`).

## Comandos

```bash
# Backend (Deno): pruebas de _shared/
deno task test
deno fmt supabase/functions        # ancho de línea 120 (deno.json)
deno lint

# Frontend
cd frontend && npm ci
npm test            # node --test tests/*.test.mjs (Node ≥ 22.18)
npm run test:ui     # interfaz con jsdom y datos ficticios
npm run test:life   # tareas, deudas y objetivos
npm run build       # tsc --noEmit + vite build
```

Si `deno` no está instalado, descarga el binario oficial de GitHub (`denoland/deno`, `deno-x86_64-unknown-linux-gnu.zip`).
Algunos ficheros ya no cumplen `deno fmt` (`calendar.ts`); no los reformatees enteros si no los estás cambiando.

## Despliegue

- **Web:** fusionar en `main` despliega Vercel solo. Para comprobarlo, compila `main` en local y compara el nombre de
  `assets/index-*.js` y `assets/index-*.css` con el HTML publicado.
- **Edge Functions:** `supabase functions deploy <función>` o, desde Claude, la herramienta MCP de despliegue con
  `verify_jwt: false`, desplegando desde el commit ya fusionado. Despliega `panel-api` antes que la interfaz que lo
  usa. Tras desplegar, una petición sin credenciales a cada función debe responder 401; los callbacks sin parámetros,
  400.
- **Migraciones:** fichero nuevo en `supabase/migrations/` y `supabase db push`, o `apply_migration` por MCP. Toda tabla
  nueva lleva `enable row level security`, ninguna política y `revoke all … from anon, authenticated`. Después,
  revisa los avisos de seguridad de Supabase.
- **Secretos:** Supabase → Edge Functions → Secrets. La lista está en `README.md`, más `SERPAPI_API_KEY` y, opcional,
  `COINGECKO_API_KEY` (no está puesta: el usuario no quiere un plan de pago). No pongas `SUPABASE_SECRET_KEYS` ni otro
  secreto en variables `VITE_`.

## Reglas de seguridad que no se rompen

- El navegador nunca accede a las tablas: RLS activo sin políticas y sin permisos para `anon` ni `authenticated`.
  Todo pasa por `panel-api`, que usa la clave secreta solo en el servidor.
- Al usuario solo le llegan los mensajes de `UserFacingError`; cualquier otro error se registra y se responde genérico.
- Lo que llega del navegador o de Groq se valida en el servidor; los formatos que devuelve Groq son una propuesta.
- Si el panel empieza a usar otro dominio (API, fuente, imagen), añádelo a la CSP de `frontend/vercel.json`.
- Groq recibe mensajes, notas de voz, descripciones de gastos y la memoria. A Google solo se le piden metadatos de
  correo (remitente, asunto y fecha), nunca el cuerpo. Antes de enviar datos nuevos a un tercero, pregunta y
  documéntalo en «Datos que salen de Supabase» del README.
- Nunca envíes el correo del usuario a servicios ajenos.

## Convenciones de código

- Comentarios en español que explican el porqué, no el qué. Nombres descriptivos y booleanos con prefijo
  (`isLoading`, `hasError`).
- No silencies errores: falla con un mensaje que explique el problema real.
- Fechas y horas siempre en Europe/Madrid con los helpers de `madrid-time.ts` (`madridClock`, `madridLocalToUtc`,
  `addDaysToDate`). No uses `new Date().toISOString().slice(0, 10)` para «hoy».
- Pruebas del backend: `fakeDb` (también admite `rpc`) y `withFakeFetch` de `_shared/testing.ts`; nunca servicios reales.
- Pruebas visuales del panel: Playwright con el backend simulado (`page.route`) y datos inventados. Chromium ya está
  instalado: no ejecutes `playwright install`.

## Servicios externos

| Servicio | Uso | A tener en cuenta |
|---|---|---|
| Groq | `openai/gpt-oss-120b` (intenciones y chat), `whisper-large-v3-turbo` (voz) | `askGroqForJson` devuelve JSON sin validar |
| Enable Banking | Movimientos del banco | El permiso caduca; se renueva con `/conectar_banco` |
| Google OAuth | Calendar (lectura y escritura) y Gmail (solo lectura) | La app de OAuth debe estar «En producción» o el acceso caduca a los 7 días |
| Open-Meteo | Previsión del tiempo | Da 503 a las horas en punto; hay reintentos |
| AEMET | Avisos meteorológicos de Madrid | Clave gratuita |
| EMT Madrid | Autobuses | Usuario y contraseña de MobilityLabs |
| SerpApi | Comparador y vigilancia de precios | 250 búsquedas al mes; se reservan 15 para la vigilancia |
| Yahoo Finance | Índices y acciones | Sin API oficial; usar `range=1d` para el cambio diario |
| CoinGecko | Criptomonedas | Da 429 a menudo; se usa la última cotización buena (menos de 60 min) |
| Frankfurter | Divisas | La URL buena es `api.frankfurter.dev/v1` (la antigua redirige) |
| Wikimedia | Curiosidad del día | Endpoint `onthisday/events` (`selected` da 429) |
| RSS de medios | Noticias | Lista en `news.ts`; el de RTVE se quitó por estar desactualizado |

## Trampas conocidas

- `Intl.NumberFormat` en euros pone un espacio duro (` `) antes de «€»: tenlo en cuenta en las expectativas de
  las pruebas.
- Las cachés a nivel de módulo (cotizaciones, noticias, curiosidad) se comparten entre pruebas: usa símbolos o fechas
  distintos en cada una.
- Las respuestas falsas de Telegram en las pruebas deben incluir `result` (`sendTelegramMessage` devuelve
  `message_id`).
- `showModal()` mueve el foco al primer botón del diálogo: para enfocar un campo, hazlo con una referencia después
  de abrirlo.
- Un evento creado por chat a las 00:00 se guarda como «todo el día» (el modelo pone medianoche cuando no se dijo hora).
- El tiempo del Inicio busca los nombres «Stratesys» y «Villanueva de la Cañada» escritos en `home-weather.ts`: si
  cambia `WEATHER_CITY`, mostrará «Previsión no disponible».
- La interfaz no tiene protección ante errores de renderizado: un dato con forma inesperada deja la sección entera en
  blanco.
- En un recurso nuevo del panel, piensa si debe ir en `dashboard` o pedirse al abrir su sección (Ajustes consulta a
  Google, por eso va aparte).

## Pendiente

Ajustes de Supabase que debe hacer el usuario a mano:
- Desactivar «Allow new users to sign up»: sigue activo; hay una sola cuenta y la lista de acceso la protege.
- Activar la protección contra contraseñas filtradas (requiere el plan Pro).

Hallazgos de la auditoría de UX, accesibilidad y seguridad del 29 de octubre de 2026 que siguen abiertos, por
prioridad:
1. El menú lateral de escritorio oculta secciones sin indicarlo (a 1366×768 no se ven siete).
2. El Inicio no enseña las tareas de hoy y los recordatorios están plegados en «Próximos planes».
3. No hay verificación en dos pasos ni forma de ver o cerrar las sesiones abiertas.
4. Ajustes no explica qué datos van a Groq y a SerpApi.
5. En el móvil no se puede buscar (la lupa se quitó de la cabecera a petición del usuario).
6. El menú «Más» del móvil no lleva el foco dentro ni lo retiene.
7. Contraste insuficiente en `.negative` (Finanzas) y en la fecha de las notas.
8. El selector «Hoy / Esta semana» no muestra cuál está activo.
9. La repetición «weekly» aparece en inglés.
10. Finanzas en el móvil es muy larga y tiene dos «balances» sin explicar.

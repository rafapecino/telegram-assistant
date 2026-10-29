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
- Sigue hábitos diarios: cada noche a las 21:00 pregunta si los has hecho, con botones Sí/No, y lleva la racha. La
  pregunta llega a Telegram y al chat del panel; contestar en uno actualiza el otro, y vale con escribir «sí» o «no».
- Consulta y crea eventos en Google Calendar ("¿qué tengo mañana?").
- Busca en Gmail ("¿tengo algo de Hacienda?") y enseña remitente, asunto y fecha. Solo lee: no envía ni borra.
  No enseña Promociones (salvo las que Gmail marca como importantes), Social ni Foros, ni los remitentes de la
  tabla `email_filters` (un dominio vale también para sus subdominios), salvo si preguntas por un remitente concreto
  o el asunto parece importante (factura, pedido, entrevista, código…). La lista se cambia con "no me enseñes los
  correos de X" y "vuelve a enseñarme los de X".
- Dice cuándo pasa el autobús de la EMT por una parada, por número o con paradas guardadas por nombre ("la parada
  de casa es la 1234" y luego "¿cuándo pasa el bus de casa?").
- Avisa por Telegram cuando AEMET publica un aviso meteorológico (amarillo, naranja o rojo) en la Comunidad de
  Madrid. Lo mira cada hora.
- Responde preguntas generales, como un chat normal, cuando el mensaje no es de ninguna de sus funciones. Si en esa
  conversación cuentas algo nuevo de ti ("en abril corro la maratón"), propone apuntarlo en la memoria con los botones
  Guárdalo y No. Nunca lo guarda sin que pulses Guárdalo.
- Conecta y desconecta el banco y la cuenta de Google con comandos (`/conectar_calendario`…) o con lenguaje natural
  ("vuelve a conectar Google"), también desde el chat del panel. Desconectar con lenguaje natural pide confirmación.
- Cada día a las 8:00 manda un resumen: tiempo, avisos de AEMET, recordatorios y eventos del día, correos
  importantes sin leer, cumpleaños y lista de la compra.

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
   | `GOOGLE_CLIENT_ID`           | Cliente OAuth de Google Cloud (paso 3). Calendario y Gmail      |
   | `GOOGLE_CLIENT_SECRET`       | El secreto de ese mismo cliente                                 |
   | `WEATHER_CITY`               | Opcional. Ciudad del tiempo; por defecto, la oficina Stratesys  |
   | `AEMET_API_KEY`              | Clave gratuita de opendata.aemet.es (llega por correo)          |
   | `EMT_EMAIL`                  | Cuenta de mobilitylabs.emtmadrid.es, con el correo confirmado   |
   | `EMT_PASSWORD`               | La contraseña de esa cuenta                                     |

2. En Enable Banking, la aplicación (entorno Production) debe tener como redirect URL
   `https://<ref>.supabase.co/functions/v1/bank-callback`.

3. Para el calendario y Gmail, en console.cloud.google.com:
   - Activa la API de Google Calendar y la de Gmail.
   - En la pantalla de consentimiento OAuth, tipo de usuario Externo, añade los permisos
     `https://www.googleapis.com/auth/calendar.events` y `https://www.googleapis.com/auth/gmail.readonly` y publica la aplicación (estado En producción). En estado de
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
(`****1234`). A Google van los eventos que creas, las fechas que consultas y las búsquedas de Gmail; el contenido
de los correos no se lee y a Groq solo llega tu pregunta. A Open-Meteo, solo el nombre de la ciudad; a la EMT, el
número de parada.

Si conectaste Google antes de añadir Gmail, vuelve a escribir `/conectar_calendario` para dar el permiso nuevo.

## Lanzar una tarea a mano

```sql
select private.call_scheduled_job('import-expenses');
-- o 'weekly-summary', 'reminders', 'morning-summary', 'habits', 'weather-alerts'
select status_code, content from net._http_response order by id desc limit 1;
```

## Pruebas

```bash
deno task test
```


## Panel web personal

La carpeta `frontend/` contiene un panel responsive para consultar y gestionar ingresos, gastos, presupuestos,
recordatorios, lista de la compra, notas, cumpleaños, hábitos y eventos del calendario. Comparte los datos del bot:
las operaciones pasan por la función `panel-api`, que comprueba la sesión y accede a Supabase con la clave secreta solo
en el servidor. No pongas `SUPABASE_SECRET_KEYS` en variables `VITE_`.

El acceso es con correo y contraseña (Supabase Auth). La pantalla de acceso no permite registrarse: crea la cuenta
desde Authentication → Users en Supabase, desactiva «Allow new users to sign up» y autorízala en la tabla
`panel_users`:

```sql
insert into public.panel_users (user_id) select id from auth.users where email = 'tu@correo.com';
```

1. Aplica las migraciones con `supabase db push` y despliega la función con `supabase functions deploy panel-api`.
2. Desde `frontend/`, ejecuta `npm ci` y `npm run dev`. Sin `frontend/.env`, el panel usa el proyecto de producción;
   para otro proyecto, copia `frontend/.env.example` a `frontend/.env` y rellénalo.
3. Para producción, el proyecto de Vercel compila `frontend/` (Root Directory `frontend`) al fusionar en `main`.

El Inicio muestra primero el chat y después «Hoy»: recordatorios y eventos del día, hábitos que tocan hoy y aún no se han contestado (con
«Hecho» y «Hoy no») y atajos para añadir. El botón «Añadir» de la barra superior crea un recordatorio, un gasto, un
ingreso, un evento o un hábito; propone la fecha de hoy (y, en los recordatorios, la próxima hora en punto) y, si
falla, lo escrito se queda en la ventana para corregirlo o reenviarlo. Los gastos e ingresos apuntados así se guardan
como `manual`, igual que las energéticas y el tabaco del chat. Los errores de conexión o del servidor se pueden
reintentar desde el propio aviso.

En Finanzas, «Buscar movimientos» filtra gastos e ingresos por texto, categoría (o solo ingresos) y fechas en el
servidor, en periodos de hasta dos años, y resume cuántos hay, lo gastado, lo ingresado y el balance. Los
presupuestos dicen en palabras cómo van: al 80 % avisan de que están cerca del límite y, si se superan, de cuánto; esos
avisos salen también arriba de Finanzas. La lupa de la barra superior (o la tecla «/») busca a la vez en
recordatorios, eventos de Google Calendar, hábitos, lista de la compra y movimientos, y lleva a la sección de cada
resultado.

La Agenda junta, por semanas o por meses, los eventos de Google Calendar, los recordatorios (con sus repeticiones) y
los hábitos de cada día, con icono, color y texto para distinguir cada tipo. En Hábitos se eligen los días en que
toca cada uno y se ven las últimas cuatro semanas: hecho, no hecho, sin apuntar o descanso. Los días de descanso no
cuentan como fallo ni rompen la racha; se puede marcar cualquier día de los últimos cuatro meses pulsándolo.

Mercados sigue índices y empresas (Yahoo Finance, sin API oficial), criptomonedas (CoinGecko) y divisas frente al
euro (Frankfurter, del BCE), todo gratis y sin clave. Empieza con el Nasdaq-100, las siete grandes tecnológicas, seis
criptomonedas y tres divisas (tabla `market_watchlist`), y se puede cambiar desde el panel o el chat («sigue AMD»,
«deja de seguir Tesla», «¿cómo va el bitcoin?»). Las cotizaciones se guardan 5 minutos; si una fuente falla se enseña
la última buena (de menos de una hora) avisando. CoinGecko se satura a veces: con `COINGECKO_API_KEY` (la clave «Demo»
gratuita) tiene más margen. Finanzas muestra arriba las cuatro primeras.

Precios compara un producto en tiendas españolas con Google Shopping a través de SerpApi (`SERPAPI_API_KEY`; el plan
gratis da 250 búsquedas al mes), de más barato a más caro y una oferta por tienda. Groq precisa antes la búsqueda («PS5» → «consola PlayStation 5») y
después elige las ofertas que son el producto en sí, nuevo (sin juegos, accesorios ni recambios); si Groq falla, se
quita lo que cuesta menos del 40 % de la mediana. Lo de segunda mano (Wallapop, Vinted, usado o reacondicionado) entra marcado como «2ª mano». También vigila hasta 5 productos: cada día a las 10:00 los busca y avisa por
Telegram si bajan del precio indicado o, sin precio, si bajan un 5 % o más. Las búsquedas a mano se paran cuando
quedan pocas, para no dejar sin ellas a la vigilancia. Desde el chat: «¿dónde está más barata la PS5?», «avísame si
la PS5 baja de 400 €», «deja de vigilar la PS5». Las tiendas bloquean que se lean sus webs, por eso hace falta SerpApi.

La curiosidad del día es un suceso de un día como hoy, de la Wikipedia en español; sale en el Inicio y al final del
resumen de la mañana (si Wikipedia falla, el resumen sale sin ella).

La sección Noticias enseña titulares por temas (destacadas, España, mundo, Madrid, economía, tecnología, ciencia,
salud, clima, deportes, cultura y gastronomía) desde los RSS públicos de El País, elDiario.es, 20minutos, La
Vanguardia, BBC Mundo, Telemadrid, Expansión y Xataka: sin clave ni coste. El Inicio muestra arriba un titular destacado; las secciones de gestión no intercalan noticias. `panel-api` los guarda 15 minutos en
memoria, descarta noticias de más de una semana y enlaces que no sean web, y si un medio falla enseña los demás.

En Ajustes se ven las cuentas conectadas (Google y el banco), desde cuándo y con qué permisos, y se pueden conectar
o desconectar. Los permisos de Google son los que Google dice que tiene el token, no los que se pidieron. También se
puede descargar una copia de todos los datos en .json (sin las claves de conexión) y borrar categorías de datos: hay
que escribir «BORRAR», y `panel-api` exige además `confirm=BORRAR` en la petición. Las conexiones no se borran desde
ahí sino desconectándolas, para que también se retire el permiso en Google o en el banco.

Móvil y accesibilidad: en pantallas pequeñas hay una barra inferior con Inicio, Agenda, Finanzas, Noticias y «Más»
(el menú completo, que se cierra con Esc), los botones miden al menos 44 px y los campos usan letra de 16 px para que
el iPhone no amplíe la página al escribir. Los colores cumplen el contraste AA y el foco del teclado siempre se ve. Se
comprueba con axe-core sección a sección a 390 y 1280 px.

Al abrirse, el panel pide todo lo que enseña en una sola petición (`resource=dashboard`): con una por recurso,
Supabase cortaba la ráfaga con 429. Si aun así llega un 429 de Supabase, el panel espera y reintenta una vez.

Seguridad del panel:

- Las tablas tienen RLS sin políticas y sin permisos para `anon` ni `authenticated`: el navegador no puede leerlas
  directamente con la clave publicable; todo pasa por `panel-api`.
- `panel-api` solo responde a CORS desde el dominio de producción, sus previsualizaciones de Vercel y `localhost`.
- Límite de 300 peticiones por minuto (abrir el panel ya hace unas 16), y de 10 para las que usan Groq (chat, notas
  de voz y saludo). Se cuentan en `panel_request_counts`.
- Los accesos denegados quedan en los logs de la función (sin el token) y, si hay 5 en 10 minutos, avisa por Telegram.
- Al navegador solo le llegan los mensajes de error pensados para el usuario (`UserFacingError`); el resto, genérico.
- `frontend/vercel.json` añade Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy` y
  `Permissions-Policy`. Si el panel empieza a usar otro dominio (una API, una fuente), hay que añadirlo a la CSP.

En el Inicio hay un chat con el asistente: entiende lo mismo que el bot de Telegram (gastos, compra, recordatorios…)
y contesta preguntas generales con el mismo modelo de Groq, teniendo en cuenta los últimos 10 mensajes de la
conversación. La conversación se guarda en la tabla `chat_messages`: al abrir el panel se ven los últimos 50 mensajes,
con sus botones, y «Nueva conversación» la borra entera. La de Telegram no se guarda.

Un «sí» o un «no» sueltos («ya», «hecho», «todavía no»…) contestan la pregunta de sí o no pendiente más reciente de
las últimas 24 horas, como si se pulsara su botón, sin llamar a Groq. En el panel valen los hábitos, las propuestas
para la memoria y la confirmación de desconectar; en Telegram, solo los hábitos, porque las demás preguntas guardadas
se hicieron en el panel.

La conexión con Google Calendar utiliza el mismo flujo OAuth del bot. El panel muestra los eventos del mes en curso.
El periodo de finanzas se elige entre 7, 30 y 90 días; los presupuestos siempre corresponden al mes actual.

## Navegación y comprobación del panel

Cada sección se puede abrir con `?section=agenda`, `?section=recordatorios`, etc. Los enlaces mantienen
Atrás/Adelante y admiten abrirse en una pestaña nueva. La sección se conserva al recargar y tras entrar;
una sección desconocida abre Inicio. La URL no incluye datos del panel. El menú agrupa Mi día, Consultas y
Mi asistente. El primer enlace permite saltar al contenido; al cambiar de sección se actualizan el título
de la pestaña y el foco del contenido. Los temas de Noticias se distribuyen en varias filas.

Los recordatorios proponen la próxima hora en punto de Madrid, incluida la fecha del día siguiente si
corresponde. La ayuda invita a revisar ambos campos antes de guardar.

Pruebas del frontend (Node 22.18 o posterior para ejecutar TypeScript nativo):

```bash
cd frontend
npm ci
npm test
npm run build
```

### Uso en móvil y reapertura

Inicio muestra primero el chat y después Hoy y cuatro accesos. Los próximos elementos y la actualidad
quedan plegados al final. Las tarjetas abren sus secciones mediante enlaces nativos. Se ocultan el
subtítulo del saludo y el bloque de resumen redundante.

La última sección se guarda en el dispositivo (solo su identificador, sin datos personales). Al reabrir
la app instalada en `/`, se recupera esa sección. Un enlace explícito siempre tiene prioridad, incluso
`?section=inicio`. Si el almacenamiento está bloqueado, la navegación por URL sigue funcionando.
Al cambiar de sección o pulsar Inicio se vuelve arriba; abrir el menú móvil también lo devuelve arriba.

### Inicio centrado en la conversación y el día

Inicio ordena el saludo, el chat compacto, el resumen de hoy y cuatro accesos (Finanzas, Hábitos,
Mercados y Precios). La compra sigue en el menú, sin tarjeta en Inicio. Los próximos planes y la
actualidad están plegados al final. El chat desplaza exclusivamente su historial interno.

El tiempo del resumen usa la fecha de Madrid: Stratesys de lunes a jueves y Villanueva de la Cañada
viernes, sábado y domingo. Se busca la previsión de hoy, sin sustituirla por otra ubicación o fecha.
El resumen incluye recordatorios, calendario, hábitos pendientes y los cumpleaños del día.

## Mejoras de uso del panel

- Notas: guardar texto y enlaces, buscar en las notas cargadas, editar y eliminar con margen para deshacer.
  La búsqueda global también incluye notas. El botón Añadir permite crear una nota.
- Chat: las peticiones de creación compatibles preparan un formulario editable. La preparación no escribe
  datos; los endpoints habituales vuelven a validar todo al confirmar. Las consultas y respuestas cortas
  mantienen el flujo habitual. Se conservan los flujos del bot de Telegram.
- Deshacer: los borrados normales de recordatorios, compra, cumpleaños, hábitos, peso, presupuestos, notas
  y seguimientos de precios esperan ocho segundos. Cancelar evita la petición DELETE. Cerrar la página
  cancela los temporizadores que aún no hayan empezado. Borrados masivos y desconexiones no usan esta cola.
- Resumen diario: destaca el próximo evento/recordatorio y los recordatorios anteriores pendientes. Desde
  las 19:00, si no queda nada pendiente, prepara el día siguiente, con su previsión meteorológica.
- Finanzas: compara el mes hasta hoy con el mismo tramo del mes anterior. Sugiere posibles cargos recurrentes
  solo con tres meses de importes estables e intervalos mensuales. La comparativa marca las cargas parciales.
- Precios: permite editar el precio objetivo del seguimiento existente y muestra la última comprobación.
- Actualización: el panel indica la última carga completa y conserva datos previos ante un fallo parcial.
  No guarda información personal ni borrados pendientes en almacenamiento local.

Las nuevas rutas de panel-api conservan la validación de sesión, la lista de cuentas autorizadas y los
límites de peticiones. No requieren cambios de esquema ni nuevos permisos. Desplegar panel-api antes de la interfaz.

Pruebas adicionales:

```bash
cd frontend
npm ci
npm test
npm run test:ui
npm run build
```

`test:ui` usa datos ficticios y comprueba Notas, propuestas editables, datos antiguos y cancelación/ejecución
de borrados diferidos. No accede a una cuenta ni llama a los servicios reales.

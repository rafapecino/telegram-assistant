import { assertEquals } from "jsr:@std/assert@1.0.19";
import { UserFacingError } from "./errors.ts";
import {
  corsHeaders,
  describeErrorForClient,
  isAllowedOrigin,
  isOverRateLimit,
  recordAccessDenied,
} from "./panel-security.ts";
import { fakeDb, TELEGRAM_ENV, withFakeFetch } from "./testing.ts";

/** Base de datos cuyo contador devuelve `hits` para cada grupo de peticiones. */
function dbCounting(hits: Record<string, number>) {
  return fakeDb((query) => {
    const bucket = Object.keys(hits).find((name) => query[0].includes(`"bucket_name":"${name}`));
    return { data: bucket ? hits[bucket] : 1 };
  });
}

Deno.test("solo responde a CORS desde el panel, sus previsualizaciones y local", () => {
  assertEquals(isAllowedOrigin("https://telegram-assistant-preview.vercel.app"), true);
  assertEquals(
    isAllowedOrigin("https://telegram-assistant-preview-git-claude-x-rafapecinos-projects.vercel.app"),
    true,
  );
  assertEquals(isAllowedOrigin("http://localhost:5173"), true);
  assertEquals(isAllowedOrigin("https://evil.example"), false);
  assertEquals(isAllowedOrigin("https://telegram-assistant-preview.vercel.app.evil.example"), false);
  assertEquals(isAllowedOrigin("https://telegram-assistant-preview-x-otro-equipo.vercel.app"), false);
  assertEquals(isAllowedOrigin(null), false);
});

Deno.test("a un origen ajeno no le da la cabecera que permite leer la respuesta", () => {
  assertEquals(corsHeaders("https://evil.example"), { Vary: "Origin" });
  assertEquals(
    corsHeaders("http://localhost:5173")["Access-Control-Allow-Origin"],
    "http://localhost:5173",
  );
});

Deno.test("limita a 300 peticiones por minuto y a 10 las que gastan cuota de Groq o SerpApi", async () => {
  assertEquals(await isOverRateLimit(dbCounting({ "user:": 300 }).db, "u1", "GET", "notes"), false);
  assertEquals(await isOverRateLimit(dbCounting({ "user:": 301 }).db, "u1", "GET", "notes"), true);
  // Las que no gastan cuota externa no cuentan en su límite.
  const { db, queries } = dbCounting({ "quota:": 11 });
  assertEquals(await isOverRateLimit(db, "u1", "GET", "notes"), false);
  assertEquals(queries.length, 1);
  assertEquals(await isOverRateLimit(dbCounting({ "quota:": 11 }).db, "u1", "POST", "chat"), true);
  assertEquals(await isOverRateLimit(dbCounting({ "quota:": 10 }).db, "u1", "POST", "transcribe"), false);
  assertEquals(await isOverRateLimit(dbCounting({ "quota:": 11 }).db, "u1", "GET", "greeting"), true);
  assertEquals(await isOverRateLimit(dbCounting({ "quota:": 11 }).db, "u1", "GET", "prices"), true);
});

Deno.test("cada usuario tiene su contador, por minuto", async () => {
  const { db, queries } = dbCounting({});
  await isOverRateLimit(db, "u1", "POST", "chat");
  assertEquals(queries, [
    ['rpc("count_panel_request", {"bucket_name":"user:u1","window_seconds":60})'],
    ['rpc("count_panel_request", {"bucket_name":"quota:u1","window_seconds":60})'],
  ]);
});

Deno.test("avisa por Telegram al quinto acceso denegado en 10 minutos, y solo entonces", async () => {
  for (const [denied, isAlerted] of [[4, false], [5, true], [6, false]] as const) {
    const { db, queries } = dbCounting({ access_denied: denied });
    await withFakeFetch(TELEGRAM_ENV, () => Response.json({ ok: true, result: { message_id: 1 } }), async (requests) => {
      await recordAccessDenied(db, "sesión no válida");
      assertEquals(requests.length, isAlerted ? 1 : 0);
      if (isAlerted) {
        const sent = await requests[0].json();
        assertEquals(sent.text.includes("5 accesos") && sent.text.includes("sesión no válida"), true);
      }
    });
    assertEquals(queries[0], ['rpc("count_panel_request", {"bucket_name":"access_denied","window_seconds":600})']);
  }
});

Deno.test("al navegador solo le llega el mensaje de los errores pensados para el usuario", () => {
  assertEquals(describeErrorForClient(new UserFacingError("Mes no válido.")), {
    status: 400,
    message: "Mes no válido.",
  });
  assertEquals(describeErrorForClient(new Error("Groq respondió 401: invalid api key gsk_...")), {
    status: 500,
    message: "No se pudo completar la operación. Inténtalo de nuevo.",
  });
  assertEquals(describeErrorForClient("texto suelto").status, 500);
});

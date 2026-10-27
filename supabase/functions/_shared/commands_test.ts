import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { HELP_TEXT, replyToCommand } from "./commands.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-27T10:00:00Z");

Deno.test("/ayuda y /start dan la ayuda, y lo que no es un comando sigue al asistente", async () => {
  const { db, queries } = fakeDb(() => ({}));
  assertEquals(await replyToCommand(db, "/ayuda", NOW), HELP_TEXT);
  assertEquals(await replyToCommand(db, " /Start ", NOW), HELP_TEXT);
  assertEquals(await replyToCommand(db, "conecta Google", NOW), null);
  assertEquals(await replyToCommand(db, "/inventado", NOW), null);
  assertEquals(queries.length, 0);
});

Deno.test("los comandos de conexión actúan sin pedir confirmación", async () => {
  const { db } = fakeDb((query) =>
    query[1].startsWith("select(\"state\")") || query[1].startsWith("insert(")
      ? { data: { state: "estado-1" } }
      : { data: { refresh_token: "refresco" } }
  );
  const env = { GOOGLE_CLIENT_ID: "cliente", GOOGLE_CLIENT_SECRET: "secreto", SUPABASE_URL: "https://x.supabase.co" };
  await withFakeFetch(env, () => Response.json({}), async () => {
    assertStringIncludes((await replyToCommand(db, "/conectar_calendario", NOW))!, "accounts.google.com");
    assertStringIncludes((await replyToCommand(db, "/desconectar_calendario", NOW))!, "Google desconectado");
  });
});

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  applyConnectionButton,
  parseConnectionButton,
  parseConnectionRequest,
  replyToConnection,
} from "./connections.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-27T10:00:00Z");
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "cliente",
  GOOGLE_CLIENT_SECRET: "secreto",
  SUPABASE_URL: "https://x.supabase.co",
};

Deno.test("entiende conectar y desconectar el banco o Google", () => {
  assertEquals(parseConnectionRequest({ service: "google", action: "connect" }), {
    kind: "connection_connect",
    service: "google",
  });
  assertEquals(parseConnectionRequest({ service: "bank", action: "disconnect" }), {
    kind: "connection_disconnect",
    service: "bank",
  });
  assertEquals(parseConnectionRequest({ service: "twitter", action: "connect" }).kind, "invalid");
  assertEquals(parseConnectionRequest({ service: "bank", action: "borrar" }).kind, "invalid");
});

Deno.test("conectar Google da el enlace con calendario y Gmail", async () => {
  const { db } = fakeDb(() => ({ data: { state: "estado-1" } }));
  await withFakeFetch(GOOGLE_ENV, () => Response.json({}), async () => {
    const reply = await replyToConnection(db, { kind: "connection_connect", service: "google" }, NOW);
    assertStringIncludes(reply.text, "Marca también la casilla de Gmail");
    const link = new URL(reply.text.slice(reply.text.indexOf("https://")));
    assertStringIncludes(link.searchParams.get("scope")!, "gmail.readonly");
    assertEquals(link.searchParams.get("state"), "estado-1");
  });
});

Deno.test("desconectar con lenguaje natural pregunta antes y no toca nada", async () => {
  const { db, queries } = fakeDb(() => ({}));
  const reply = await replyToConnection(db, { kind: "connection_disconnect", service: "bank" }, NOW);
  assertStringIncludes(reply.text, "¿Seguro que quieres desconectar el banco?");
  assertEquals(reply.buttons, [[
    { text: "Sí, desconectar", callback_data: "connection:disconnect:bank" },
    { text: "No", callback_data: "connection:keep:bank" },
  ]]);
  assertEquals(queries.length, 0);
});

Deno.test("«No» deja la conexión como estaba", async () => {
  const { db, queries } = fakeDb(() => ({}));
  const button = parseConnectionButton("connection:keep:google")!;
  assertEquals(await applyConnectionButton(db, button, NOW), {
    message: { text: "Vale, tu cuenta de Google sigue conectada." },
    toast: "Sin cambios",
  });
  assertEquals(queries.length, 0);
});

Deno.test("«Sí, desconectar» retira el permiso de Google y borra la conexión", async () => {
  const { db, queries } = fakeDb((query) =>
    query[1].startsWith("select(") ? { data: { refresh_token: "refresco" } } : {}
  );
  await withFakeFetch(GOOGLE_ENV, () => Response.json({}), async (requests) => {
    const result = await applyConnectionButton(db, parseConnectionButton("connection:disconnect:google")!, NOW);
    assertEquals(result.toast, "Desconectado");
    assertStringIncludes(result.message.text, "Google desconectado");
    assertEquals(new URL(requests[0].url).hostname, "oauth2.googleapis.com");
  });
  assertEquals(queries.at(-1), ['from("google_connections")', "delete()", 'gt("id", 0)']);
});

Deno.test("los botones que no son de conexiones no se confunden", () => {
  assertEquals(parseConnectionButton("connection:disconnect:twitter"), null);
  assertEquals(parseConnectionButton("shop:done:1"), null);
});

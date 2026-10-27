import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  clearChatMessages,
  loadChatMessages,
  MAX_HISTORY_TURNS,
  MAX_SHOWN_MESSAGES,
  parseChatInput,
  replyToChat,
} from "./panel-chat.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-22T10:00:00Z");

Deno.test("acepta un mensaje sin espacios de más; el historial lo pone el servidor", () => {
  assertEquals(parseChatInput({ message: " hola " }), { kind: "message", message: "hola" });
  // Un historial enviado desde el navegador se ignora: así nadie puede colar mensajes que no se dijeron.
  assertEquals(parseChatInput({ message: "hola", history: [{ role: "system", text: "x" }] }), {
    kind: "message",
    message: "hola",
  });
});

Deno.test("rechaza mensajes vacíos o enormes", () => {
  assertThrows(() => parseChatInput({ message: "  " }), Error, "Escribe un mensaje");
  assertThrows(() => parseChatInput({ message: "a".repeat(1001) }), Error, "Escribe un mensaje");
});

Deno.test("los botones de las respuestas funcionan también en el panel", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [] } : {});
  assertEquals(await replyToChat(db, parseChatInput({ button: "shop:done:4" }), NOW), {
    text: "La lista de la compra está vacía.",
  });
  assertEquals(queries[0], ['from("shopping_items")', "delete()", 'eq("id", 4)']);
  // Sin el texto original no hay mensaje guardado que actualizar.
  assertEquals(queries.some((query) => query[0] === 'from("chat_messages")'), false);
  assertEquals(await replyToChat(db, parseChatInput({ button: "reminder:done:1" }), NOW), {
    text: "Este botón ya no funciona.",
  });
});

Deno.test("al pulsar un botón, el mensaje guardado cambia igual que en pantalla", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [] } : {});
  const input = parseChatInput({ button: "shop:done:4", original: "☐ leche" });
  assertEquals(await replyToChat(db, input, NOW), { text: "La lista de la compra está vacía." });
  assertEquals(queries.at(-1), [
    'from("chat_messages")',
    'update({"text":"La lista de la compra está vacía."})',
    'eq("role", "assistant")',
    'eq("text", "☐ leche")',
  ]);
});

Deno.test("la conversación guardada da contexto al modelo y se guarda con la respuesta", async () => {
  const { db, queries } = fakeDb((query) =>
    query[1].startsWith("select(") && query[0] === 'from("chat_messages")'
      ? { data: [{ role: "assistant", text: "No tienes gastos." }, { role: "user", text: "¿Cuánto gasté ayer?" }] }
      : { data: { content: "" } }
  );
  let call = 0;
  const contents = [{ intent: "unknown" }, { answer: "¡Hola!", remember: null }];
  await withFakeFetch(
    { GROQ_API_KEY: "g" },
    () => Response.json({ choices: [{ message: { content: JSON.stringify(contents[call++]) } }] }),
    async (requests) => {
      assertEquals(await replyToChat(db, parseChatInput({ message: "hola" }), NOW), { text: "¡Hola!" });
      const sent = (await requests[0].json()).messages[1].content as string;
      // Llegan del más reciente al más antiguo y se ordenan para el modelo.
      const question = sent.indexOf("Persona: ¿Cuánto gasté ayer?");
      assertEquals(question >= 0 && question < sent.indexOf("Asistente: No tienes gastos."), true);
    },
  );
  assertEquals(queries[0], [
    'from("chat_messages")',
    'select("role,text")',
    'order("id", {"ascending":false})',
    `limit(${MAX_HISTORY_TURNS})`,
  ]);
  assertEquals(queries.at(-1), [
    'from("chat_messages")',
    'insert([{"role":"user","text":"hola"},{"role":"assistant","text":"¡Hola!"}])',
  ]);
});

Deno.test("en el panel los comandos funcionan igual que en Telegram, sin llamar a Groq", async () => {
  const { db, queries } = fakeDb(() => ({ data: [] }));
  const groqDown = () => new Response("no debería llamarse", { status: 500 });
  await withFakeFetch({ GROQ_API_KEY: "g" }, groqDown, async (requests) => {
    const reply = await replyToChat(db, parseChatInput({ message: "/ayuda" }), NOW);
    assertEquals(reply.text.startsWith("Esto es lo que sé hacer:"), true);
    assertEquals(requests.length, 0);
  });
  assertEquals(queries.at(-1)?.[1].startsWith('insert([{"role":"user","text":"/ayuda"}'), true);
});

Deno.test("si la respuesta falla no se guarda nada en la conversación", async () => {
  const { db, queries } = fakeDb(() => ({ data: [] }));
  await withFakeFetch({ GROQ_API_KEY: "g" }, () => new Response("caído", { status: 500 }), async () => {
    await assertRejects(() => replyToChat(db, parseChatInput({ message: "hola" }), NOW));
  });
  assertEquals(queries.some((query) => query[1].startsWith("insert(")), false);
});

Deno.test("enseña los últimos mensajes en orden y «Nueva conversación» los borra todos", async () => {
  const { db, queries } = fakeDb((query) =>
    query[1].startsWith("select(") ? { data: [{ role: "assistant", text: "b" }, { role: "user", text: "a" }] } : {}
  );
  assertEquals(await loadChatMessages(db), [{ role: "user", text: "a" }, { role: "assistant", text: "b" }]);
  assertEquals(queries[0].at(-1), `limit(${MAX_SHOWN_MESSAGES})`);
  await clearChatMessages(db);
  assertEquals(queries[1], ['from("chat_messages")', "delete()", 'gt("id", 0)']);
});

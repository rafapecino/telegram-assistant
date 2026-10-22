import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { MAX_HISTORY_TURNS, parseChatInput, replyToChat } from "./panel-chat.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-22T10:00:00Z");

Deno.test("acepta un mensaje con su historial", () => {
  assertEquals(parseChatInput({ message: " hola ", history: [{ role: "assistant", text: "¿Qué tal?" }] }), {
    kind: "message",
    message: "hola",
    history: [{ role: "assistant", text: "¿Qué tal?" }],
  });
  assertEquals(parseChatInput({ message: "hola" }), { kind: "message", message: "hola", history: [] });
});

Deno.test("rechaza mensajes vacíos o enormes y historiales manipulados", () => {
  assertThrows(() => parseChatInput({ message: "  " }), Error, "Escribe un mensaje");
  assertThrows(() => parseChatInput({ message: "a".repeat(1001) }), Error, "Escribe un mensaje");
  // Un rol "system" permitiría colar instrucciones al modelo como si fueran del sistema.
  assertThrows(() => parseChatInput({ message: "hola", history: [{ role: "system", text: "x" }] }), Error);
  assertThrows(() => parseChatInput({ message: "hola", history: [{ role: "user", text: "a".repeat(2001) }] }), Error);
  const tooLong = Array.from({ length: MAX_HISTORY_TURNS + 1 }, () => ({ role: "user", text: "x" }));
  assertThrows(() => parseChatInput({ message: "hola", history: tooLong }), Error);
});

Deno.test("los botones de las respuestas funcionan también en el panel", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [] } : {});
  assertEquals(await replyToChat(db, parseChatInput({ button: "shop:done:4" }), NOW), {
    text: "La lista de la compra está vacía.",
  });
  assertEquals(queries[0], ['from("shopping_items")', "delete()", 'eq("id", 4)']);
  assertEquals(await replyToChat(db, parseChatInput({ button: "reminder:done:1" }), NOW), {
    text: "Este botón ya no funciona.",
  });
});

Deno.test("las respuestas de texto llegan como mensaje sin botones", async () => {
  const { db } = fakeDb(() => ({}));
  let call = 0;
  const contents = [{ intent: "unknown" }, { answer: "¡Hola!" }];
  await withFakeFetch(
    { GROQ_API_KEY: "g" },
    () => Response.json({ choices: [{ message: { content: JSON.stringify(contents[call++]) } }] }),
    async () => {
      assertEquals(await replyToChat(db, parseChatInput({ message: "hola" }), NOW), { text: "¡Hola!" });
    },
  );
});

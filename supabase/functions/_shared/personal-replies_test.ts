import { assertEquals } from "jsr:@std/assert@1.0.19";
import { applyPersonalButton, replyToPersonalIntent } from "./personal-replies.ts";
import { fakeDb } from "./testing.ts";

const NOW = new Date("2026-10-22T10:00:00Z");

Deno.test("añadir a la compra responde con la lista y un botón por cosa", async () => {
  const { db } = fakeDb((query) => query[1].startsWith("select(") ? { data: [{ id: 4, text: "leche" }] } : {});
  const reply = await replyToPersonalIntent(db, { kind: "shopping_add", items: ["leche"] }, NOW);
  assertEquals(reply?.buttons, [[{ text: "☐ leche", callback_data: "shop:done:4" }]]);
});

Deno.test("apuntar un hábito que no existe explica cómo empezarlo", async () => {
  const { db } = fakeDb(() => ({ data: [{ id: 1, name: "Leer" }] }));
  const reply = await replyToPersonalIntent(db, { kind: "habit_log", name: "Correr", done: true }, NOW);
  assertEquals(reply?.text, "No sigues ningún hábito «Correr». Para empezar, dime «quiero Correr cada día».");
});

Deno.test("sin calendario conectado responde cómo conectarlo en vez de fallar", async () => {
  const { db } = fakeDb(() => ({ data: null }));
  const reply = await replyToPersonalIntent(
    db,
    { kind: "calendar_list", dateFrom: "2026-10-23", dateTo: "2026-10-23" },
    NOW,
  );
  assertEquals(reply?.text, "No tienes el calendario conectado. Conéctalo con /conectar_calendario.");
});

Deno.test("las intenciones de otras funcionalidades no las responde", async () => {
  const { db, queries } = fakeDb(() => ({}));
  assertEquals(await replyToPersonalIntent(db, { kind: "unknown" }, NOW), null);
  assertEquals(queries.length, 0);
});

Deno.test("tachar una cosa la borra y vuelve a enseñar la lista", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [] } : {});
  const result = await applyPersonalButton(db, "shop:done:4");
  assertEquals(queries[0], ['from("shopping_items")', "delete()", 'eq("id", 4)']);
  assertEquals(result, { message: { text: "La lista de la compra está vacía." }, toast: "Tachado" });
});

Deno.test("contestar a un hábito ya borrado no apunta nada", async () => {
  const { db, queries } = fakeDb(() => ({ data: [] }));
  const result = await applyPersonalButton(db, "habit:yes:9:2026-10-22");
  assertEquals(result?.message.text, "Ya no sigues este hábito.");
  assertEquals(queries.length, 1);
  assertEquals(await applyPersonalButton(db, "reminder:done:1"), null);
});

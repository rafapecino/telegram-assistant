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

const AGENDA_DATA: Record<string, unknown> = {
  'from("reminders")': [{ text: "Revisar agenda", remind_at: "2026-10-22T08:00:00Z" }],
  'from("habits")': [{ id: 1, name: "Leer", scheduled_days: [4] }, { id: 2, name: "Correr", scheduled_days: [1] }],
  'from("habit_checks")': [{ habit_id: 1, date: "2026-10-22", done: true }],
  'from("birthdays")': [{ id: 1, name: "Mamá", month: 10, day: 22, year: 1966 }],
};

Deno.test("qué tengo hoy: recordatorios, hábitos que tocan, cumpleaños y aviso de calendario sin conectar", async () => {
  const { db, queries } = fakeDb((query) => ({ data: AGENDA_DATA[query[0]] ?? null }));
  const reply = await replyToPersonalIntent(
    db,
    { kind: "calendar_list", dateFrom: "2026-10-22", dateTo: "2026-10-22" },
    NOW,
  );
  assertEquals(queries[0].slice(2, 4), [
    'gte("remind_at", "2026-10-21T22:00:00.000Z")',
    'lt("remind_at", "2026-10-22T22:00:00.000Z")',
  ]);
  assertEquals(
    reply?.text,
    "Recordatorios:\n• jueves, 22 de octubre, 10:00 · Revisar agenda\n\n" +
      "Hábitos:\n• Leer: ✅ hecho\n\n" +
      "Cumpleaños:\n• 22 de octubre: Mamá (60)\n\n" +
      "No tienes el calendario conectado. Conéctalo con /conectar_calendario.",
  );
});

Deno.test("varios días: sin hábitos y sin secciones vacías", async () => {
  const { db, queries } = fakeDb((query) => ({ data: query[0] === 'from("google_connections")' ? null : [] }));
  const reply = await replyToPersonalIntent(
    db,
    { kind: "calendar_list", dateFrom: "2026-10-23", dateTo: "2026-10-30" },
    NOW,
  );
  assertEquals(queries.some((query) => query[0] === 'from("habits")'), false);
  assertEquals(
    reply?.text,
    "No tienes recordatorios esos días.\n\nNo tienes el calendario conectado. Conéctalo con /conectar_calendario.",
  );
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

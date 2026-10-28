import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  answerPendingQuestion,
  findPendingButton,
  parseQuickAnswer,
  updateMessagesWithButton,
} from "./chat-questions.ts";
import { habitButtons } from "./habits.ts";
import { fakeDb, TELEGRAM_ENV, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-22T20:00:00Z");
const MEMORY_QUESTION = [[
  { text: "🧠 Guárdalo", callback_data: "memory:yes:7" },
  { text: "No", callback_data: "memory:no:7" },
]];
const SHOPPING_LIST = [[{ text: "☐ leche", callback_data: "shop:done:1" }]];

/** Base de datos cuyas preguntas guardadas, de la más reciente a la más antigua, son `pending`. */
function dbWithPending(pending: unknown[][][]) {
  return fakeDb((query) =>
    query[0] === 'from("chat_messages")' && query[1].startsWith("select(")
      ? { data: pending.map((buttons) => ({ buttons })) }
      : { data: [] }
  );
}

Deno.test("entiende un «sí» o un «no» sueltos, con o sin tildes y signos", () => {
  for (const text of ["sí", "Si", "SÍ!", "ya", "hecho ✅", "Sí, lo he hecho", "vale.", "ok"]) {
    assertEquals(parseQuickAnswer(text), true, text);
  }
  for (const text of ["no", "No.", "todavía no", "aún no", "hoy no"]) assertEquals(parseQuickAnswer(text), false, text);
  for (const text of ["sí, apunta 5 € de café", "no sé", "si mañana llueve avísame", ""]) {
    assertEquals(parseQuickAnswer(text), null, text);
  }
});

Deno.test("contesta la pregunta más reciente de las últimas 24 horas y salta las que no son de sí o no", async () => {
  const { db, queries } = dbWithPending([SHOPPING_LIST, habitButtons(3, "2026-10-22"), habitButtons(2, "2026-10-22")]);
  assertEquals(await findPendingButton(db, true, "panel", NOW), "habit:yes:3:2026-10-22");
  assertEquals(await findPendingButton(db, false, "panel", NOW), "habit:no:3:2026-10-22");
  assertEquals(queries[0].includes('gte("created_at", "2026-10-21T20:00:00.000Z")'), true);
  assertEquals(await findPendingButton(dbWithPending([SHOPPING_LIST]).db, true, "panel", NOW), null);
});

Deno.test("en Telegram solo cuentan los hábitos: las demás preguntas se hicieron en el panel", async () => {
  const pending = [MEMORY_QUESTION, habitButtons(2, "2026-10-22")];
  assertEquals(await findPendingButton(dbWithPending(pending).db, true, "panel", NOW), "memory:yes:7");
  assertEquals(await findPendingButton(dbWithPending(pending).db, true, "telegram", NOW), "habit:yes:2:2026-10-22");
  assertEquals(await findPendingButton(dbWithPending([MEMORY_QUESTION]).db, true, "telegram", NOW), null);
});

Deno.test("sin pregunta pendiente, o si no es un «sí» o un «no», no hace nada", async () => {
  const { db, queries } = dbWithPending([]);
  assertEquals(await answerPendingQuestion(db, "sí", "panel", NOW), null);
  assertEquals(await answerPendingQuestion(db, "apunta 5 € de café", "panel", NOW), null);
  assertEquals(queries.length, 1);
});

Deno.test("al contestar, actualiza el mensaje del chat y su copia de Telegram", async () => {
  const { db, queries } = fakeDb((query) =>
    query.at(-1) === 'select("telegram_message_id")'
      ? { data: [{ telegram_message_id: 55 }, { telegram_message_id: null }, { telegram_message_id: 60 }] }
      : {}
  );
  await withFakeFetch(TELEGRAM_ENV, () => Response.json({ ok: true, result: {} }), async (requests) => {
    await updateMessagesWithButton(db, "habit:yes:2:2026-10-22", { text: "✅ Correr" }, 60);
    // El 60 es el que Telegram ya ha actualizado al pulsar allí.
    assertEquals(requests.length, 1);
    const body = await requests[0].json();
    assertEquals([body.message_id, body.text, body.reply_markup], [55, "✅ Correr", undefined]);
  });
  assertEquals(queries[0][1], 'update({"text":"✅ Correr","buttons":null})');
});

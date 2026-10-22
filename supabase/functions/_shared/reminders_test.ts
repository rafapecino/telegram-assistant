import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  applyReminderButton,
  nextOccurrence,
  nextOccurrenceAfter,
  parseReminderButton,
  parseReminderRequest,
  sendDueReminders,
  snoozeUntil,
} from "./reminders.ts";
import { fakeDb, withTelegram } from "./testing.ts";

const NOW = new Date("2026-10-21T10:00:00Z");

Deno.test("acepta un recordatorio válido y convierte la hora de Madrid", () => {
  assertEquals(parseReminderRequest({ text: " llamar a Juan ", local_datetime: "2026-10-22T17:00" }, NOW), {
    kind: "reminder",
    text: "llamar a Juan",
    remindAt: new Date("2026-10-22T15:00:00Z"),
    repeat: null,
  });
});

Deno.test("rechaza fechas pasadas, mal formadas o textos vacíos", () => {
  assertEquals(parseReminderRequest({ text: "x", local_datetime: "2026-10-20T10:00" }, NOW), {
    kind: "invalid",
    message: "No he creado el recordatorio: la fecha que he entendido ya ha pasado.",
  });
  assertEquals(parseReminderRequest({ text: "x", local_datetime: "el jueves" }, NOW).kind, "invalid");
  assertEquals(parseReminderRequest({ text: "  ", local_datetime: "2026-10-22T17:00" }, NOW).kind, "invalid");
});

Deno.test("un recordatorio que se repite guarda cada cuánto, y una repetición desconocida se rechaza", () => {
  const weekly = parseReminderRequest({ text: "basura", local_datetime: "2026-10-26T21:00", repeat: "weekly" }, NOW);
  assertEquals(weekly.kind === "reminder" && weekly.repeat, "weekly");
  const yearly = parseReminderRequest({ text: "x", local_datetime: "2026-10-26T21:00", repeat: "yearly" }, NOW);
  assertEquals(yearly, {
    kind: "invalid",
    message: "No he creado el recordatorio: no he entendido cada cuánto se repite.",
  });
});

Deno.test("de lunes a viernes que empieza en sábado arranca el lunes a la misma hora", () => {
  // 24 de octubre de 2026 es sábado; el lunes 26 ya es horario de invierno (UTC+1).
  const request = parseReminderRequest({ text: "fichar", local_datetime: "2026-10-24T08:00", repeat: "weekdays" }, NOW);
  assertEquals(request.kind === "reminder" && request.remindAt, new Date("2026-10-26T07:00:00Z"));
});

Deno.test("cada día mantiene la hora local aunque cambie la hora (25 de octubre)", () => {
  // Sábado 24 a las 9:00 de verano (07:00 UTC) → domingo 25 a las 9:00 de invierno (08:00 UTC).
  assertEquals(nextOccurrence(new Date("2026-10-24T07:00:00Z"), "daily", null), new Date("2026-10-25T08:00:00Z"));
});

Deno.test("de lunes a viernes salta del viernes al lunes y cada semana suma siete días", () => {
  assertEquals(nextOccurrence(new Date("2026-10-23T07:00:00Z"), "weekdays", null), new Date("2026-10-26T08:00:00Z"));
  assertEquals(nextOccurrence(new Date("2026-11-02T08:00:00Z"), "weekly", null), new Date("2026-11-09T08:00:00Z"));
});

Deno.test("cada mes el día 31 pasa al último día de los meses cortos y vuelve al 31", () => {
  const february = nextOccurrence(new Date("2027-01-31T08:00:00Z"), "monthly", 31);
  assertEquals(february, new Date("2027-02-28T08:00:00Z"));
  // 31 de marzo ya es horario de verano (UTC+2).
  assertEquals(nextOccurrence(february, "monthly", 31), new Date("2027-03-31T07:00:00Z"));
  assertEquals(nextOccurrence(new Date("2026-12-15T08:00:00Z"), "monthly", 15), new Date("2027-01-15T08:00:00Z"));
});

Deno.test("si el bot ha estado parado, la siguiente vez salta a la primera que aún no ha pasado", () => {
  // Diario a las 9:00 desde el 1 de octubre; ahora son las 12:00 del 21 → toca el 22 a las 9:00.
  assertEquals(
    nextOccurrenceAfter(new Date("2026-10-01T07:00:00Z"), "daily", null, NOW),
    new Date("2026-10-22T07:00:00Z"),
  );
});

Deno.test("lee los botones del aviso y descarta los que no son de un recordatorio", () => {
  assertEquals(parseReminderButton("reminder:1h:12"), { action: "1h", reminderId: 12 });
  assertEquals(parseReminderButton("reminder:tomorrow:7"), { action: "tomorrow", reminderId: 7 });
  assertEquals(parseReminderButton("reminder:borrar:7"), null);
  assertEquals(parseReminderButton("otra:cosa"), null);
});

Deno.test("posponer a mañana es a las 9:00 del día siguiente en Madrid, aunque en UTC aún sea hoy", () => {
  // 22:30 UTC del 21 son las 00:30 del 22 en Madrid: mañana es el 23.
  assertEquals(snoozeUntil("tomorrow", new Date("2026-10-21T22:30:00Z")), new Date("2026-10-23T07:00:00Z"));
  assertEquals(snoozeUntil("1h", NOW), new Date("2026-10-21T11:00:00Z"));
});

Deno.test("posponer crea un recordatorio nuevo de una sola vez y el aviso lo dice", async () => {
  const { db, queries } = fakeDb((query) =>
    query.includes("maybeSingle()") ? { data: { text: "llamar a Juan" }, error: null } : { error: null }
  );
  const text = await applyReminderButton(db, { action: "1h", reminderId: 3 }, NOW);
  assertStringIncludes(text, "Pospuesto al miércoles, 21 de octubre, 13:00");
  assertEquals(queries[1][0], 'from("reminders")');
  assertStringIncludes(queries[1][1], '"text":"llamar a Juan","remind_at":"2026-10-21T11:00:00.000Z"');
  assertStringIncludes(queries[1][1], '"repeat":null');
});

Deno.test("el aviso lleva botones y los que se repiten se reprograman para la siguiente vez", async () => {
  const due = [
    { id: 1, text: "una vez", remind_at: "2026-10-21T10:00:00Z", repeat: null, repeat_day: null, advance_minutes: 30 },
    {
      id: 2,
      text: "cada semana",
      remind_at: "2026-10-21T10:00:00Z",
      repeat: "weekly",
      repeat_day: null,
      advance_minutes: 30,
    },
  ];
  const { db, queries } = fakeDb((query) => {
    if (query.some((step) => step.startsWith('update({"advance_notified_at"'))) return { data: [] };
    return query.some((step) => step.startsWith("select(")) ? { data: due } : {};
  });
  await withTelegram(async (requests) => {
    assertEquals(await sendDueReminders(db, NOW), 2);
    const sent = await Promise.all(requests.map((request) => request.json()));
    assertEquals(sent.map((message) => message.text), ["⏰ una vez", "⏰ cada semana"]);
    assertEquals(
      sent[0].reply_markup.inline_keyboard[0].map((button: { callback_data: string }) => button.callback_data),
      [
        "reminder:done:1",
        "reminder:1h:1",
        "reminder:tomorrow:1",
      ],
    );
  });
  // Solo el semanal se vuelve a programar: siete días después, sin marcar como enviado y con su aviso previo.
  assertEquals(queries.length, 3);
  assertEquals(queries[2].slice(1), [
    'update({"remind_at":"2026-10-28T11:00:00.000Z","sent_at":null,"advance_at":"2026-10-28T10:30:00.000Z",' +
    '"advance_notified_at":null})',
    'eq("id", 2)',
  ]);
});

Deno.test("el aviso previo llega antes de la hora y sin botones", async () => {
  const { db } = fakeDb((query) =>
    query.some((step) => step.startsWith('update({"advance_notified_at"'))
      ? { data: [{ id: 5, text: "dentista", remind_at: "2026-10-21T10:30:00Z" }] }
      : { data: [] }
  );
  await withTelegram(async (requests) => {
    assertEquals(await sendDueReminders(db, NOW), 0);
    const sent = await Promise.all(requests.map((request) => request.json()));
    assertEquals(sent.map((message) => message.text), [
      "🔔 Aviso previo: dentista\n📅 miércoles, 21 de octubre, 12:30",
    ]);
    assertEquals(sent[0].reply_markup, undefined);
  });
});

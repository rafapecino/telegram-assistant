import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parseReminderInterpretation } from "./reminders.ts";

const NOW = new Date("2026-10-21T10:00:00Z");

Deno.test("acepta un recordatorio válido y convierte la hora de Madrid", () => {
  const result = parseReminderInterpretation(
    { is_reminder: true, text: " llamar a Juan ", local_datetime: "2026-10-22T17:00" },
    NOW,
  );
  assertEquals(result, {
    kind: "reminder",
    text: "llamar a Juan",
    remindAt: new Date("2026-10-22T15:00:00Z"),
  });
});

Deno.test("un mensaje que no es un recordatorio se marca como tal", () => {
  assertEquals(parseReminderInterpretation({ is_reminder: false }, NOW), { kind: "not_reminder" });
  assertEquals(parseReminderInterpretation(null, NOW), { kind: "not_reminder" });
});

Deno.test("rechaza fechas pasadas, mal formadas o textos vacíos", () => {
  assertEquals(
    parseReminderInterpretation({ is_reminder: true, text: "x", local_datetime: "2026-10-20T10:00" }, NOW).kind,
    "invalid",
  );
  assertEquals(
    parseReminderInterpretation({ is_reminder: true, text: "x", local_datetime: "el jueves" }, NOW).kind,
    "invalid",
  );
  assertEquals(
    parseReminderInterpretation({ is_reminder: true, text: "  ", local_datetime: "2026-10-22T17:00" }, NOW).kind,
    "invalid",
  );
});

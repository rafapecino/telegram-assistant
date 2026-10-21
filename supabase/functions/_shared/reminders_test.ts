import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parseReminderRequest } from "./reminders.ts";

const NOW = new Date("2026-10-21T10:00:00Z");

Deno.test("acepta un recordatorio válido y convierte la hora de Madrid", () => {
  assertEquals(parseReminderRequest({ text: " llamar a Juan ", local_datetime: "2026-10-22T17:00" }, NOW), {
    kind: "reminder",
    text: "llamar a Juan",
    remindAt: new Date("2026-10-22T15:00:00Z"),
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

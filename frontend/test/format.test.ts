import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReminderWhen, inOneHourLocal, nextMondayAtNineLocal, tomorrowAtNineLocal } from "../src/format.ts";

// Miércoles 21 de octubre de 2026, horario de verano en Madrid (UTC+2).
const WEDNESDAY_NOON = new Date("2026-10-21T10:00:00Z");

test("hoy, mañana, nombre del día hasta 6 días y fecha corta después", () => {
  assert.equal(formatReminderWhen("2026-10-21T16:00:00Z", WEDNESDAY_NOON), "Hoy · 18:00");
  assert.equal(formatReminderWhen("2026-10-22T07:00:00Z", WEDNESDAY_NOON), "Mañana · 09:00");
  assert.equal(formatReminderWhen("2026-10-23T07:00:00Z", WEDNESDAY_NOON), "Viernes · 09:00");
  // El 25 de octubre cambia la hora: el lunes 27 Madrid ya está en UTC+1.
  assert.equal(formatReminderWhen("2026-10-27T08:00:00Z", WEDNESDAY_NOON), "Martes · 09:00");
  assert.equal(formatReminderWhen("2026-10-28T08:00:00Z", WEDNESDAY_NOON), "mié, 28 oct · 09:00");
  assert.equal(formatReminderWhen("2026-10-29T08:00:00Z", WEDNESDAY_NOON), "jue, 29 oct · 09:00");
});

test("el cambio de día es a medianoche de Madrid, no de UTC", () => {
  const reminder = "2026-10-21T22:30:00Z"; // jueves 22 a las 00:30 en Madrid
  assert.equal(formatReminderWhen(reminder, new Date("2026-10-21T21:59:00Z")), "Mañana · 00:30"); // 23:59 en Madrid
  assert.equal(formatReminderWhen(reminder, new Date("2026-10-21T22:00:00Z")), "Hoy · 00:30"); // 00:00 en Madrid
});

test("un recordatorio que ya ha pasado muestra la fecha corta", () => {
  assert.equal(formatReminderWhen("2026-10-20T07:00:00Z", WEDNESDAY_NOON), "mar, 20 oct · 09:00");
});

test("atajo en 1 hora, en hora de Madrid", () => {
  assert.equal(inOneHourLocal(WEDNESDAY_NOON), "2026-10-21T13:00");
});

test("atajo mañana a las 9 usa el día de Madrid", () => {
  assert.equal(tomorrowAtNineLocal(WEDNESDAY_NOON), "2026-10-22T09:00");
  // 23:30 UTC del 21 ya es día 22 en Madrid.
  assert.equal(tomorrowAtNineLocal(new Date("2026-10-21T23:30:00Z")), "2026-10-23T09:00");
});

test("atajo lunes a las 9: el próximo que no haya pasado", () => {
  assert.equal(nextMondayAtNineLocal(WEDNESDAY_NOON), "2026-10-26T09:00");
  assert.equal(nextMondayAtNineLocal(new Date("2026-10-26T07:00:00Z")), "2026-10-26T09:00"); // lunes 08:00
  assert.equal(nextMondayAtNineLocal(new Date("2026-10-26T08:00:00Z")), "2026-11-02T09:00"); // lunes 09:00
});

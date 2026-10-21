import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { madridClock, madridDateDaysAgo, madridLocalToUtc } from "./madrid-time.ts";

Deno.test("hora de verano: Madrid va 2 horas por delante de UTC", () => {
  assertEquals(madridLocalToUtc("2026-10-23T17:00").toISOString(), "2026-10-23T15:00:00.000Z");
});

Deno.test("hora de invierno: tras el cambio del 25 de octubre va 1 hora por delante", () => {
  assertEquals(madridLocalToUtc("2026-10-26T17:00").toISOString(), "2026-10-26T16:00:00.000Z");
});

Deno.test("el día del cambio a verano usa el desfase nuevo", () => {
  assertEquals(madridLocalToUtc("2026-03-29T10:00").toISOString(), "2026-03-29T08:00:00.000Z");
});

Deno.test("rechaza fechas con formato incorrecto o inexistentes", () => {
  assertThrows(() => madridLocalToUtc("mañana a las 5"));
  assertThrows(() => madridLocalToUtc("2026-02-30T10:00"));
  assertThrows(() => madridLocalToUtc("2026-10-23T25:00"));
});

Deno.test("madridClock da la hora local y detecta el domingo", () => {
  const clock = madridClock(new Date("2026-10-25T19:00:00Z"));
  assertEquals(clock.localDateTime, "2026-10-25T20:00");
  assertEquals(clock.hour, 20);
  assertEquals(clock.isSunday, true);
  assertEquals(clock.weekday, "domingo");
});

Deno.test("madridClock cambia de día según la hora de Madrid, no la de UTC", () => {
  assertEquals(madridClock(new Date("2026-10-21T22:30:00Z")).localDate, "2026-10-22");
});

Deno.test("madridDateDaysAgo resta días sobre la fecha local", () => {
  assertEquals(madridDateDaysAgo(new Date("2026-10-21T10:00:00Z"), 7), "2026-10-14");
});

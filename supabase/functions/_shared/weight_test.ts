import { assertEquals } from "jsr:@std/assert@1.0.19";
import { describeSavedWeight, formatWeightTrend, parseWeightRequest } from "./weight.ts";

const TODAY = "2026-10-23";

Deno.test("el peso se entiende con coma, sin fecha es hoy y se redondea a 100 g", () => {
  assertEquals(parseWeightRequest({ action: "save", kg: "72,46" }, TODAY), {
    kind: "weight_save",
    kg: 72.5,
    date: TODAY,
  });
});

Deno.test("no se apuntan pesos imposibles ni fechas futuras", () => {
  assertEquals(parseWeightRequest({ action: "save", kg: 7 }, TODAY).kind, "invalid");
  assertEquals(parseWeightRequest({ action: "save", kg: 70, date: "2026-10-24" }, TODAY).kind, "invalid");
});

Deno.test("al apuntar dice cuánto ha cambiado desde la vez anterior", () => {
  const entries = [{ date: "2026-10-16", kg: 73 }, { date: "2026-10-23", kg: 72.6 }];
  assertEquals(
    describeSavedWeight(entries, "2026-10-23", 72.6),
    "Apuntado: 72,6 kg el 23 de octubre. −0,4 kg desde el 16 de octubre.",
  );
  assertEquals(describeSavedWeight(entries.slice(1), "2026-10-23", 72.6), "Apuntado: 72,6 kg el 23 de octubre.");
});

Deno.test("la evolución enseña los últimos pesos y el cambio desde el primero", () => {
  const entries = [{ date: "2026-10-09", kg: 74 }, { date: "2026-10-16", kg: 73 }, { date: "2026-10-23", kg: 74.5 }];
  assertEquals(
    formatWeightTrend(entries),
    "Tu peso:\n• 9 de octubre: 74,0 kg\n• 16 de octubre: 73,0 kg\n• 23 de octubre: 74,5 kg\nDesde el 9 de octubre: +0,5 kg.",
  );
});

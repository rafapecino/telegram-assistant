import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { parseManualEntry, saveManualEntry } from "./manual-entries.ts";
import { fakeDb } from "./testing.ts";

const TODAY = "2026-10-28";

Deno.test("un gasto necesita importe, descripción, categoría conocida y fecha", () => {
  const dinner = { amount: "12,505", description: " Cena ", category: "Restaurantes", date: TODAY };
  assertEquals(parseManualEntry(dinner, "expense", TODAY), {
    amount: 12.51,
    description: "Cena",
    date: TODAY,
    category: "Restaurantes",
  });
  assertThrows(
    () => parseManualEntry({ amount: 5, description: "x", category: "Inventada", date: TODAY }, "expense", TODAY),
    Error,
    "categoría",
  );
});

Deno.test("un ingreso no lleva categoría", () => {
  assertEquals(parseManualEntry({ amount: 50, description: "Bizum", date: TODAY }, "income", TODAY), {
    amount: 50,
    description: "Bizum",
    date: TODAY,
  });
});

Deno.test("rechaza importes imposibles y fechas futuras o de hace más de un año", () => {
  for (const amount of [0, -3, "abc", 100_001]) {
    assertThrows(() => parseManualEntry({ amount, description: "x", date: TODAY }, "income", TODAY), Error, "importe");
  }
  const income = (raw: Record<string, unknown>) => () => parseManualEntry(raw, "income", TODAY);
  assertThrows(income({ amount: 1, description: "x", date: "2026-10-29" }), Error, "futura");
  assertThrows(income({ amount: 1, description: "x", date: "2025-10-27" }), Error, "año");
  assertThrows(income({ amount: 1, description: " ", date: TODAY }), Error, "descripción");
});

Deno.test("se guarda como manual, en euros, sin chocar con los movimientos del banco", async () => {
  const { db, queries } = fakeDb(() => ({}));
  await saveManualEntry(db, "expense", { amount: 3, description: "Café", date: TODAY, category: "Restaurantes" });
  const inserted = JSON.parse(queries[0][1].slice("insert(".length, -1));
  assertEquals(queries[0][0], 'from("expenses")');
  assertEquals(inserted.account_uid, "manual");
  assertEquals(inserted.transaction_key.startsWith("manual|"), true);
  assertEquals([inserted.amount, inserted.currency, inserted.category], [3, "EUR", "Restaurantes"]);
  await saveManualEntry(db, "income", { amount: 10, description: "Bizum", date: TODAY });
  assertEquals(queries[1][0], 'from("incomes")');
  assertEquals("category" in JSON.parse(queries[1][1].slice("insert(".length, -1)), false);
});

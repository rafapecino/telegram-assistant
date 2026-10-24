import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.19";
import { describeSavedManualExpense, parseManualExpense, saveManualExpense } from "./manual-expenses.ts";
import { fakeDb } from "./testing.ts";

const TODAY = "2026-10-24";

Deno.test("dos energéticas sin precio cuestan 1,20 € cada una", () => {
  const request = parseManualExpense({ item: "energy", quantity: 2, amount: null }, TODAY);
  assertEquals(request, { kind: "manual_expense", item: "energy", quantity: 2, amount: 2.4, date: TODAY });
  if (request.kind === "manual_expense") {
    assertEquals(describeSavedManualExpense(request), "Apuntado en Finanzas: 2 energéticas, 2,40 €.");
  }
});

Deno.test("el tabaco necesita precio y lo entiende con coma", () => {
  assertEquals(parseManualExpense({ item: "tobacco", quantity: 1, amount: null }, TODAY).kind, "invalid");
  assertEquals(parseManualExpense({ item: "tobacco", amount: "5,50" }, TODAY), {
    kind: "manual_expense",
    item: "tobacco",
    quantity: 1,
    amount: 5.5,
    date: TODAY,
  });
});

Deno.test("solo se apuntan energéticas o tabaco, en cantidades razonables", () => {
  assertEquals(parseManualExpense({ item: "pizza", quantity: 1 }, TODAY).kind, "invalid");
  assertEquals(parseManualExpense({ item: "energy", quantity: 0 }, TODAY).kind, "invalid");
});

Deno.test("se guarda como gasto de hoy con la descripción que reconoce el panel", async () => {
  const { db, queries } = fakeDb(() => ({ error: null }));
  await saveManualExpense(db, { kind: "manual_expense", item: "energy", quantity: 3, amount: 3.6, date: TODAY });
  const insert = JSON.parse(queries[0][1].slice("insert(".length, -1));
  assertEquals(insert.description, "ENERGÉTICA x3 (apuntado a mano)");
  assertEquals([insert.amount, insert.booking_date, insert.account_uid], [3.6, TODAY, "manual"]);
  assertMatch(insert.transaction_key, /^manual\|/);
});

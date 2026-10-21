import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1.0.19";
import type { BankTransaction } from "./enable-banking.ts";
import { buildWeeklySummary, parseCategories, toNewExpense } from "./expenses.ts";

const CARD_PAYMENT: BankTransaction = {
  entry_reference: "ref-1",
  transaction_amount: { amount: "12.50", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-10-20",
  creditor: { name: "MERCADONA" },
  remittance_information: ["COMPRA TARJETA"],
};

Deno.test("convierte un cargo asentado en gasto", () => {
  assertEquals(toNewExpense(CARD_PAYMENT, "account-1"), {
    bank_transaction_id: "ref-1",
    account_uid: "account-1",
    booking_date: "2026-10-20",
    amount: 12.5,
    currency: "EUR",
    description: "MERCADONA",
  });
});

Deno.test("ignora ingresos y movimientos sin asentar", () => {
  assertEquals(toNewExpense({ ...CARD_PAYMENT, credit_debit_indicator: "CRDT" }, "account-1"), null);
  assertEquals(toNewExpense({ ...CARD_PAYMENT, status: "PDNG" }, "account-1"), null);
});

Deno.test("sin acreedor usa el concepto, y sin identificador construye uno estable", () => {
  const expense = toNewExpense(
    { ...CARD_PAYMENT, entry_reference: null, creditor: null, transaction_amount: { amount: "-3", currency: "EUR" } },
    "account-1",
  );
  assertEquals(expense?.description, "COMPRA TARJETA");
  assertEquals(expense?.amount, 3);
  assertEquals(expense?.bank_transaction_id, "account-1|2026-10-20|3|COMPRA TARJETA");
});

Deno.test("las categorías desconocidas pasan a Otros y un número incorrecto falla", () => {
  assertEquals(parseCategories({ categories: ["Supermercado", "Viajes"] }, 2), ["Supermercado", "Otros"]);
  assertThrows(() => parseCategories({ categories: ["Supermercado"] }, 2));
  assertThrows(() => parseCategories("no es json", 1));
});

Deno.test("el resumen semanal suma por categoría y muestra los tres mayores gastos", () => {
  const summary = buildWeeklySummary([
    { booking_date: "2026-10-19", amount: 40, description: "Gasolinera", category: "Transporte" },
    { booking_date: "2026-10-20", amount: 12.5, description: "MERCADONA", category: "Supermercado" },
    { booking_date: "2026-10-21", amount: 7.5, description: "LIDL", category: "Supermercado" },
  ]);
  // Intl separa importe y símbolo con un espacio no separable.
  const normalizedSummary = summary.replaceAll("\u00a0", " ");
  assertStringIncludes(normalizedSummary, "3 gastos");
  assertStringIncludes(normalizedSummary, "Transporte: 40,00 €");
  assertStringIncludes(normalizedSummary, "Supermercado: 20,00 €");
  assertStringIncludes(normalizedSummary, "Gasolinera: 40,00 € (2026-10-19)");
});

Deno.test("el resumen avisa si no hay gastos", () => {
  assertStringIncludes(buildWeeklySummary([]), "no hay gastos");
});

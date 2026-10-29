import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert@1.0.19";
import type { BankTransaction } from "./enable-banking.ts";
import {
  assignTransactionKeys,
  buildWeeklySummary,
  type ExpenseCandidate,
  importRecentExpenses,
  maskCardNumbers,
  parseCategories,
  toExpenseCandidate,
  toIncomeCandidate,
} from "./expenses.ts";
import { enableBankingEnv, fakeDb, withFakeFetch } from "./testing.ts";

const CARD_PAYMENT: BankTransaction = {
  transaction_amount: { amount: "12.50", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-10-20",
  creditor: { name: "MERCADONA" },
  remittance_information: ["COMPRA TARJETA"],
};

function candidate(description: string, amount: number): ExpenseCandidate {
  return { account_uid: "account-1", booking_date: "2026-10-19", amount, currency: "EUR", description };
}

Deno.test("convierte un cargo asentado en gasto", () => {
  assertEquals(toExpenseCandidate(CARD_PAYMENT, "account-1"), {
    account_uid: "account-1",
    booking_date: "2026-10-20",
    amount: 12.5,
    currency: "EUR",
    description: "MERCADONA",
  });
});

Deno.test("ignora ingresos y movimientos sin asentar", () => {
  assertEquals(toExpenseCandidate({ ...CARD_PAYMENT, credit_debit_indicator: "CRDT" }, "account-1"), null);
  assertEquals(toExpenseCandidate({ ...CARD_PAYMENT, status: "PDNG" }, "account-1"), null);
});

Deno.test("sin acreedor usa el concepto y el importe siempre es positivo", () => {
  const expense = toExpenseCandidate(
    { ...CARD_PAYMENT, creditor: null, transaction_amount: { amount: "-3", currency: "EUR" } },
    "account-1",
  );
  assertEquals(expense?.description, "COMPRA TARJETA");
  assertEquals(expense?.amount, 3);
});

Deno.test("oculta los números de tarjeta y deja intactos los números cortos", () => {
  assertEquals(
    maskCardNumbers("RETIRADA EN CAJERO 000000000000 ..PAN:4111111111111111."),
    "RETIRADA EN CAJERO 000000000000 ..PAN:****1111.",
  );
  assertEquals(
    maskCardNumbers("COMPRA COMERCIO, TARJETA 4111111111111111 , COMISION 0,00"),
    "COMPRA COMERCIO, TARJETA ****1111 , COMISION 0,00",
  );
  assertEquals(maskCardNumbers("PAGO MOVIL EN DIA, TARJ. :*111111"), "PAGO MOVIL EN DIA, TARJ. :*111111");
});

Deno.test("el concepto guardado ya no lleva el número de tarjeta", () => {
  const expense = toExpenseCandidate(
    { ...CARD_PAYMENT, creditor: null, remittance_information: ["PAN:4111111111111111."] },
    "account-1",
  );
  assertEquals(expense?.description, "PAN:****1111.");
});

Deno.test("los gastos idénticos del mismo día reciben claves distintas", () => {
  const keys = assignTransactionKeys([candidate("PECRIS", 8), candidate("PECRIS", 8), candidate("BAR", 3)])
    .map((expense) => expense.transaction_key);
  assertEquals(keys, [
    "account-1|2026-10-19|8|PECRIS|1",
    "account-1|2026-10-19|8|PECRIS|2",
    "account-1|2026-10-19|3|BAR|1",
  ]);
});

Deno.test("las claves no dependen del orden en que el banco devuelve los movimientos", () => {
  const firstOrder = assignTransactionKeys([candidate("PECRIS", 8), candidate("BAR", 3), candidate("PECRIS", 8)]);
  const secondOrder = assignTransactionKeys([candidate("BAR", 3), candidate("PECRIS", 8), candidate("PECRIS", 8)]);
  const sortedKeys = (expenses: { transaction_key: string }[]) => expenses.map((e) => e.transaction_key).sort();
  assertEquals(sortedKeys(firstOrder), sortedKeys(secondOrder));
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

/** Base de datos sin conexión vigente y con `savedConnections` conexiones guardadas (caducadas). */
function withoutActiveConnection(savedConnections: number) {
  return fakeDb((query) =>
    query.includes("maybeSingle()") ? { data: null, error: null } : { count: savedConnections, error: null }
  ).db;
}

Deno.test("sin ninguna conexión guardada la importación no hace nada ni avisa", async () => {
  assertEquals(await importRecentExpenses(withoutActiveConnection(0), new Date("2026-10-22T06:00:00Z")), 0);
});

Deno.test("con la conexión caducada la importación avisa de que hay que volver a conectar", async () => {
  await assertRejects(
    () => importRecentExpenses(withoutActiveConnection(1), new Date("2026-10-22T06:00:00Z")),
    Error,
    "/conectar_banco",
  );
});

Deno.test("un abono asentado es un ingreso a nombre de quien paga, y un cargo no", () => {
  const salary: BankTransaction = {
    transaction_amount: { amount: "2000.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    booking_date: "2026-10-01",
    debtor: { name: "EMPRESA SL" },
    remittance_information: ["NOMINA OCTUBRE"],
  };
  assertEquals(toIncomeCandidate(salary, "account-1"), {
    account_uid: "account-1",
    booking_date: "2026-10-01",
    amount: 2000,
    currency: "EUR",
    description: "EMPRESA SL",
  });
  assertEquals(toIncomeCandidate(CARD_PAYMENT, "account-1"), null);
  assertEquals(toIncomeCandidate({ ...salary, status: "PDNG" }, "account-1"), null);
});

Deno.test("la importación guarda también los ingresos de los mismos movimientos", async () => {
  const salary = { ...CARD_PAYMENT, credit_debit_indicator: "CRDT", debtor: { name: "EMPRESA SL" } };
  const { db, queries } = fakeDb((query) => {
    if (query[0] === 'from("bank_sessions")') {
      return { data: { session_id: "s", account_uids: ["account-1"], valid_until: "2027-01-01T00:00:00+00:00" } };
    }
    return query.includes('select("transaction_key")') ? { data: [] } : {};
  });
  const respond = (request: Request) =>
    request.url.includes("groq.com")
      ? Response.json({ choices: [{ message: { content: '{"categories": ["Supermercado"]}' } }] })
      : Response.json({ transactions: [CARD_PAYMENT, salary] });
  await withFakeFetch({ ...(await enableBankingEnv()), GROQ_API_KEY: "groq-de-prueba" }, respond, async () => {
    assertEquals(await importRecentExpenses(db, new Date("2026-10-22T06:00:00Z")), 1);
  });
  const savedIncomes = queries.find((query) => query[0] === 'from("incomes")');
  assertEquals(savedIncomes?.[1].startsWith('upsert([{"account_uid":"account-1","booking_date":"2026-10-20",'), true);
  assertEquals(savedIncomes?.[1].includes('"description":"EMPRESA SL"'), true);
});

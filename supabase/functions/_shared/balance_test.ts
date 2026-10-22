import { assertEquals } from "jsr:@std/assert@1.0.19";
import { findBalance, formatBalance, parseBalanceQuery } from "./balance.ts";
import { fakeDb } from "./testing.ts";

// Intl separa importe y símbolo con un espacio no separable.
function normalizeSpaces(text: string): string {
  return text.replaceAll("\u00a0", " ");
}

Deno.test("acepta un periodo válido y rechaza fechas al revés o inventadas", () => {
  assertEquals(parseBalanceQuery({ date_from: "2026-10-01", date_to: "2026-10-22" }), {
    kind: "balance_query",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-22",
  });
  assertEquals(parseBalanceQuery({ date_from: "2026-10-22", date_to: "2026-10-01" }).kind, "invalid");
  assertEquals(parseBalanceQuery({ date_from: "este mes", date_to: "hoy" }).kind, "invalid");
});

Deno.test("el balance suma ingresos y gastos del periodo", async () => {
  const { db, queries } = fakeDb((query) =>
    query[0] === 'from("incomes")' ? { data: [{ amount: "2000" }, { amount: 100 }] } : { data: [{ amount: 1143.45 }] }
  );
  assertEquals(await findBalance(db, "2026-10-01", "2026-10-22"), { incomes: 2100, expenses: 1143.45 });
  assertEquals(queries[0].slice(2), ['gte("booking_date", "2026-10-01")', 'lte("booking_date", "2026-10-22")']);
});

Deno.test("dice cuánto se ahorra y qué parte de lo ingresado es", () => {
  assertEquals(
    normalizeSpaces(formatBalance({ incomes: 2100, expenses: 1143.45 }, "2026-10-01", "2026-10-22")),
    [
      "Balance del 1 de octubre al 22 de octubre:",
      "• Ingresos: 2100,00 €",
      "• Gastos: 1143,45 €",
      "• Ahorro: 956,55 € (46 % de lo que ha entrado)",
    ].join("\n"),
  );
});

Deno.test("avisa si se gasta más de lo que entra o si no hay ingresos", () => {
  assertEquals(
    normalizeSpaces(formatBalance({ incomes: 500, expenses: 800 }, "2026-10-01", "2026-10-22")).split("\n")[3],
    "• Ahorro: -300,00 € (has gastado más de lo que ha entrado)",
  );
  assertEquals(
    normalizeSpaces(formatBalance({ incomes: 0, expenses: 80 }, "2026-10-22", "2026-10-22")).split("\n")[3],
    "• Ahorro: -80,00 € (no hay ingresos registrados en este periodo)",
  );
});

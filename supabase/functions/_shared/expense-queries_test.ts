import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { findExpenses, formatExpenseReport, parseExpenseQuery } from "./expense-queries.ts";
import { fakeDb } from "./testing.ts";
import type { StoredExpense } from "./expenses.ts";

const EXPENSES: StoredExpense[] = [
  { booking_date: "2026-10-21", amount: 3.2, description: "LA CABAÑA", category: "Restaurantes" },
  { booking_date: "2026-10-20", amount: 8.6, description: "EXPENDEDURIA 16", category: "Otros" },
  { booking_date: "2026-10-19", amount: 24, description: "LA SKAPADA", category: "Restaurantes" },
];

// Intl separa importe y símbolo con un espacio no separable.
function normalizeSpaces(text: string): string {
  return text.replaceAll(" ", " ");
}

Deno.test("acepta un periodo válido con o sin categoría", () => {
  assertEquals(parseExpenseQuery({ date_from: "2026-10-01", date_to: "2026-10-21", category: "Ocio" }), {
    kind: "expenses_query",
    query: { dateFrom: "2026-10-01", dateTo: "2026-10-21", category: "Ocio" },
  });
  assertEquals(parseExpenseQuery({ date_from: "2026-10-21", date_to: "2026-10-21" }), {
    kind: "expenses_query",
    query: { dateFrom: "2026-10-21", dateTo: "2026-10-21", category: null },
  });
});

Deno.test("rechaza fechas inexistentes, periodos al revés y categorías desconocidas", () => {
  assertEquals(parseExpenseQuery({ date_from: "2026-02-30", date_to: "2026-03-01" }).kind, "invalid");
  assertEquals(parseExpenseQuery({ date_from: "2026-10-21", date_to: "2026-10-01" }).kind, "invalid");
  assertEquals(parseExpenseQuery({ date_from: "ayer", date_to: "hoy" }).kind, "invalid");
  assertEquals(
    parseExpenseQuery({ date_from: "2026-10-01", date_to: "2026-10-21", category: "Bares" }).kind,
    "invalid",
  );
});

Deno.test("el informe da el total, el desglose por categoría y el detalle", () => {
  const report = normalizeSpaces(
    formatExpenseReport(EXPENSES, { dateFrom: "2026-10-19", dateTo: "2026-10-21", category: null }),
  );
  assertStringIncludes(report, "Gastos del 19 de octubre al 21 de octubre: 35,80 € en 3 gastos.");
  assertStringIncludes(report, "• Restaurantes: 27,20 €");
  assertStringIncludes(report, "• LA SKAPADA: 24,00 € (2026-10-19)");
});

Deno.test("con categoría no repite el desglose y menciona la categoría", () => {
  const restaurants = EXPENSES.filter((expense) => expense.category === "Restaurantes");
  const report = normalizeSpaces(
    formatExpenseReport(restaurants, { dateFrom: "2026-10-21", dateTo: "2026-10-21", category: "Restaurantes" }),
  );
  assertStringIncludes(report, "Gastos del 21 de octubre en Restaurantes: 27,20 € en 2 gastos.");
  assertEquals(report.includes("Por categoría"), false);
});

Deno.test("sin gastos lo dice, y con muchos limita la lista", () => {
  assertEquals(
    formatExpenseReport([], { dateFrom: "2026-10-21", dateTo: "2026-10-21", category: null }),
    "No tienes gastos del 21 de octubre.",
  );
  const many = Array.from({ length: 25 }, () => EXPENSES[0]);
  const report = formatExpenseReport(many, { dateFrom: "2026-10-01", dateTo: "2026-10-21", category: null });
  assertStringIncludes(report, "… y 5 más.");
});

Deno.test("un sitio concreto se busca en la descripción, sin comodines y sin categoría", async () => {
  const request = parseExpenseQuery({ date_from: "2026-10-01", date_to: "2026-10-21", category: "Restaurantes", place: "La Cabaña%" });
  assertEquals(request, {
    kind: "expenses_query",
    query: { dateFrom: "2026-10-01", dateTo: "2026-10-21", category: null, place: "La Cabaña" },
  });
  const { db, queries } = fakeDb(() => ({ data: [] }));
  if (request.kind === "expenses_query") await findExpenses(db, request.query);
  assertEquals(queries[0].at(-1), 'ilike("description", "%La Cabaña%")');
});

Deno.test("tabaco o estanco busca los estancos por cómo los nombra el banco", async () => {
  const { db, queries } = fakeDb(() => ({ data: [] }));
  await findExpenses(db, { dateFrom: "2026-10-01", dateTo: "2026-10-21", category: null, place: "tabaco" });
  assertEquals(
    queries[0].at(-1),
    'or("description.ilike.%expendedur%,description.ilike.%estanc%,description.ilike.%tabac%")',
  );
});

Deno.test("con un sitio dice dónde y no desglosa por categoría", () => {
  const report = normalizeSpaces(
    formatExpenseReport([EXPENSES[1]], { dateFrom: "2026-10-20", dateTo: "2026-10-20", category: null, place: "tabaco" }),
  );
  assertStringIncludes(report, "Gastos del 20 de octubre en tabaco: 8,60 € en 1 gastos.");
  assertEquals(report.includes("Por categoría"), false);
});

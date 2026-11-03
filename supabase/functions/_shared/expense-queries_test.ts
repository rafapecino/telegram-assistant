import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { findExpenses, formatExpenseReport, parseExpenseQuery, searchExpenses } from "./expense-queries.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";
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
  const request = parseExpenseQuery({
    date_from: "2026-10-01",
    date_to: "2026-10-21",
    category: "Restaurantes",
    place: "La Cabaña%",
  });
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
    formatExpenseReport([EXPENSES[1]], {
      dateFrom: "2026-10-20",
      dateTo: "2026-10-20",
      category: null,
      place: "tabaco",
    }),
  );
  assertStringIncludes(report, "Gastos del 20 de octubre en tabaco: 8,60 € en 1 gastos.");
  assertEquals(report.includes("Por categoría"), false);
});

const GROQ_ENV = { GROQ_API_KEY: "g" };
const groq = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
const PERIOD = { dateFrom: "2026-10-19", dateTo: "2026-10-21", category: null };
// La primera consulta busca el sitio tal cual (ilike); la segunda trae todo el periodo.
const bankWithout = (exact: StoredExpense[]) =>
  fakeDb((query) => ({ data: query.some((call) => call.startsWith("ilike(")) ? exact : EXPENSES }));

Deno.test("si el sitio aparece tal cual en el banco, no pregunta a Groq", async () => {
  const { db } = bankWithout([EXPENSES[0]]);
  await withFakeFetch(GROQ_ENV, () => new Response("no debería llamarse", { status: 500 }), async (requests) => {
    const result = await searchExpenses(db, { ...PERIOD, place: "cabaña" });
    assertEquals(result, { expenses: [EXPENSES[0]], bankNames: [] });
    assertEquals(requests.length, 0);
  });
});

Deno.test("si el sitio no aparece tal cual, Groq elige qué comercio del banco es (cabañita → LA CABAÑA)", async () => {
  const { db } = bankWithout([]);
  await withFakeFetch(GROQ_ENV, () => groq({ matches: [0, 7, "x"] }), async (requests) => {
    const result = await searchExpenses(db, { ...PERIOD, place: "cabañita" });
    assertEquals(result, { expenses: [EXPENSES[0]], bankNames: ["LA CABAÑA"] });
    const sent = await requests[0].json();
    const userMessage = sent.messages.at(-1).content;
    assertStringIncludes(userMessage, "cabañita");
    assertStringIncludes(userMessage, "0. LA CABAÑA");
  });
});

Deno.test("si Groq no reconoce ningún comercio, no hay gastos", async () => {
  const { db } = bankWithout([]);
  await withFakeFetch(GROQ_ENV, () => groq({ matches: [] }), async () => {
    assertEquals(await searchExpenses(db, { ...PERIOD, place: "sitio inventado" }), { expenses: [], bankNames: [] });
  });
});

Deno.test("el tabaco y las búsquedas sin sitio no preguntan a Groq", async () => {
  const { db } = bankWithout([]);
  await withFakeFetch(GROQ_ENV, () => new Response("no debería llamarse", { status: 500 }), async (requests) => {
    await searchExpenses(db, { ...PERIOD, place: "tabaco" });
    assertEquals((await searchExpenses(db, PERIOD)).expenses, EXPENSES);
    assertEquals(requests.length, 0);
  });
});

Deno.test("el informe dice con qué nombre aparece el sitio en el banco", () => {
  const report = normalizeSpaces(
    formatExpenseReport([EXPENSES[0]], { ...PERIOD, place: "cabañita" }, ["LA CABAÑA"]),
  );
  assertStringIncludes(report, "Gastos del 19 de octubre al 21 de octubre en cabañita: 3,20 € en 1 gastos.");
  assertStringIncludes(report, "En el banco aparece como «LA CABAÑA».");
});

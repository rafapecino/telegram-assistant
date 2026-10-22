import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  budgetAlertMessage,
  budgetStatuses,
  checkBudgetAlerts,
  crossedThresholds,
  formatBudgetList,
  parseBudgetRequest,
  pendingAlerts,
  saveBudget,
} from "./budgets.ts";
import { fakeDb, withTelegram } from "./testing.ts";

const NOW = new Date("2026-10-22T07:00:00Z");
const RESTAURANTS = { id: 1, category: "Restaurantes", monthly_limit: 200 };
const TOTAL = { id: 2, category: "Total", monthly_limit: 1000 };

// Intl separa importe y símbolo con un espacio no separable.
function normalizeSpaces(text: string): string {
  return text.replaceAll("\u00a0", " ");
}

Deno.test("entiende poner, quitar y consultar presupuestos, y redondea el límite a céntimos", () => {
  assertEquals(parseBudgetRequest({ action: "set", category: "Restaurantes", monthly_limit: "199.999" }), {
    kind: "budget_set",
    category: "Restaurantes",
    monthlyLimit: 200,
  });
  assertEquals(parseBudgetRequest({ action: "set", category: "Total", monthly_limit: 1500 }).kind, "budget_set");
  assertEquals(parseBudgetRequest({ action: "delete", category: "Ocio" }), { kind: "budget_delete", category: "Ocio" });
  assertEquals(parseBudgetRequest({ action: "list", category: null }), { kind: "budget_list" });
});

Deno.test("rechaza categorías desconocidas y límites que no son una cantidad positiva", () => {
  assertEquals(parseBudgetRequest({ action: "set", category: "Viajes", monthly_limit: 100 }).kind, "invalid");
  assertEquals(parseBudgetRequest({ action: "set", category: "Ocio", monthly_limit: null }).kind, "invalid");
  assertEquals(parseBudgetRequest({ action: "set", category: "Ocio", monthly_limit: -5 }).kind, "invalid");
  assertEquals(parseBudgetRequest({ action: "borrar_todo", category: "Ocio" }).kind, "invalid");
});

Deno.test("cada presupuesto suma su categoría y el total suma todo", () => {
  const statuses = budgetStatuses([RESTAURANTS, TOTAL], [
    { category: "Restaurantes", amount: 120.5 },
    { category: "Ocio", amount: 30 },
    { category: "Restaurantes", amount: 40 },
  ]);
  assertEquals(statuses.map((status) => status.spent), [160.5, 190.5]);
});

Deno.test("los umbrales se cruzan al llegar justo al 80 % y al 100 %", () => {
  assertEquals(crossedThresholds({ budget: RESTAURANTS, spent: 159.99 }), []);
  assertEquals(crossedThresholds({ budget: RESTAURANTS, spent: 160 }), [80]);
  assertEquals(crossedThresholds({ budget: RESTAURANTS, spent: 200 }), [80, 100]);
});

Deno.test("solo se avisa del umbral más alto y nunca dos veces en el mismo mes", () => {
  const over = { budget: RESTAURANTS, spent: 230 };
  const near = { budget: TOTAL, spent: 850 };
  assertEquals(pendingAlerts([over, near], new Set()), [
    { status: over, threshold: 100 },
    { status: near, threshold: 80 },
  ]);
  assertEquals(pendingAlerts([over, near], new Set(["1:100", "2:80"])), []);
  // Avisado el 80 % de Restaurantes, al pasar del 100 % sí se avisa otra vez.
  assertEquals(pendingAlerts([over], new Set(["1:80"])), [{ status: over, threshold: 100 }]);
});

Deno.test("los avisos dicen cuánto se lleva, de cuánto y en qué presupuesto", () => {
  assertEquals(
    normalizeSpaces(budgetAlertMessage({ budget: RESTAURANTS, spent: 162.4 }, 80)),
    "⚠️ Llevas 162,40 € de 200,00 € del presupuesto de Restaurantes este mes (81 %).",
  );
  assertEquals(
    normalizeSpaces(budgetAlertMessage({ budget: TOTAL, spent: 1080 }, 100)),
    "🚨 Te has pasado del presupuesto total: llevas 1080,00 € de 1000,00 € este mes (108 %).",
  );
});

Deno.test("la lista marca cómo va cada presupuesto y explica cómo crear uno si no hay", () => {
  assertStringIncludes(formatBudgetList([]), "pon un límite de 200 € al mes en restaurantes");
  const list = normalizeSpaces(formatBudgetList([{ budget: RESTAURANTS, spent: 40 }, { budget: TOTAL, spent: 990 }]));
  assertStringIncludes(list, "✅ Restaurantes: 40,00 € de 200,00 € (20 %)");
  assertStringIncludes(list, "⚠️ Total: 990,00 € de 1000,00 € (99 %)");
});

/** Base de datos con presupuestos, gastos del mes y avisos ya enviados. */
function budgetsDb(
  monthExpenses: { category: string; amount: number }[],
  sentAlerts: { budget_id: number; threshold: number }[],
) {
  return fakeDb((query) => {
    if (query[0] === 'from("budgets")') {
      return query.some((step) => step.startsWith("upsert(")) ? { data: { id: 1 } } : { data: [RESTAURANTS] };
    }
    if (query[0] === 'from("expenses")') return { data: monthExpenses };
    if (query[0] === 'from("budget_alerts")' && query.includes('select("budget_id, threshold")')) {
      return { data: sentAlerts };
    }
    return {};
  });
}

Deno.test("tras importar se avisa por Telegram y se apunta para no repetirlo", async () => {
  const { db, queries } = budgetsDb([{ category: "Restaurantes", amount: 170 }], []);
  await withTelegram(async (requests) => {
    assertEquals(await checkBudgetAlerts(db, NOW), 1);
    const [message] = await Promise.all(requests.map((request) => request.json()));
    assertStringIncludes(normalizeSpaces(message.text), "Llevas 170,00 € de 200,00 €");
  });
  assertEquals(
    queries.at(-1)?.[1],
    'upsert([{"budget_id":1,"month":"2026-10-01","threshold":80}], ' +
      '{"onConflict":"budget_id,month,threshold","ignoreDuplicates":true})',
  );
});

Deno.test("si ese aviso ya se envió este mes no se repite", async () => {
  const { db } = budgetsDb([{ category: "Restaurantes", amount: 170 }], [{ budget_id: 1, threshold: 80 }]);
  await withTelegram(async (requests) => {
    assertEquals(await checkBudgetAlerts(db, NOW), 0);
    assertEquals(requests.length, 0);
  });
});

Deno.test("al guardar un presupuesto se reinician sus avisos del mes y lo ya superado se da por avisado", async () => {
  const { db, queries } = budgetsDb([{ category: "Restaurantes", amount: 170 }], []);
  const status = await saveBudget(db, "Restaurantes", 200, NOW);
  assertEquals(status.spent, 170);
  const alertQueries = queries.filter((query) => query[0] === 'from("budget_alerts")').map((query) => query[1]);
  assertEquals(alertQueries, [
    "delete()",
    'upsert([{"budget_id":1,"month":"2026-10-01","threshold":80}], ' +
    '{"onConflict":"budget_id,month,threshold","ignoreDuplicates":true})',
  ]);
});

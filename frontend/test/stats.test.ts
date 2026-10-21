import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExpenseSummary } from "../src/api.ts";
import { categoryShares, chartBars, describePeriodChange, moveExpense } from "../src/stats.ts";

test("el porcentaje de cada categoría es sobre el total y se redondea a entero", () => {
  const shares = categoryShares(
    { Compras: 52.1, Supermercado: 49.5, Restaurantes: 31.2, Transporte: 14.49, Otros: 1.84 },
    149.13,
  );
  assert.deepEqual(
    shares.map((share) => share.percent),
    [35, 33, 21, 10, 1],
  );
});

test("sin total, los porcentajes son 0 en vez de NaN", () => {
  assert.deepEqual(categoryShares({ Ocio: 0 }, 0), [{ category: "Ocio", amount: 0, percent: 0 }]);
});

test("una subida se marca como alerta con flecha y signo", () => {
  assert.deepEqual(describePeriodChange(112, 100, 7), { tone: "up", text: "↑ +12 % vs. 7 días anteriores" });
});

test("una bajada se marca con flecha y signo", () => {
  assert.deepEqual(describePeriodChange(88, 100, 30), { tone: "down", text: "↓ −12 % vs. 30 días anteriores" });
});

test("sin cambio se dice explícitamente", () => {
  assert.deepEqual(describePeriodChange(100, 100, 7), { tone: "flat", text: "= 0 % vs. 7 días anteriores" });
});

test("si el periodo anterior es 0 no se calcula porcentaje", () => {
  assert.deepEqual(describePeriodChange(50, 0, 90), { tone: "none", text: "Sin datos del periodo anterior" });
  assert.deepEqual(describePeriodChange(0, 0, 7), { tone: "none", text: "Sin datos del periodo anterior" });
});

function days(count: number, amount = 1) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2026, 6, 24 + index)).toISOString().slice(0, 10),
    amount,
  }));
}

test("en 7 y 30 días hay una barra por día", () => {
  assert.equal(chartBars(days(7), 7).length, 7);
  assert.equal(chartBars(days(30), 30).length, 30);
});

test("en 90 días hay una barra por semana y la última recoge los días que sobran", () => {
  const bars = chartBars(days(90, 1.1), 90);
  assert.equal(bars.length, 13);
  assert.deepEqual(bars[0], { start: "2026-07-24", end: "2026-07-30", amount: 7.7 });
  assert.deepEqual(bars[12], { start: "2026-10-16", end: "2026-10-21", amount: 6.6 });
});

const summary: ExpenseSummary = {
  days: 7,
  total: 60,
  previous_total: 0,
  count: 2,
  by_category: { Compras: 40, Ocio: 20 },
  by_day: [],
  largest: [
    { id: 1, booking_date: "2026-10-20", amount: 40, description: "Tienda", category: "Compras" },
    { id: 2, booking_date: "2026-10-21", amount: 20, description: "Cine", category: "Ocio" },
  ],
  categories: ["Compras", "Ocio", "Hogar"],
};

test("mover un gasto de categoría recalcula y reordena los totales", () => {
  const moved = moveExpense(summary, 2, "Compras");
  assert.deepEqual(moved.by_category, { Compras: 60 });
  assert.equal(moved.largest[1].category, "Compras");
  assert.equal(moved.total, 60);
});

test("mover un gasto a una categoría nueva la añade en su posición", () => {
  const moved = moveExpense(summary, 1, "Hogar");
  assert.deepEqual(Object.entries(moved.by_category), [["Hogar", 40], ["Ocio", 20]]);
});

test("mover un gasto y devolverlo deja el resumen como estaba (así se revierte un error)", () => {
  assert.deepEqual(moveExpense(moveExpense(summary, 1, "Ocio"), 1, "Compras").by_category, summary.by_category);
});

test("un gasto que no está en la tabla no cambia nada", () => {
  assert.equal(moveExpense(summary, 99, "Hogar"), summary);
});

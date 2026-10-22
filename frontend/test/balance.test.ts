import assert from "node:assert/strict";
import { test } from "node:test";
import { barScale, barWidth, savingsRate } from "../src/balance.ts";
import { formatMonth } from "../src/format.ts";

const october = { month: "2026-10", incomes: 2100, expenses: 1143.45, savings: 956.55 };

test("el ahorro es un porcentaje de lo ingresado y no se calcula sin ingresos", () => {
  assert.equal(savingsRate(october), 46);
  assert.equal(savingsRate({ month: "2026-09", incomes: null, expenses: 80, savings: null }), null);
  assert.equal(savingsRate({ month: "2026-08", incomes: 0, expenses: 80, savings: -80 }), null);
});

test("todas las barras comparten escala y las pequeñas se siguen viendo", () => {
  const months = [october, { month: "2026-09", incomes: null, expenses: 2500, savings: null }];
  assert.equal(barScale(months), 2500);
  assert.equal(barWidth(2100, 2500), 84);
  assert.equal(barWidth(10, 2500), 2);
  assert.equal(barWidth(0, 2500), 0);
  assert.equal(barWidth(10, 0), 0);
});

test("el mes se muestra abreviado en español", () => {
  assert.equal(formatMonth("2026-10"), "oct 2026");
});

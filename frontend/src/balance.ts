// Cálculos del apartado de balance. Sin React, para poder probarlos con node --test.

import type { BalanceMonth } from "./api";

/** Porcentaje de lo ingresado que se ahorra, redondeado. null si no hay ingresos con los que comparar. */
export function savingsRate(month: BalanceMonth): number | null {
  if (month.incomes === null || month.savings === null || !(month.incomes > 0)) return null;
  return Math.round((month.savings / month.incomes) * 100);
}

/** Importe más alto de ingresos o gastos: todas las barras usan la misma escala para poder compararlas. */
export function barScale(months: BalanceMonth[]): number {
  return Math.max(0, ...months.flatMap((month) => [month.incomes ?? 0, month.expenses]));
}

/** Ancho de una barra en %, con un mínimo visible si el importe no es 0. */
export function barWidth(amount: number, scale: number): number {
  if (!(amount > 0) || !(scale > 0)) return 0;
  return Math.max(2, Math.round((amount / scale) * 100));
}

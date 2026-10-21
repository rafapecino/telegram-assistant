// Cálculos de la tarjeta de gastos. Sin React, para poder probarlos con node --test.

import type { DailyTotal, ExpenseSummary } from "./api";

const roundCents = (amount: number) => Math.round(amount * 100) / 100;

export interface CategoryShare {
  category: string;
  amount: number;
  /** Porcentaje del total, redondeado a entero. También es el ancho de la barra. */
  percent: number;
}

export function categoryShares(byCategory: Record<string, number>, total: number): CategoryShare[] {
  return Object.entries(byCategory).map(([category, amount]) => ({
    category,
    amount,
    percent: total > 0 ? Math.round((amount / total) * 100) : 0,
  }));
}

export interface PeriodChange {
  /** up = se gasta más (alerta), down = se gasta menos, flat = igual, none = no hay con qué comparar. */
  tone: "up" | "down" | "flat" | "none";
  text: string;
}

const integer = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

/** Variación frente a los `days` días anteriores, por ejemplo "↓ −12 % vs. 7 días anteriores". */
export function describePeriodChange(current: number, previous: number, days: number): PeriodChange {
  if (!(previous > 0)) return { tone: "none", text: "Sin datos del periodo anterior" };
  const percent = Math.round(((current - previous) / previous) * 100);
  const comparison = `vs. ${days} días anteriores`;
  if (percent > 0) return { tone: "up", text: `↑ +${integer.format(percent)} % ${comparison}` };
  if (percent < 0) return { tone: "down", text: `↓ −${integer.format(-percent)} % ${comparison}` };
  return { tone: "flat", text: `= 0 % ${comparison}` };
}

export interface ChartBar {
  /** Primer y último día de la barra (iguales si es un solo día). */
  start: string;
  end: string;
  amount: number;
}

/** Una barra por día en 7 y 30 días; por bloques de 7 días (el último puede ser más corto) en periodos más largos. */
export function chartBars(byDay: DailyTotal[], days: number): ChartBar[] {
  const size = days > 30 ? 7 : 1;
  const bars: ChartBar[] = [];
  for (let index = 0; index < byDay.length; index += size) {
    const chunk = byDay.slice(index, index + size);
    bars.push({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      amount: roundCents(chunk.reduce((sum, day) => sum + day.amount, 0)),
    });
  }
  return bars;
}

/** Copia del resumen con un gasto movido de categoría y los totales por categoría recalculados. */
export function moveExpense(summary: ExpenseSummary, expenseId: number, category: string): ExpenseSummary {
  const expense = summary.largest.find((item) => item.id === expenseId);
  if (!expense || expense.category === category) return summary;

  const totals = { ...summary.by_category };
  const remaining = roundCents((totals[expense.category] ?? 0) - expense.amount);
  if (remaining > 0) totals[expense.category] = remaining;
  else delete totals[expense.category];
  totals[category] = roundCents((totals[category] ?? 0) + expense.amount);

  return {
    ...summary,
    by_category: Object.fromEntries(Object.entries(totals).sort(([, a], [, b]) => b - a)),
    largest: summary.largest.map((item) => (item.id === expenseId ? { ...item, category } : item)),
  };
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { describePeriod, isCalendarDate } from "./expense-queries.ts";
import { euros } from "./expenses.ts";

/** Formato que el modelo debe devolver cuando el mensaje pregunta por el balance (ver message-intent.ts). */
export const BALANCE_QUERY_INTENT_FORMAT =
  'Pregunta por su balance (lo que entra frente a lo que gasta, o cuánto ahorra): {"intent": "balance_query", ' +
  '"date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD"}. Sin periodo indicado, este mes desde el día 1 hasta hoy.';

export type BalanceRequest =
  | { kind: "balance_query"; dateFrom: string; dateTo: string }
  | { kind: "invalid"; message: string };

export function parseBalanceQuery(raw: unknown): BalanceRequest {
  const candidate = raw as { date_from?: unknown; date_to?: unknown } | null;
  const dateFrom = candidate?.date_from;
  const dateTo = candidate?.date_to;
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo) {
    return { kind: "invalid", message: "No he entendido de qué fechas quieres ver el balance." };
  }
  return { kind: "balance_query", dateFrom, dateTo };
}

export interface Balance {
  incomes: number;
  expenses: number;
}

async function sumAmounts(db: SupabaseClient, table: "incomes" | "expenses", from: string, to: string) {
  const { data, error } = await db.from(table).select("amount").gte("booking_date", from).lte("booking_date", to);
  if (error) {
    throw new Error(`No se pudieron leer los ${table === "incomes" ? "ingresos" : "gastos"}: ${error.message}`);
  }
  return data.reduce((sum, row) => sum + Number(row.amount), 0);
}

export async function findBalance(db: SupabaseClient, dateFrom: string, dateTo: string): Promise<Balance> {
  return {
    incomes: await sumAmounts(db, "incomes", dateFrom, dateTo),
    expenses: await sumAmounts(db, "expenses", dateFrom, dateTo),
  };
}

function savingsLine({ incomes, expenses }: Balance): string {
  const savings = incomes - expenses;
  if (incomes <= 0) return `• Ahorro: ${euros.format(savings)} (no hay ingresos registrados en este periodo)`;
  if (savings < 0) return `• Ahorro: ${euros.format(savings)} (has gastado más de lo que ha entrado)`;
  return `• Ahorro: ${euros.format(savings)} (${Math.round((savings / incomes) * 100)} % de lo que ha entrado)`;
}

export function formatBalance(balance: Balance, dateFrom: string, dateTo: string): string {
  return [
    `Balance ${describePeriod({ dateFrom, dateTo, category: null })}:`,
    `• Ingresos: ${euros.format(balance.incomes)}`,
    `• Gastos: ${euros.format(balance.expenses)}`,
    savingsLine(balance),
  ].join("\n");
}

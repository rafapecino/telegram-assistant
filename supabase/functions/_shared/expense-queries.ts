import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  categoryTotalLines,
  euros,
  EXPENSE_CATEGORIES,
  expenseLine,
  type StoredExpense,
  totalAmount,
} from "./expenses.ts";

/** Formato que el modelo debe devolver cuando el mensaje pregunta por los gastos (ver message-intent.ts). */
export const EXPENSES_QUERY_INTENT_FORMAT =
  'Pregunta por sus gastos: {"intent": "expenses_query", "date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD", ' +
  `"category": una de ${JSON.stringify(EXPENSE_CATEGORIES)} o null}. ` +
  'Sin periodo indicado, los últimos 7 días hasta hoy; "esta semana" empieza el lunes; "este mes", el día 1. ' +
  "category es null si no pregunta por una categoría concreta.";

// Telegram corta los mensajes de más de 4096 caracteres.
const MAX_LISTED_EXPENSES = 20;

export interface ExpenseQuery {
  dateFrom: string;
  dateTo: string;
  category: string | null;
}

export type ExpenseQueryRequest =
  | { kind: "expenses_query"; query: ExpenseQuery }
  | { kind: "invalid"; message: string };

function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/** Valida la respuesta del modelo antes de consultar la base de datos. */
export function parseExpenseQuery(raw: unknown): ExpenseQueryRequest {
  const candidate = raw as { date_from?: unknown; date_to?: unknown; category?: unknown } | null;
  const dateFrom = candidate?.date_from;
  const dateTo = candidate?.date_to;
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo) {
    return { kind: "invalid", message: "No he entendido de qué fechas quieres ver los gastos." };
  }
  const category = candidate?.category ?? null;
  if (category !== null && !EXPENSE_CATEGORIES.includes(String(category))) {
    return {
      kind: "invalid",
      message: `No conozco la categoría "${category}". Las que uso son: ${EXPENSE_CATEGORIES.join(", ")}.`,
    };
  }
  return { kind: "expenses_query", query: { dateFrom, dateTo, category: category as string | null } };
}

export async function findExpenses(db: SupabaseClient, query: ExpenseQuery): Promise<StoredExpense[]> {
  let request = db.from("expenses")
    .select("booking_date, amount, description, category")
    .gte("booking_date", query.dateFrom)
    .lte("booking_date", query.dateTo)
    .order("booking_date", { ascending: false });
  if (query.category) request = request.eq("category", query.category);
  const { data, error } = await request;
  if (error) throw new Error(`No se pudieron leer los gastos: ${error.message}`);
  return data;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

function describePeriod(query: ExpenseQuery): string {
  const period = query.dateFrom === query.dateTo
    ? `del ${formatDate(query.dateFrom)}`
    : `del ${formatDate(query.dateFrom)} al ${formatDate(query.dateTo)}`;
  return query.category ? `${period} en ${query.category}` : period;
}

/** Recibe los gastos ordenados del más reciente al más antiguo, como los devuelve findExpenses. */
export function formatExpenseReport(expenses: StoredExpense[], query: ExpenseQuery): string {
  const period = describePeriod(query);
  if (expenses.length === 0) return `No tienes gastos ${period}.`;
  const lines = [`Gastos ${period}: ${euros.format(totalAmount(expenses))} en ${expenses.length} gastos.`];
  if (!query.category) lines.push("", "Por categoría:", ...categoryTotalLines(expenses));
  lines.push("", "Detalle:", ...expenses.slice(0, MAX_LISTED_EXPENSES).map(expenseLine));
  if (expenses.length > MAX_LISTED_EXPENSES) lines.push(`… y ${expenses.length - MAX_LISTED_EXPENSES} más.`);
  return lines.join("\n");
}

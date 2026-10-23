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
  `"category": una de ${JSON.stringify(EXPENSE_CATEGORIES)} o null, "place": "<sitio>" o null}. ` +
  'Sin periodo indicado, los últimos 7 días hasta hoy; "esta semana" empieza el lunes; "este mes", el día 1. ' +
  "category es null si no pregunta por una categoría concreta. place es el nombre del comercio o sitio si pregunta " +
  'por uno concreto ("¿cuánto he gastado en Mercadona?" → "Mercadona"; tabaco o estancos → "tabaco"), con ' +
  "category null; si no, null.";

/** El banco no dice «estanco»: los estancos aparecen como «EXPENDEDURIA 16», «ESTANCO…» o «TABACOS…». */
export const TOBACCO_PATTERNS = ["expendedur", "estanc", "tabac"];
const MAX_PLACE_LENGTH = 50;

function isTobacco(place: string): boolean {
  return /tabac|estanc|cigarr/i.test(place);
}

// Telegram corta los mensajes de más de 4096 caracteres.
const MAX_LISTED_EXPENSES = 20;

export interface ExpenseQuery {
  dateFrom: string;
  dateTo: string;
  category: string | null;
  /** Comercio o sitio: solo los movimientos cuya descripción lo contiene. */
  place?: string;
}

export type ExpenseQueryRequest =
  | { kind: "expenses_query"; query: ExpenseQuery }
  | { kind: "invalid"; message: string };

export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/** Valida la respuesta del modelo antes de consultar la base de datos. */
export function parseExpenseQuery(raw: unknown): ExpenseQueryRequest {
  const candidate = raw as { date_from?: unknown; date_to?: unknown; category?: unknown; place?: unknown } | null;
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
  // Los comodines de LIKE (% y _) se quitan para que el sitio se busque tal cual.
  const place = typeof candidate?.place === "string"
    ? candidate.place.replace(/[%_,()]/g, " ").trim().slice(0, MAX_PLACE_LENGTH)
    : "";
  if (place) return { kind: "expenses_query", query: { dateFrom, dateTo, category: null, place } };
  return { kind: "expenses_query", query: { dateFrom, dateTo, category: category as string | null } };
}

export async function findExpenses(db: SupabaseClient, query: ExpenseQuery): Promise<StoredExpense[]> {
  let request = db.from("expenses")
    .select("booking_date, amount, description, category")
    .gte("booking_date", query.dateFrom)
    .lte("booking_date", query.dateTo)
    .order("booking_date", { ascending: false });
  if (query.category) request = request.eq("category", query.category);
  if (query.place && isTobacco(query.place)) {
    request = request.or(TOBACCO_PATTERNS.map((pattern) => `description.ilike.%${pattern}%`).join(","));
  } else if (query.place) {
    request = request.ilike("description", `%${query.place}%`);
  }
  const { data, error } = await request;
  if (error) throw new Error(`No se pudieron leer los gastos: ${error.message}`);
  return data;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

export function describePeriod(query: ExpenseQuery): string {
  const period = query.dateFrom === query.dateTo
    ? `del ${formatDate(query.dateFrom)}`
    : `del ${formatDate(query.dateFrom)} al ${formatDate(query.dateTo)}`;
  const where = query.place ?? query.category;
  return where ? `${period} en ${where}` : period;
}

/** Recibe los gastos ordenados del más reciente al más antiguo, como los devuelve findExpenses. */
export function formatExpenseReport(expenses: StoredExpense[], query: ExpenseQuery): string {
  const period = describePeriod(query);
  if (expenses.length === 0) return `No tienes gastos ${period}.`;
  const lines = [`Gastos ${period}: ${euros.format(totalAmount(expenses))} en ${expenses.length} gastos.`];
  if (!query.category && !query.place) lines.push("", "Por categoría:", ...categoryTotalLines(expenses));
  lines.push("", "Detalle:", ...expenses.slice(0, MAX_LISTED_EXPENSES).map(expenseLine));
  if (expenses.length > MAX_LISTED_EXPENSES) lines.push(`… y ${expenses.length - MAX_LISTED_EXPENSES} más.`);
  return lines.join("\n");
}

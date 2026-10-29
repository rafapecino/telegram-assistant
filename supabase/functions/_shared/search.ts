// Búsqueda de movimientos (Finanzas) y búsqueda global del panel: recordatorios, eventos, hábitos, compra y
// movimientos.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { CalendarNotConnectedError, type CalendarEvent, listEvents } from "./calendar.ts";
import { UserFacingError } from "./errors.ts";
import { EXPENSE_CATEGORIES } from "./expenses.ts";
import { addDaysToDate } from "./madrid-time.ts";

const MAX_QUERY = 100;
const MAX_RANGE_DAYS = 731;
export const INCOME_CATEGORY = "Ingresos";

export interface MovementFilters {
  text: string;
  category: string;
  from: string | null;
  to: string | null;
}

export interface Movement {
  kind: "expense" | "income";
  id: number;
  booking_date: string;
  description: string;
  amount: number;
  category: string;
}

/** En ilike, % y _ son comodines: escapados, se buscan tal cual. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function validText(raw: string | null): string {
  const text = (raw ?? "").trim();
  if (text.length > MAX_QUERY) throw new UserFacingError(`Busca con un texto de hasta ${MAX_QUERY} caracteres.`);
  return text;
}

function validDate(raw: string | null, name: string): string | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00Z`))) {
    throw new UserFacingError(`La fecha «${name}» no es válida.`);
  }
  return raw;
}

export function parseMovementFilters(params: URLSearchParams): MovementFilters {
  const category = (params.get("category") ?? "").trim();
  if (category && category !== INCOME_CATEGORY && !EXPENSE_CATEGORIES.includes(category)) {
    throw new UserFacingError("Categoría no válida.");
  }
  const from = validDate(params.get("from"), "desde"), to = validDate(params.get("to"), "hasta");
  if (from && to && from > to) throw new UserFacingError("La fecha «desde» es posterior a «hasta».");
  if (from && to && from < addDaysToDate(to, -MAX_RANGE_DAYS)) {
    throw new UserFacingError("Busca en un periodo de como mucho dos años.");
  }
  return { text: validText(params.get("q")), category, from, to };
}

async function searchTable(
  db: SupabaseClient,
  kind: Movement["kind"],
  filters: MovementFilters,
  limit: number,
): Promise<Movement[]> {
  const columns = kind === "expense"
    ? "id,booking_date,description,amount,category"
    : "id,booking_date,description,amount";
  let query = db.from(kind === "expense" ? "expenses" : "incomes").select(columns);
  if (filters.text) query = query.ilike("description", likePattern(filters.text));
  if (kind === "expense" && filters.category) query = query.eq("category", filters.category);
  if (filters.from) query = query.gte("booking_date", filters.from);
  if (filters.to) query = query.lte("booking_date", filters.to);
  const { data, error } = await query.order("booking_date", { ascending: false }).limit(limit);
  if (error) throw new Error(`No se pudieron buscar los movimientos: ${error.message}`);
  return (data as unknown as Omit<Movement, "kind">[]).map((row) => ({
    ...row,
    kind,
    amount: Number(row.amount),
    category: kind === "expense" ? row.category : INCOME_CATEGORY,
  }));
}

/**
 * Gastos e ingresos que cumplen los filtros, los más recientes primero. La categoría Ingresos deja fuera los gastos.
 */
export async function searchMovements(db: SupabaseClient, filters: MovementFilters, limit = 300): Promise<Movement[]> {
  const isIncomeOnly = filters.category === INCOME_CATEGORY;
  const [expenses, incomes] = await Promise.all([
    isIncomeOnly ? [] : searchTable(db, "expense", filters, limit),
    filters.category && !isIncomeOnly ? [] : searchTable(db, "income", filters, limit),
  ]);
  return [...expenses, ...incomes].sort((a, b) => b.booking_date.localeCompare(a.booking_date)).slice(0, limit);
}

const GLOBAL_LIMIT = 8;

export interface GlobalResults {
  reminders: { id: number; text: string; remind_at: string }[];
  events: CalendarEvent[];
  habits: { id: number; name: string }[];
  shopping: { id: number; text: string }[];
  notes: { id: number; text: string; created_at: string }[];
  movements: Movement[];
  // Si Google falla, se enseña lo demás y se avisa.
  eventsProblem?: string;
}

async function searchColumn<T>(db: SupabaseClient, table: string, columns: string, column: string, text: string) {
  const { data, error } = await db.from(table).select(columns).ilike(column, likePattern(text)).limit(GLOBAL_LIMIT);
  if (error) throw new Error(`No se pudo buscar en ${table}: ${error.message}`);
  return data as unknown as T[];
}

async function searchEvents(db: SupabaseClient, text: string, today: string): Promise<CalendarEvent[]> {
  const events = await listEvents(db, addDaysToDate(today, -365), addDaysToDate(today, 365), text);
  return events.slice(0, GLOBAL_LIMIT);
}

export async function searchEverything(db: SupabaseClient, raw: string | null, today: string): Promise<GlobalResults> {
  const text = validText(raw);
  if (text.length < 2) throw new UserFacingError("Escribe al menos dos letras para buscar.");
  const [reminders, habits, shopping, notes, movements, events] = await Promise.all([
    searchColumn<GlobalResults["reminders"][number]>(db, "reminders", "id,text,remind_at", "text", text),
    searchColumn<GlobalResults["habits"][number]>(db, "habits", "id,name", "name", text),
    searchColumn<GlobalResults["shopping"][number]>(db, "shopping_items", "id,text", "text", text),
    searchColumn<GlobalResults["notes"][number]>(db, "notes", "id,text,created_at", "text", text),
    searchMovements(db, { text, category: "", from: null, to: null }, GLOBAL_LIMIT),
    searchEvents(db, text, today).then((found) => ({ found }), (error: unknown) => ({ error })),
  ]);
  const results: GlobalResults = { reminders, habits, shopping, notes, movements, events: [] };
  if ("found" in events) results.events = events.found;
  else if (!(events.error instanceof CalendarNotConnectedError)) {
    console.error("No se pudo buscar en el calendario:", events.error);
    results.eventsProblem = "No he podido buscar en Google Calendar ahora mismo.";
  }
  return results;
}

// Gastos e ingresos apuntados a mano desde el botón «Añadir» del panel (los que no pasan por el banco).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { UserFacingError } from "./errors.ts";
import { EXPENSE_CATEGORIES } from "./expenses.ts";
import { addDaysToDate } from "./madrid-time.ts";

const MAX_AMOUNT = 100_000;
const MAX_DESCRIPTION = 200;
// Lo bastante para apuntar algo olvidado; más atrás seguramente es un error al escribir la fecha.
const MAX_DAYS_BACK = 365;

export interface ManualEntry {
  amount: number;
  description: string;
  date: string;
  // Solo en los gastos.
  category?: string;
  payment_method?: "unknown" | "cash" | "card";
  request_key?: string;
}

function validAmount(raw: unknown): number {
  const amount = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new UserFacingError("Escribe un importe mayor que 0, por ejemplo 12,50.");
  }
  return Math.round(amount * 100) / 100;
}

function validDate(raw: unknown, today: string): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || (Number.isNaN(Date.parse(`${raw}T12:00:00Z`)) || new Date(`${raw}T12:00:00Z`).toISOString().slice(0,10)!==raw)) {
    throw new UserFacingError("Fecha no válida.");
  }
  if (raw > today) throw new UserFacingError("La fecha no puede ser futura.");
  if (raw < addDaysToDate(today, -MAX_DAYS_BACK)) throw new UserFacingError("La fecha es de hace más de un año.");
  return raw;
}

export function parseManualEntry(raw: Record<string, unknown>, kind: "expense" | "income", today: string): ManualEntry {
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description || description.length > MAX_DESCRIPTION) {
    throw new UserFacingError(`Escribe una descripción de hasta ${MAX_DESCRIPTION} caracteres.`);
  }
  const entry: ManualEntry = { amount: validAmount(raw.amount), description, date: validDate(raw.date, today) };
  if (kind === "income") return entry;
  if (typeof raw.category !== "string" || !EXPENSE_CATEGORIES.includes(raw.category)) {
    throw new UserFacingError("Elige una categoría.");
  }
  if(raw.payment_method!==undefined&&!['unknown','cash','card'].includes(String(raw.payment_method)))throw new UserFacingError('Método de pago no válido.');
  if(raw.request_key!==undefined&&!/^[a-f0-9-]{36}$/.test(String(raw.request_key)))throw new UserFacingError('Identificador de operación no válido.');
  return { ...entry, category: raw.category,payment_method:(raw.payment_method??'unknown') as 'unknown'|'cash'|'card',...(raw.request_key?{request_key:String(raw.request_key)}:{}) };
}

export async function saveManualEntry(
  db: SupabaseClient,
  kind: "expense" | "income",
  entry: ManualEntry,
): Promise<void> {
  const { error } = await db.from(kind === "expense" ? "expenses" : "incomes").upsert({
    // Sin cuenta del banco: la clave solo tiene que ser única para no chocar con los movimientos importados.
    account_uid: "manual",
    transaction_key: `manual|${entry.request_key??crypto.randomUUID()}`,
    booking_date: entry.date,
    amount: entry.amount,
    currency: "EUR",
    description: entry.description,
    ...(entry.category ? { category: entry.category, payment_method:entry.payment_method??'unknown' } : {}),
  },{onConflict:'transaction_key',ignoreDuplicates:true});
  if (error) throw new Error(`No se pudo apuntar el ${kind === "expense" ? "gasto" : "ingreso"}: ${error.message}`);
}

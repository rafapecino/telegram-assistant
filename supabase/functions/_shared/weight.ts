import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { isCalendarDate } from "./expense-queries.ts";

const MIN_KG = 20;
const MAX_KG = 400;
const LISTED_ENTRIES = 8;

/** Formato que el modelo debe devolver cuando el mensaje habla del peso (ver message-intent.ts). */
export const WEIGHT_INTENT_FORMAT =
  'Peso corporal: {"intent": "weight", "action": "save", "kg": 72.5, "date": "YYYY-MM-DD"} para apuntar lo que pesa ' +
  '("peso 72,5", "hoy peso 80 kilos"; sin fecha, hoy), o {"intent": "weight", "action": "list"} para ver cómo va.';

export type WeightRequest =
  | { kind: "weight_save"; kg: number; date: string }
  | { kind: "weight_list" }
  | { kind: "invalid"; message: string };

export interface WeightEntry {
  date: string;
  kg: number;
}

export function parseWeightRequest(raw: unknown, today: string): WeightRequest {
  const candidate = raw as { action?: unknown; kg?: unknown; date?: unknown } | null;
  if (candidate?.action === "list") return { kind: "weight_list" };
  if (candidate?.action !== "save") return { kind: "invalid", message: "No he entendido qué hacer con tu peso." };
  const kg = Number(String(candidate.kg ?? "").replace(",", "."));
  if (!Number.isFinite(kg) || kg <= MIN_KG || kg >= MAX_KG) {
    return { kind: "invalid", message: "No he entendido el peso. Dímelo en kilos, por ejemplo «peso 72,5»." };
  }
  const date = candidate.date ?? today;
  if (!isCalendarDate(date) || date > today) {
    return { kind: "invalid", message: "No he entendido la fecha del peso." };
  }
  return { kind: "weight_save", kg: Math.round(kg * 10) / 10, date };
}

/** Si ya había peso ese día, se sustituye. */
export async function saveWeight(db: SupabaseClient, date: string, kg: number): Promise<void> {
  const { error } = await db.from("weight_entries").upsert({ date, kg }, { onConflict: "date" });
  if (error) throw new Error(`No se pudo guardar el peso: ${error.message}`);
}

/** Del más antiguo al más reciente. */
export async function listWeights(db: SupabaseClient): Promise<WeightEntry[]> {
  const { data, error } = await db.from("weight_entries").select("date, kg").order("date");
  if (error) throw new Error(`No se pudo leer tu peso: ${error.message}`);
  return (data ?? []).map((entry) => ({ date: entry.date, kg: Number(entry.kg) }));
}

const kilos = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "UTC" });

function formatDay(date: string): string {
  return shortDate.format(new Date(`${date}T00:00:00Z`));
}

/** "+0,3 kg", "−1,2 kg" o "sin cambios". */
export function describeChange(from: number, to: number): string {
  const change = Math.round((to - from) * 10) / 10;
  if (change === 0) return "sin cambios";
  return `${change > 0 ? "+" : "−"}${kilos.format(Math.abs(change))} kg`;
}

export function describeSavedWeight(entries: WeightEntry[], date: string, kg: number): string {
  const previous = entries.filter((entry) => entry.date < date).at(-1);
  const saved = `Apuntado: ${kilos.format(kg)} kg el ${formatDay(date)}.`;
  return previous ? `${saved} ${describeChange(previous.kg, kg)} desde el ${formatDay(previous.date)}.` : saved;
}

export function formatWeightTrend(entries: WeightEntry[]): string {
  if (entries.length === 0) return "Aún no has apuntado tu peso. Dime, por ejemplo, «peso 72,5».";
  const recent = entries.slice(-LISTED_ENTRIES);
  const lines = recent.map((entry) => `• ${formatDay(entry.date)}: ${kilos.format(entry.kg)} kg`);
  const first = entries[0], last = entries[entries.length - 1];
  const total = entries.length > 1 ? [`Desde el ${formatDay(first.date)}: ${describeChange(first.kg, last.kg)}.`] : [];
  return ["Tu peso:", ...lines, ...total].join("\n");
}

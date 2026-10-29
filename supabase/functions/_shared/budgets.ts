import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { euros, EXPENSE_CATEGORIES } from "./expenses.ts";
import { madridMonthStart } from "./madrid-time.ts";
import { sendTelegramMessage } from "./telegram.ts";

/** Presupuesto de todo el gasto del mes, no de una categoría. */
export const TOTAL_BUDGET = "Total";
const BUDGET_CATEGORIES = [...EXPENSE_CATEGORIES, TOTAL_BUDGET];
const MAX_MONTHLY_LIMIT = 1_000_000;

/** Formato que el modelo debe devolver cuando el mensaje habla de presupuestos (ver message-intent.ts). */
export const BUDGET_INTENT_FORMAT =
  'Habla de presupuestos (límites de gasto al mes): {"intent": "budget", "action": "set", "category": ' +
  `una de ${JSON.stringify(BUDGET_CATEGORIES)} o null, "monthly_limit": número en euros o null}. ` +
  'action es "set" para poner o cambiar un límite, "delete" para quitarlo y "list" para preguntar cómo va. ' +
  `"${TOTAL_BUDGET}" es el gasto de todo el mes.`;

export type BudgetRequest =
  | { kind: "budget_set"; category: string; monthlyLimit: number }
  | { kind: "budget_delete"; category: string }
  | { kind: "budget_list" }
  | { kind: "invalid"; message: string };

/** Valida la respuesta del modelo antes de tocar la base de datos. */
export function parseBudgetRequest(raw: unknown): BudgetRequest {
  const candidate = raw as { action?: unknown; category?: unknown; monthly_limit?: unknown } | null;
  if (candidate?.action === "list") return { kind: "budget_list" };
  const category = candidate?.category;
  if (typeof category !== "string" || !BUDGET_CATEGORIES.includes(category)) {
    return {
      kind: "invalid",
      message: `No sé de qué categoría es el presupuesto. Las que uso son: ${BUDGET_CATEGORIES.join(", ")}.`,
    };
  }
  if (candidate?.action === "delete") return { kind: "budget_delete", category };
  if (candidate?.action !== "set") return { kind: "invalid", message: "No he entendido qué hacer con el presupuesto." };
  const limit = Number(candidate.monthly_limit);
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_MONTHLY_LIMIT) {
    return { kind: "invalid", message: "No he entendido el límite. Dime una cantidad, por ejemplo «200 € al mes»." };
  }
  return { kind: "budget_set", category, monthlyLimit: Math.round(limit * 100) / 100 };
}

export interface Budget {
  id: number;
  category: string;
  monthly_limit: number;
}

export interface BudgetStatus {
  budget: Budget;
  spent: number;
}

/** Cuánto se lleva gastado este mes en cada presupuesto. `monthExpenses` son los gastos del mes en curso. */
export function budgetStatuses(
  budgets: Budget[],
  monthExpenses: { category: string; amount: number }[],
): BudgetStatus[] {
  return budgets.map((budget) => {
    const counted = monthExpenses.filter((expense) =>
      budget.category === TOTAL_BUDGET || expense.category === budget.category
    );
    const spent = counted.reduce((sum, expense) => sum + Number(expense.amount), 0);
    return { budget, spent: Math.round(spent * 100) / 100 };
  });
}

function percentOf(status: BudgetStatus): number {
  return Math.round((status.spent / Number(status.budget.monthly_limit)) * 100);
}

/** Umbrales que ya se han pasado este mes: 80 % y 100 % del límite. */
export function crossedThresholds(status: BudgetStatus): (80 | 100)[] {
  const limit = Number(status.budget.monthly_limit);
  if (status.spent >= limit) return [80, 100];
  if (status.spent >= limit * 0.8) return [80];
  return [];
}

/** "presupuesto de Restaurantes" o "presupuesto total". */
export function budgetName(category: string): string {
  return category === TOTAL_BUDGET ? "presupuesto total" : `presupuesto de ${category}`;
}

export function budgetAlertMessage(status: BudgetStatus, threshold: 80 | 100): string {
  const amounts = `${euros.format(status.spent)} de ${euros.format(Number(status.budget.monthly_limit))}`;
  const name = budgetName(status.budget.category);
  if (threshold === 100) return `🚨 Te has pasado del ${name}: llevas ${amounts} este mes (${percentOf(status)} %).`;
  return `⚠️ Llevas ${amounts} del ${name} este mes (${percentOf(status)} %).`;
}

/** Qué avisar: de cada presupuesto, solo el umbral más alto pasado que no se haya avisado ya este mes. */
export function pendingAlerts(
  statuses: BudgetStatus[],
  alreadySent: Set<string>,
): { status: BudgetStatus; threshold: 80 | 100 }[] {
  return statuses.flatMap((status) => {
    const highest = crossedThresholds(status).at(-1);
    if (!highest || alreadySent.has(`${status.budget.id}:${highest}`)) return [];
    return [{ status, threshold: highest }];
  });
}

function statusLine(status: BudgetStatus): string {
  const thresholds = crossedThresholds(status);
  const mark = thresholds.includes(100) ? "🚨" : thresholds.includes(80) ? "⚠️" : "✅";
  const amounts = `${euros.format(status.spent)} de ${euros.format(Number(status.budget.monthly_limit))}`;
  return `${mark} ${status.budget.category}: ${amounts} (${percentOf(status)} %)`;
}

export function formatBudgetList(statuses: BudgetStatus[]): string {
  if (statuses.length === 0) {
    return "No tienes presupuestos. Crea uno, por ejemplo: «pon un límite de 200 € al mes en restaurantes».";
  }
  return ["Presupuestos de este mes:", ...statuses.map(statusLine)].join("\n");
}

export async function loadBudgetStatuses(db: SupabaseClient, now: Date): Promise<BudgetStatus[]> {
  const { data: budgets, error } = await db.from("budgets").select("id, category, monthly_limit").order("category");
  if (error) throw new Error(`No se pudieron leer los presupuestos: ${error.message}`);
  if (budgets.length === 0) return [];
  const { data: expenses, error: expensesError } = await db.from("expenses")
    .select("category, amount").is('duplicate_of',null)
    .gte("booking_date", madridMonthStart(now));
  if (expensesError) throw new Error(`No se pudieron leer los gastos del mes: ${expensesError.message}`);
  return budgetStatuses(budgets, expenses);
}

async function markAlertsSent(db: SupabaseClient, status: BudgetStatus, month: string): Promise<void> {
  const rows = crossedThresholds(status).map((threshold) => ({ budget_id: status.budget.id, month, threshold }));
  if (rows.length === 0) return;
  const { error } = await db.from("budget_alerts")
    .upsert(rows, { onConflict: "budget_id,month,threshold", ignoreDuplicates: true });
  if (error) throw new Error(`No se pudo guardar el aviso de presupuesto: ${error.message}`);
}

/** Avisa por Telegram de los presupuestos que han pasado del 80 % o del 100 %, una vez por umbral y mes. */
export async function checkBudgetAlerts(db: SupabaseClient, now: Date): Promise<number> {
  const statuses = await loadBudgetStatuses(db, now);
  if (statuses.length === 0) return 0;
  const month = madridMonthStart(now);
  const { data: sent, error } = await db.from("budget_alerts").select("budget_id, threshold").eq("month", month);
  if (error) throw new Error(`No se pudieron leer los avisos de presupuesto: ${error.message}`);
  const alreadySent = new Set(sent.map((alert) => `${alert.budget_id}:${alert.threshold}`));
  const alerts = pendingAlerts(statuses, alreadySent);
  for (const { status, threshold } of alerts) {
    // Primero se avisa y luego se marca: si falla el envío, se reintenta en la siguiente importación.
    await sendTelegramMessage(budgetAlertMessage(status, threshold));
    await markAlertsSent(db, status, month);
  }
  return alerts.length;
}

/**
 * Guarda (o cambia) un presupuesto y devuelve cómo va este mes. Los avisos del mes se recalculan con el nuevo límite,
 * y los umbrales ya pasados se dan por avisados porque la respuesta ya lo dice.
 */
export async function saveBudget(
  db: SupabaseClient,
  category: string,
  monthlyLimit: number,
  now: Date,
): Promise<BudgetStatus> {
  const { data: budget, error } = await db.from("budgets")
    .upsert({ category, monthly_limit: monthlyLimit }, { onConflict: "category" })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo guardar el presupuesto: ${error.message}`);
  const month = madridMonthStart(now);
  const { error: resetError } = await db.from("budget_alerts").delete().eq("budget_id", budget.id).eq("month", month);
  if (resetError) throw new Error(`No se pudieron reiniciar los avisos del presupuesto: ${resetError.message}`);
  const status = (await loadBudgetStatuses(db, now)).find((candidate) => candidate.budget.id === budget.id);
  if (!status) throw new Error("El presupuesto se ha guardado pero no se ha podido leer.");
  await markAlertsSent(db, status, month);
  return status;
}

export function describeSavedBudget(status: BudgetStatus): string {
  const name = budgetName(status.budget.category);
  return `${name[0].toUpperCase()}${name.slice(1)} guardado: ${
    euros.format(Number(status.budget.monthly_limit))
  } al mes. ` +
    `Este mes llevas ${euros.format(status.spent)} (${percentOf(status)} %).`;
}

/** Devuelve si existía. */
export async function deleteBudget(db: SupabaseClient, category: string): Promise<boolean> {
  const { data, error } = await db.from("budgets").delete().eq("category", category).select("id");
  if (error) throw new Error(`No se pudo borrar el presupuesto: ${error.message}`);
  return data.length > 0;
}

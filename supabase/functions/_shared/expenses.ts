import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { getActiveBankSession } from "./bank-connection.ts";
import { type BankTransaction, fetchTransactions } from "./enable-banking.ts";
import { askGroqForJson } from "./groq.ts";
import { madridDateDaysAgo } from "./madrid-time.ts";
import { sendTelegramMessage } from "./telegram.ts";

export const EXPENSE_CATEGORIES = [
  "Supermercado",
  "Restaurantes",
  "Transporte",
  "Hogar",
  "Suscripciones",
  "Ocio",
  "Salud",
  "Compras",
  "Otros",
];

// Los bancos tardan varios días en asentar algunos cargos; la ventana se solapa y los duplicados se descartan.
const IMPORT_WINDOW_DAYS = 7;

export interface NewExpense {
  bank_transaction_id: string;
  account_uid: string;
  booking_date: string;
  amount: number;
  currency: string;
  description: string;
}

export interface StoredExpense {
  booking_date: string;
  amount: number;
  description: string;
  category: string;
}

/** Convierte un movimiento del banco en gasto. Ingresos y movimientos sin asentar se ignoran. */
export function toNewExpense(transaction: BankTransaction, accountUid: string): NewExpense | null {
  if (transaction.status !== "BOOK" || transaction.credit_debit_indicator !== "DBIT") return null;
  const bookingDate = transaction.booking_date ?? transaction.value_date ?? transaction.transaction_date;
  if (!bookingDate) throw new Error(`Movimiento sin fecha: ${JSON.stringify(transaction)}`);
  const amount = Math.abs(Number(transaction.transaction_amount.amount));
  const description = transaction.creditor?.name || transaction.remittance_information?.join(" ") || "Sin descripción";
  // Si el banco no da identificador, se construye uno con los datos del cargo.
  const bankTransactionId = transaction.entry_reference ?? transaction.transaction_id ??
    `${accountUid}|${bookingDate}|${amount}|${description}`;
  return {
    bank_transaction_id: bankTransactionId,
    account_uid: accountUid,
    booking_date: bookingDate,
    amount,
    currency: transaction.transaction_amount.currency,
    description,
  };
}

export function buildCategorizationPrompt(): string {
  return [
    `Clasifica cada gasto bancario en una de estas categorías: ${EXPENSE_CATEGORIES.join(", ")}.`,
    "Recibirás una lista JSON de gastos con su descripción e importe.",
    'Responde solo con JSON {"categories": [...]}: una categoría por gasto, en el mismo orden.',
  ].join("\n");
}

/** Una categoría fuera de la lista se guarda como "Otros" para que el resumen agrupe siempre igual. */
export function parseCategories(raw: unknown, expectedCount: number): string[] {
  const categories = (raw as { categories?: unknown } | null)?.categories;
  if (!Array.isArray(categories) || categories.length !== expectedCount) {
    throw new Error(`Groq no devolvió una categoría por gasto (esperaba ${expectedCount}).`);
  }
  return categories.map((category) => EXPENSE_CATEGORIES.includes(category) ? category : "Otros");
}

async function categorizeExpenses(expenses: NewExpense[]): Promise<string[]> {
  const items = expenses.map((expense) => ({ descripcion: expense.description, importe: expense.amount }));
  const raw = await askGroqForJson(buildCategorizationPrompt(), JSON.stringify(items));
  return parseCategories(raw, expenses.length);
}

async function excludeAlreadyImported(db: SupabaseClient, candidates: NewExpense[]): Promise<NewExpense[]> {
  const uniqueCandidates = [...new Map(candidates.map((expense) => [expense.bank_transaction_id, expense])).values()];
  if (uniqueCandidates.length === 0) return [];
  const { data, error } = await db.from("expenses")
    .select("bank_transaction_id")
    .in("bank_transaction_id", uniqueCandidates.map((expense) => expense.bank_transaction_id));
  if (error) throw new Error(`No se pudieron comprobar los gastos ya importados: ${error.message}`);
  const importedIds = new Set(data.map((row) => row.bank_transaction_id));
  return uniqueCandidates.filter((expense) => !importedIds.has(expense.bank_transaction_id));
}

async function fetchCandidateExpenses(accountUids: string[], dateFrom: string): Promise<NewExpense[]> {
  const candidates: NewExpense[] = [];
  for (const accountUid of accountUids) {
    const transactions = await fetchTransactions(accountUid, dateFrom);
    candidates.push(
      ...transactions.map((transaction) => toNewExpense(transaction, accountUid))
        .filter((expense): expense is NewExpense => expense !== null),
    );
  }
  return candidates;
}

/** Importa los gastos recientes del banco, los clasifica y devuelve cuántos eran nuevos. */
export async function importRecentExpenses(db: SupabaseClient, now: Date): Promise<number> {
  const session = await getActiveBankSession(db, now);
  if (!session) throw new Error("No hay ninguna conexión con el banco activa. Conéctalo con /conectar_banco.");
  const candidates = await fetchCandidateExpenses(session.accountUids, madridDateDaysAgo(now, IMPORT_WINDOW_DAYS));
  const newExpenses = await excludeAlreadyImported(db, candidates);
  if (newExpenses.length === 0) return 0;

  const categories = await categorizeExpenses(newExpenses);
  const { error } = await db.from("expenses").upsert(
    newExpenses.map((expense, index) => ({ ...expense, category: categories[index] })),
    { onConflict: "bank_transaction_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`No se pudieron guardar los gastos: ${error.message}`);
  return newExpenses.length;
}

// La cuenta es en euros; si algún día hay varias divisas, el total habría que separarlo por divisa.
const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function buildWeeklySummary(expenses: StoredExpense[]): string {
  if (expenses.length === 0) return "Resumen semanal: no hay gastos en los últimos 7 días.";
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const totalsByCategory = new Map<string, number>();
  for (const expense of expenses) {
    totalsByCategory.set(expense.category, (totalsByCategory.get(expense.category) ?? 0) + Number(expense.amount));
  }
  const categoryLines = [...totalsByCategory.entries()]
    .sort(([, first], [, second]) => second - first)
    .map(([category, amount]) => `• ${category}: ${euros.format(amount)}`);
  const largestLines = [...expenses]
    .sort((first, second) => Number(second.amount) - Number(first.amount))
    .slice(0, 3)
    .map((expense) => `• ${expense.description}: ${euros.format(Number(expense.amount))} (${expense.booking_date})`);
  return [
    `Resumen semanal: ${euros.format(total)} en ${expenses.length} gastos.`,
    "",
    "Por categoría:",
    ...categoryLines,
    "",
    "Gastos más grandes:",
    ...largestLines,
  ].join("\n");
}

export async function sendWeeklySummary(db: SupabaseClient, now: Date): Promise<void> {
  const { data, error } = await db.from("expenses")
    .select("booking_date, amount, description, category")
    .gte("booking_date", madridDateDaysAgo(now, 6));
  if (error) throw new Error(`No se pudieron leer los gastos de la semana: ${error.message}`);
  await sendTelegramMessage(buildWeeklySummary(data));
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { getActiveBankSession, hasBankConnections } from "./bank-connection.ts";
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

export interface ExpenseCandidate {
  account_uid: string;
  booking_date: string;
  amount: number;
  currency: string;
  description: string;
}

export interface NewExpense extends ExpenseCandidate {
  transaction_key: string;
}

export interface StoredExpense {
  booking_date: string;
  amount: number;
  description: string;
  category: string;
}

const CARD_NUMBER_PATTERN = /\b\d{13,19}\b/g;

/** Deja solo los 4 últimos dígitos de un número de tarjeta para no guardarlo ni enviarlo a Groq ni a Telegram. */
export function maskCardNumbers(text: string): string {
  return text.replace(CARD_NUMBER_PATTERN, (cardNumber) => `****${cardNumber.slice(-4)}`);
}

/** Convierte un movimiento del banco en gasto. Ingresos y movimientos sin asentar se ignoran. */
export function toExpenseCandidate(transaction: BankTransaction, accountUid: string): ExpenseCandidate | null {
  if (transaction.status !== "BOOK" || transaction.credit_debit_indicator !== "DBIT") return null;
  const bookingDate = transaction.booking_date ?? transaction.value_date ?? transaction.transaction_date;
  if (!bookingDate) throw new Error(`Movimiento sin fecha: ${JSON.stringify(transaction)}`);
  const description = transaction.creditor?.name || transaction.remittance_information?.join(" ") || "Sin descripción";
  return {
    account_uid: accountUid,
    booking_date: bookingDate,
    amount: Math.abs(Number(transaction.transaction_amount.amount)),
    currency: transaction.transaction_amount.currency,
    description: maskCardNumbers(description),
  };
}

/**
 * Santander identifica cada movimiento por su posición en el día, que puede cambiar entre consultas.
 * La clave se construye con los datos del gasto y su número de orden entre gastos idénticos del mismo día:
 * los idénticos son intercambiables, así que el orden en que los devuelva el banco no importa.
 */
export function assignTransactionKeys(candidates: ExpenseCandidate[]): NewExpense[] {
  const occurrences = new Map<string, number>();
  return candidates.map((candidate) => {
    const fingerprint = [candidate.account_uid, candidate.booking_date, candidate.amount, candidate.description]
      .join("|");
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return { ...candidate, transaction_key: `${fingerprint}|${occurrence}` };
  });
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

async function excludeAlreadyImported(db: SupabaseClient, expenses: NewExpense[]): Promise<NewExpense[]> {
  if (expenses.length === 0) return [];
  const { data, error } = await db.from("expenses")
    .select("transaction_key")
    .in("transaction_key", expenses.map((expense) => expense.transaction_key));
  if (error) throw new Error(`No se pudieron comprobar los gastos ya importados: ${error.message}`);
  const importedKeys = new Set(data.map((row) => row.transaction_key));
  return expenses.filter((expense) => !importedKeys.has(expense.transaction_key));
}

async function fetchCandidateExpenses(accountUids: string[], dateFrom: string): Promise<NewExpense[]> {
  const candidates: ExpenseCandidate[] = [];
  for (const accountUid of accountUids) {
    const transactions = await fetchTransactions(accountUid, dateFrom);
    candidates.push(
      ...transactions.map((transaction) => toExpenseCandidate(transaction, accountUid))
        .filter((candidate): candidate is ExpenseCandidate => candidate !== null),
    );
  }
  return assignTransactionKeys(candidates);
}

/** Importa los gastos recientes del banco, los clasifica y devuelve cuántos eran nuevos. */
export async function importRecentExpenses(db: SupabaseClient, now: Date): Promise<number> {
  const session = await getActiveBankSession(db, now);
  if (!session) {
    // Sin conexiones guardadas (nunca conectado o desconectado con /desconectar_banco) no hay nada de qué avisar.
    // Si las hay pero han caducado, sí: hay que volver a conectar.
    if (!(await hasBankConnections(db))) return 0;
    throw new Error("No hay ninguna conexión con el banco activa. Conéctalo con /conectar_banco.");
  }
  const candidates = await fetchCandidateExpenses(session.accountUids, madridDateDaysAgo(now, IMPORT_WINDOW_DAYS));
  const newExpenses = await excludeAlreadyImported(db, candidates);
  if (newExpenses.length === 0) return 0;

  const categories = await categorizeExpenses(newExpenses);
  const { error } = await db.from("expenses").upsert(
    newExpenses.map((expense, index) => ({ ...expense, category: categories[index] })),
    { onConflict: "transaction_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(`No se pudieron guardar los gastos: ${error.message}`);
  return newExpenses.length;
}

// La cuenta es en euros; si algún día hay varias divisas, el total habría que separarlo por divisa.
export const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function totalAmount(expenses: StoredExpense[]): number {
  return expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
}

export function categoryTotalLines(expenses: StoredExpense[]): string[] {
  const totalsByCategory = new Map<string, number>();
  for (const expense of expenses) {
    totalsByCategory.set(expense.category, (totalsByCategory.get(expense.category) ?? 0) + Number(expense.amount));
  }
  return [...totalsByCategory.entries()]
    .sort(([, first], [, second]) => second - first)
    .map(([category, amount]) => `• ${category}: ${euros.format(amount)}`);
}

export function expenseLine(expense: StoredExpense): string {
  return `• ${expense.description}: ${euros.format(Number(expense.amount))} (${expense.booking_date})`;
}

export function buildWeeklySummary(expenses: StoredExpense[]): string {
  if (expenses.length === 0) return "Resumen semanal: no hay gastos en los últimos 7 días.";
  const largestLines = [...expenses]
    .sort((first, second) => Number(second.amount) - Number(first.amount))
    .slice(0, 3)
    .map(expenseLine);
  return [
    `Resumen semanal: ${euros.format(totalAmount(expenses))} en ${expenses.length} gastos.`,
    "",
    "Por categoría:",
    ...categoryTotalLines(expenses),
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

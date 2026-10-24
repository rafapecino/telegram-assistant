// Compras que no pasan por el banco (en efectivo): energéticas y tabaco apuntados desde el chat.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { euros } from "./expenses.ts";

export const ENERGY_DRINK_PRICE = 1.2;
const MAX_QUANTITY = 20;
const MAX_AMOUNT = 500;

/** Formato que el modelo debe devolver cuando pide apuntar energéticas o tabaco (ver message-intent.ts). */
export const MANUAL_EXPENSE_INTENT_FORMAT =
  'Apuntar a mano una compra de energéticas o de tabaco ("añade dos energéticas", "apunta tabaco 5,50 €"): ' +
  '{"intent": "manual_expense", "item": "energy" o "tobacco", "quantity": 2, "amount": número en euros o null}. ' +
  "quantity es cuántas (1 si no lo dice); amount, el precio total solo si lo dice.";

export type ManualExpenseRequest =
  | { kind: "manual_expense"; item: "energy" | "tobacco"; quantity: number; amount: number; date: string }
  | { kind: "invalid"; message: string };

export function parseManualExpense(raw: unknown, today: string): ManualExpenseRequest {
  const candidate = raw as { item?: unknown; quantity?: unknown; amount?: unknown } | null;
  const item = candidate?.item;
  if (item !== "energy" && item !== "tobacco") {
    return { kind: "invalid", message: "Solo sé apuntar a mano energéticas o tabaco." };
  }
  const quantity = Number(candidate?.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return { kind: "invalid", message: "No he entendido cuántas son." };
  }
  const said = candidate?.amount === null || candidate?.amount === undefined
    ? null
    : Number(String(candidate.amount).replace(",", "."));
  // La energética tiene precio fijo; el tabaco varía, así que hay que decirlo.
  const amount = said ?? (item === "energy" ? quantity * ENERGY_DRINK_PRICE : null);
  if (amount === null) {
    return { kind: "invalid", message: "Dime cuánto te ha costado, por ejemplo «apunta tabaco 5,50 €»." };
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { kind: "invalid", message: "No he entendido el precio." };
  }
  return { kind: "manual_expense", item, quantity, amount: Math.round(amount * 100) / 100, date: today };
}

/**
 * La descripción es lo que reconoce el panel: «TABACO…» entra en Tabaco y «ENERGÉTICA xN…» en Energéticas con N latas.
 */
export function manualDescription(request: Extract<ManualExpenseRequest, { kind: "manual_expense" }>): string {
  return request.item === "energy"
    ? `ENERGÉTICA x${request.quantity} (apuntado a mano)`
    : `TABACO (apuntado a mano)`;
}

export async function saveManualExpense(
  db: SupabaseClient,
  request: Extract<ManualExpenseRequest, { kind: "manual_expense" }>,
): Promise<void> {
  const { error } = await db.from("expenses").insert({
    // Sin cuenta del banco: la clave solo tiene que ser única para no chocar con los movimientos importados.
    account_uid: "manual",
    transaction_key: `manual|${crypto.randomUUID()}`,
    booking_date: request.date,
    amount: request.amount,
    currency: "EUR",
    description: manualDescription(request),
    category: "Otros",
  });
  if (error) throw new Error(`No se pudo apuntar el gasto: ${error.message}`);
}

export function describeSavedManualExpense(request: Extract<ManualExpenseRequest, { kind: "manual_expense" }>): string {
  const what = request.item === "energy"
    ? (request.quantity === 1 ? "1 energética" : `${request.quantity} energéticas`)
    : "tabaco";
  return `Apuntado en Finanzas: ${what}, ${euros.format(request.amount)}.`;
}

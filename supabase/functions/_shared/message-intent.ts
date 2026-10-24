import { BALANCE_QUERY_INTENT_FORMAT, type BalanceRequest, parseBalanceQuery } from "./balance.ts";
import { BIRTHDAY_INTENT_FORMAT, type BirthdayRequest, parseBirthdayRequest } from "./birthdays.ts";
import { BUDGET_INTENT_FORMAT, type BudgetRequest, parseBudgetRequest } from "./budgets.ts";
import { CALENDAR_INTENT_FORMAT, type CalendarRequest, parseCalendarRequest } from "./calendar.ts";
import { type ExpenseQueryRequest, EXPENSES_QUERY_INTENT_FORMAT, parseExpenseQuery } from "./expense-queries.ts";
import { askGroqForJson } from "./groq.ts";
import { HABIT_INTENT_FORMAT, type HabitRequest, parseHabitRequest } from "./habits.ts";
import { type MadridClock, madridClock } from "./madrid-time.ts";
import { MANUAL_EXPENSE_INTENT_FORMAT, type ManualExpenseRequest, parseManualExpense } from "./manual-expenses.ts";
import { NOTE_INTENT_FORMAT, type NoteRequest, parseNoteRequest } from "./notes.ts";
import { parseReminderRequest, REMINDER_INTENT_FORMAT, type ReminderRequest } from "./reminders.ts";
import { parseShoppingRequest, SHOPPING_INTENT_FORMAT, type ShoppingRequest } from "./shopping.ts";
import { parseWeightRequest, WEIGHT_INTENT_FORMAT, type WeightRequest } from "./weight.ts";

// Para añadir una funcionalidad: su formato va en buildIntentPrompt y su validación en parseMessageIntent.
export type MessageIntent =
  | ReminderRequest
  | ExpenseQueryRequest
  | BudgetRequest
  | BalanceRequest
  | ShoppingRequest
  | NoteRequest
  | BirthdayRequest
  | HabitRequest
  | CalendarRequest
  | WeightRequest
  | ManualExpenseRequest
  | { kind: "unknown" };

export function buildIntentPrompt(clock: MadridClock): string {
  return [
    "Interpretas los mensajes en español que recibe un bot personal.",
    `Ahora en Madrid es ${clock.weekday} ${clock.localDateTime}.`,
    "Responde solo con JSON en uno de estos formatos, según lo que pida el mensaje:",
    `- ${REMINDER_INTENT_FORMAT}`,
    `- ${EXPENSES_QUERY_INTENT_FORMAT}`,
    `- ${BUDGET_INTENT_FORMAT}`,
    `- ${BALANCE_QUERY_INTENT_FORMAT}`,
    `- ${SHOPPING_INTENT_FORMAT}`,
    `- ${NOTE_INTENT_FORMAT}`,
    `- ${BIRTHDAY_INTENT_FORMAT}`,
    `- ${HABIT_INTENT_FORMAT}`,
    `- ${CALENDAR_INTENT_FORMAT}`,
    `- ${WEIGHT_INTENT_FORMAT}`,
    `- ${MANUAL_EXPENSE_INTENT_FORMAT}`,
    '- Cualquier otra cosa: {"intent": "unknown"}',
  ].join("\n");
}

export function parseMessageIntent(raw: unknown, now: Date): MessageIntent {
  const intent = (raw as { intent?: unknown } | null)?.intent;
  if (intent === "reminder") return parseReminderRequest(raw, now);
  if (intent === "expenses_query") return parseExpenseQuery(raw);
  if (intent === "budget") return parseBudgetRequest(raw);
  if (intent === "balance_query") return parseBalanceQuery(raw);
  if (intent === "shopping") return parseShoppingRequest(raw);
  if (intent === "note") return parseNoteRequest(raw);
  if (intent === "birthday") return parseBirthdayRequest(raw, Number(madridClock(now).localDate.slice(0, 4)));
  if (intent === "habit") return parseHabitRequest(raw);
  if (intent === "calendar") return parseCalendarRequest(raw);
  if (intent === "weight") return parseWeightRequest(raw, madridClock(now).localDate);
  if (intent === "manual_expense") return parseManualExpense(raw, madridClock(now).localDate);
  return { kind: "unknown" };
}

/** Un mensaje anterior de la conversación (solo el chat del panel guarda historial). */
export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

/** El mensaje que se envía al modelo: con historial, entiende continuaciones como "¿y el mes pasado?". */
export function withConversation(message: string, history: ConversationTurn[]): string {
  if (history.length === 0) return message;
  const previous = history.map((turn) => `${turn.role === "user" ? "Persona" : "Asistente"}: ${turn.text}`);
  return `Conversación anterior, solo como contexto:\n${previous.join("\n")}\n\nMensaje actual: ${message}`;
}

export async function interpretMessage(
  message: string,
  now: Date,
  history: ConversationTurn[] = [],
): Promise<MessageIntent> {
  const raw = await askGroqForJson(buildIntentPrompt(madridClock(now)), withConversation(message, history));
  return parseMessageIntent(raw, now);
}

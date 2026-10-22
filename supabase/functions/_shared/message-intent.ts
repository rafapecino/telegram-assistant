import { BALANCE_QUERY_INTENT_FORMAT, type BalanceRequest, parseBalanceQuery } from "./balance.ts";
import { BIRTHDAY_INTENT_FORMAT, type BirthdayRequest, parseBirthdayRequest } from "./birthdays.ts";
import { BUDGET_INTENT_FORMAT, type BudgetRequest, parseBudgetRequest } from "./budgets.ts";
import { CALENDAR_INTENT_FORMAT, type CalendarRequest, parseCalendarRequest } from "./calendar.ts";
import { type ExpenseQueryRequest, EXPENSES_QUERY_INTENT_FORMAT, parseExpenseQuery } from "./expense-queries.ts";
import { askGroqForJson } from "./groq.ts";
import { HABIT_INTENT_FORMAT, type HabitRequest, parseHabitRequest } from "./habits.ts";
import { type MadridClock, madridClock } from "./madrid-time.ts";
import { NOTE_INTENT_FORMAT, type NoteRequest, parseNoteRequest } from "./notes.ts";
import { parseReminderRequest, REMINDER_INTENT_FORMAT, type ReminderRequest } from "./reminders.ts";
import { parseShoppingRequest, SHOPPING_INTENT_FORMAT, type ShoppingRequest } from "./shopping.ts";

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
  return { kind: "unknown" };
}

export async function interpretMessage(message: string, now: Date): Promise<MessageIntent> {
  const raw = await askGroqForJson(buildIntentPrompt(madridClock(now)), message);
  return parseMessageIntent(raw, now);
}

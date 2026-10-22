import { BALANCE_QUERY_INTENT_FORMAT, type BalanceRequest, parseBalanceQuery } from "./balance.ts";
import { BUDGET_INTENT_FORMAT, type BudgetRequest, parseBudgetRequest } from "./budgets.ts";
import { type ExpenseQueryRequest, EXPENSES_QUERY_INTENT_FORMAT, parseExpenseQuery } from "./expense-queries.ts";
import { askGroqForJson } from "./groq.ts";
import { type MadridClock, madridClock } from "./madrid-time.ts";
import { parseReminderRequest, REMINDER_INTENT_FORMAT, type ReminderRequest } from "./reminders.ts";

// Para añadir una funcionalidad: su formato va en buildIntentPrompt y su validación en parseMessageIntent.
export type MessageIntent = ReminderRequest | ExpenseQueryRequest | BudgetRequest | BalanceRequest | {
  kind: "unknown";
};

export function buildIntentPrompt(clock: MadridClock): string {
  return [
    "Interpretas los mensajes en español que recibe un bot personal.",
    `Ahora en Madrid es ${clock.weekday} ${clock.localDateTime}.`,
    "Responde solo con JSON en uno de estos formatos, según lo que pida el mensaje:",
    `- ${REMINDER_INTENT_FORMAT}`,
    `- ${EXPENSES_QUERY_INTENT_FORMAT}`,
    `- ${BUDGET_INTENT_FORMAT}`,
    `- ${BALANCE_QUERY_INTENT_FORMAT}`,
    '- Cualquier otra cosa: {"intent": "unknown"}',
  ].join("\n");
}

export function parseMessageIntent(raw: unknown, now: Date): MessageIntent {
  const intent = (raw as { intent?: unknown } | null)?.intent;
  if (intent === "reminder") return parseReminderRequest(raw, now);
  if (intent === "expenses_query") return parseExpenseQuery(raw);
  if (intent === "budget") return parseBudgetRequest(raw);
  if (intent === "balance_query") return parseBalanceQuery(raw);
  return { kind: "unknown" };
}

export async function interpretMessage(message: string, now: Date): Promise<MessageIntent> {
  const raw = await askGroqForJson(buildIntentPrompt(madridClock(now)), message);
  return parseMessageIntent(raw, now);
}

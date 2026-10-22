// Responde a un mensaje escrito con lenguaje natural. Lo usan el bot de Telegram y el chat del panel.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { findBalance, formatBalance } from "./balance.ts";
import {
  budgetName,
  deleteBudget,
  describeSavedBudget,
  formatBudgetList,
  loadBudgetStatuses,
  saveBudget,
} from "./budgets.ts";
import { findExpenses, formatExpenseReport } from "./expense-queries.ts";
import { askGroqForJson } from "./groq.ts";
import { formatMadridDateTime } from "./madrid-time.ts";
import { type ConversationTurn, interpretMessage, withConversation } from "./message-intent.ts";
import { replyToPersonalIntent } from "./personal-replies.ts";
import { describeRepeat, saveReminder } from "./reminders.ts";
import type { BotReply } from "./telegram.ts";

/** Lo que sabe hacer el asistente, para que el modelo lo explique si se le pregunta. */
const CAPABILITIES = [
  "recordatorios (también recurrentes)",
  "consultas de gastos del banco por fechas y categorías",
  "presupuestos mensuales por categoría",
  "balance de ingresos y gastos",
  "lista de la compra",
  "notas para recordar datos",
  "cumpleaños (avisa el día antes y el mismo día)",
  "hábitos diarios con rachas",
  "consultar y crear eventos en Google Calendar",
  "un resumen cada mañana a las 8:00 con el tiempo, recordatorios, eventos y cumpleaños",
].join("; ");

async function replyToBudgetDelete(db: SupabaseClient, category: string): Promise<string> {
  const name = budgetName(category);
  return await deleteBudget(db, category) ? `He quitado el ${name}.` : `No tenías ningún ${name}.`;
}

/** Valida la respuesta del modelo a una pregunta general. */
export function parseGeneralAnswer(raw: unknown): string {
  const answer = (raw as { answer?: unknown } | null)?.answer;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Groq no devolvió una respuesta.");
  return answer.trim();
}

/** Para lo que no es ninguna funcionalidad: una respuesta normal, como cualquier chat. */
export async function answerGeneralQuestion(message: string, history: ConversationTurn[]): Promise<string> {
  const raw = await askGroqForJson(
    [
      "Eres el asistente personal de una persona y le respondes en español, de forma natural, clara y breve.",
      `Además de conversar, sabes hacer esto con sus datos: ${CAPABILITIES}.`,
      "Si pregunta por algo que depende de información de última hora (noticias, resultados, precios), di que no " +
      "tienes acceso a internet.",
      'Responde solo con JSON {"answer": "<tu respuesta>"}.',
    ].join("\n"),
    withConversation(message, history),
  );
  return parseGeneralAnswer(raw);
}

/** `history` son los mensajes anteriores de la conversación, para entender "¿y el mes pasado?". */
export async function replyToText(
  db: SupabaseClient,
  text: string,
  now: Date,
  history: ConversationTurn[] = [],
): Promise<string | BotReply> {
  const intent = await interpretMessage(text, now, history);
  switch (intent.kind) {
    case "unknown":
      return answerGeneralQuestion(text, history);
    case "invalid":
      return intent.message;
    case "reminder":
      await saveReminder(db, intent.text, intent.remindAt, intent.repeat);
      return `Te recordaré "${intent.text}" el ${formatMadridDateTime(intent.remindAt)}${
        describeRepeat(intent.repeat)
      }.`;
    case "expenses_query":
      return formatExpenseReport(await findExpenses(db, intent.query), intent.query);
    case "budget_set":
      return describeSavedBudget(await saveBudget(db, intent.category, intent.monthlyLimit, now));
    case "budget_delete":
      return replyToBudgetDelete(db, intent.category);
    case "budget_list":
      return formatBudgetList(await loadBudgetStatuses(db, now));
    case "balance_query":
      return formatBalance(await findBalance(db, intent.dateFrom, intent.dateTo), intent.dateFrom, intent.dateTo);
    default:
      return await replyToPersonalIntent(db, intent, now) ?? answerGeneralQuestion(text, history);
  }
}

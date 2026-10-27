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
import { describeSavedManualExpense, saveManualExpense } from "./manual-expenses.ts";
import { loadMemory, memoryContext, nicknameGuide, parseMemorySuggestion, suggestMemory } from "./memory.ts";
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
  "buscar correos en Gmail (solo remitente, asunto y fecha; no puede enviar)",
  "cuándo pasa el autobús de la EMT por una parada, con paradas guardadas por nombre",
  "avisos meteorológicos de AEMET para la Comunidad de Madrid",
  "conectar o desconectar el banco y la cuenta de Google",
  "registro del peso corporal para ver si sube o baja",
  "apuntar a mano energéticas o tabaco pagados en efectivo",
  "un resumen cada mañana a las 8:00 con el tiempo, avisos, recordatorios, eventos, correo y cumpleaños",
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

/**
 * Para lo que no es ninguna funcionalidad: una respuesta normal, como cualquier chat. Si Rafa cuenta algo nuevo de
 * sí mismo, la respuesta pregunta si apuntarlo en la memoria. Se aprovecha la misma llamada para no gastar otra.
 */
export async function answerGeneralQuestion(
  db: SupabaseClient,
  message: string,
  history: ConversationTurn[],
): Promise<string | BotReply> {
  const savedMemory = await loadMemory(db);
  const memory = memoryContext(savedMemory);
  const raw = await askGroqForJson(
    [
      "Eres el asistente personal de Rafa y le respondes en español, breve y con naturalidad, como un colega de " +
      "confianza: pícaro, con guasa y un poco vacilón, nada robótico.",
      nicknameGuide(),
      "Si el tema es serio o delicado (salud, un problema personal), deja la guasa y sé claro.",
      memory,
      `Además de conversar, sabes hacer esto con sus datos: ${CAPABILITIES}.`,
      "Si pregunta por algo que depende de información de última hora (noticias, resultados, precios), di que no " +
      "tienes acceso a internet.",
      // Esta respuesta no lee la base de datos: sin esta regla, el modelo dice que la ha consultado y se inventa datos.
      "Aquí no ves sus datos (recordatorios, gastos, calendario, notas…): nunca digas que los has consultado ni te " +
      'inventes ninguno. Si los pide, dile que lo pregunte directamente, por ejemplo "¿qué tengo hoy?".',
      "Si en su mensaje actual Rafa cuenta algo nuevo y duradero sobre sí mismo (trabajo, estudios, gustos, gente " +
      'cercana, planes, manías) que no sepas ya, resúmelo en "remember" en una frase corta en tercera persona, por ' +
      'ejemplo "Le encanta el sushi". Si no, "remember" es null. Nada pasajero ("hoy estoy cansado") ni preguntas.',
      'Responde solo con JSON {"answer": "<tu respuesta>", "remember": "<dato nuevo>" o null}.',
    ].filter(Boolean).join("\n"),
    withConversation(message, history),
  );
  const answer = parseGeneralAnswer(raw);
  const suggestion = parseMemorySuggestion(raw, savedMemory);
  return suggestion ? suggestMemory(db, answer, suggestion) : answer;
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
      return answerGeneralQuestion(db, text, history);
    case "invalid":
      return intent.message;
    case "reminder":
      await saveReminder(db, intent.text, intent.remindAt, intent.repeat, intent.advanceMinutes);
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
    case "manual_expense":
      await saveManualExpense(db, intent);
      return describeSavedManualExpense(intent);
    case "balance_query":
      return formatBalance(await findBalance(db, intent.dateFrom, intent.dateTo), intent.dateFrom, intent.dateTo);
    default:
      return await replyToPersonalIntent(db, intent, now) ?? answerGeneralQuestion(db, text, history);
  }
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { findBalance, formatBalance } from "../_shared/balance.ts";
import { createBankLink, disconnectBank } from "../_shared/bank-connection.ts";
import {
  budgetName,
  deleteBudget,
  describeSavedBudget,
  formatBudgetList,
  loadBudgetStatuses,
  saveBudget,
} from "../_shared/budgets.ts";
import { createCalendarLink, disconnectCalendar } from "../_shared/calendar.ts";
import { createAdminClient, getInternalSecret } from "../_shared/database.ts";
import { errorMessage } from "../_shared/env.ts";
import { findExpenses, formatExpenseReport } from "../_shared/expense-queries.ts";
import { transcribeAudio } from "../_shared/groq.ts";
import { formatMadridDateTime } from "../_shared/madrid-time.ts";
import { interpretMessage } from "../_shared/message-intent.ts";
import { applyPersonalButton, replyToPersonalIntent } from "../_shared/personal-replies.ts";
import { applyReminderButton, describeRepeat, parseReminderButton, saveReminder } from "../_shared/reminders.ts";
import {
  answerTelegramButton,
  type BotReply,
  downloadTelegramFile,
  editTelegramMessage,
  isAuthorizedUser,
  sendTelegramMessage,
} from "../_shared/telegram.ts";

const HELP_TEXT = [
  "Esto es lo que sé hacer:",
  '• Recordatorios: "recuérdame llamar a Juan el jueves a las 17:00" o "cada lunes a las 9 sacar la basura".',
  '• Consultar tus gastos: "¿cuánto he gastado esta semana?" o "gastos de ayer en restaurantes".',
  '• Presupuestos: "pon un límite de 200 € al mes en restaurantes" o "¿cómo voy con los presupuestos?".',
  '• Balance: "¿cuánto he ahorrado este mes?".',
  '• Lista de la compra: "añade leche y pan a la compra" o "¿qué hay en la lista?".',
  '• Notas: "apunta que la talla de Marta es la 38" y luego "¿qué talla usa Marta?".',
  '• Cumpleaños: "el cumple de mamá es el 3 de marzo". Te aviso el día antes y el mismo día.',
  '• Hábitos: "quiero leer cada día". Te pregunto cada noche a las 21:00.',
  '• Calendario: "¿qué tengo mañana?" o "pon en el calendario dentista el martes a las 10".',
  "• Cada día a las 8:00 te mando un resumen: tiempo, recordatorios, calendario y cumpleaños.",
  "• También me puedes mandar notas de voz.",
  "• /conectar_banco: conecta tu cuenta del banco para importar los gastos cada día a las 8:00.",
  "• /desconectar_banco: corta el acceso a tu banco. Los gastos ya importados se quedan.",
  "• /conectar_calendario y /desconectar_calendario: tu calendario de Google.",
  "• Los domingos a las 20:00 te mando el resumen de gastos de la semana.",
].join("\n");

// Límite para no mandar audios largos a Groq: un recordatorio o una pregunta caben de sobra.
const MAX_VOICE_SECONDS = 120;

interface TelegramMessage {
  message_id: number;
  from?: { id: number };
  text?: string;
  voice?: { file_id: string; duration?: number };
}

interface TelegramCallbackQuery {
  id: string;
  from?: { id: number };
  data?: string;
  message?: { message_id: number };
}

async function replyToBudgetDelete(db: SupabaseClient, category: string): Promise<string> {
  const name = budgetName(category);
  return await deleteBudget(db, category) ? `He quitado el ${name}.` : `No tenías ningún ${name}.`;
}

async function replyToMessage(db: SupabaseClient, text: string, now: Date): Promise<string | BotReply> {
  const intent = await interpretMessage(text, now);
  switch (intent.kind) {
    case "unknown":
      return `No te he entendido.\n\n${HELP_TEXT}`;
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
      return await replyToPersonalIntent(db, intent, now) ?? `No te he entendido.\n\n${HELP_TEXT}`;
  }
}

function describeDisconnection(closedConnections: number): string {
  if (closedConnections === 0) return "No había ninguna conexión con el banco activa.";
  // Enable Banking cierra el permiso en el banco "si es posible": por eso se dice que se ha pedido, no que esté hecho.
  return [
    "Banco desconectado: he cerrado el acceso en Enable Banking y he pedido al banco que retire el permiso.",
    "Ya no importaré más gastos; los que ya tengo siguen guardados. Para volver a conectarlo, usa /conectar_banco.",
  ].join("\n");
}

async function buildReply(db: SupabaseClient, text: string, now: Date): Promise<string | BotReply> {
  if (text === "/start" || text === "/ayuda") return HELP_TEXT;
  if (text === "/conectar_banco") {
    return `Autoriza el acceso desde tu banco en este enlace (caduca en 30 minutos):\n${await createBankLink(db, now)}`;
  }
  if (text === "/desconectar_banco") return describeDisconnection(await disconnectBank(db, now));
  if (text === "/conectar_calendario") {
    const link = await createCalendarLink(db);
    return `Autoriza el acceso a tu calendario de Google en este enlace (caduca en 30 minutos):\n${link}`;
  }
  if (text === "/desconectar_calendario") {
    return await disconnectCalendar(db)
      ? "Calendario desconectado: he retirado el permiso en Google."
      : "No tenías el calendario conectado.";
  }
  return replyToMessage(db, text, now);
}

function toBotReply(reply: string | BotReply): BotReply {
  return typeof reply === "string" ? { text: reply } : reply;
}

/** Transcribe la nota de voz y responde como si se hubiera escrito, enseñando lo que se ha entendido. */
async function replyToVoice(
  db: SupabaseClient,
  voice: NonNullable<TelegramMessage["voice"]>,
  now: Date,
): Promise<BotReply> {
  if ((voice.duration ?? 0) > MAX_VOICE_SECONDS) return { text: "Las notas de voz pueden durar hasta 2 minutos." };
  // Telegram guarda las notas de voz como .oga; Groq las acepta con la extensión .ogg.
  const text = await transcribeAudio(await downloadTelegramFile(voice.file_id), "nota-de-voz.ogg");
  if (!text) return { text: "No he entendido la nota de voz." };
  const reply = toBotReply(await buildReply(db, text, now));
  return { ...reply, text: `🎙️ «${text}»\n\n${reply.text}` };
}

async function handleMessage(db: SupabaseClient, message: TelegramMessage): Promise<void> {
  const now = new Date();
  let reply: BotReply | null = null;
  if (message.voice) reply = await replyToVoice(db, message.voice, now);
  else if (message.text) reply = toBotReply(await buildReply(db, message.text.trim(), now));
  if (reply) await sendTelegramMessage(reply.text, reply.buttons);
}

/** Botones de recordatorios, lista de la compra y hábitos: se actualiza el mensaje para que se vea qué se ha hecho. */
async function handleButton(db: SupabaseClient, callback: TelegramCallbackQuery): Promise<void> {
  const data = callback.data ?? "";
  if (!callback.message) {
    await answerTelegramButton(callback.id, "Este botón ya no funciona.");
    return;
  }
  const reminderButton = parseReminderButton(data);
  if (reminderButton) {
    await editTelegramMessage(callback.message.message_id, await applyReminderButton(db, reminderButton, new Date()));
    await answerTelegramButton(callback.id, reminderButton.action === "done" ? "Hecho" : "Pospuesto");
    return;
  }
  const result = await applyPersonalButton(db, data);
  if (!result) {
    await answerTelegramButton(callback.id, "Este botón ya no funciona.");
    return;
  }
  await editTelegramMessage(callback.message.message_id, result.message.text, result.message.buttons);
  await answerTelegramButton(callback.id, result.toast);
}

Deno.serve(async (request) => {
  const db = createAdminClient();
  const expectedSecret = await getInternalSecret(db, "telegram_webhook_secret");
  if (request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await request.json();
  const sender = update.message?.from?.id ?? update.callback_query?.from?.id;
  // Telegram reintenta si no recibe un 200, así que se responde 200 siempre y los errores se cuentan por el chat.
  if (!update.message && !update.callback_query) return new Response("ok");
  if (!isAuthorizedUser(sender)) {
    // Queda en los logs para poder averiguar el ID de quien escribe sin depender de otros bots.
    console.warn(`Mensaje ignorado: el usuario de Telegram ${sender} no es TELEGRAM_USER_ID`);
    return new Response("ok");
  }
  try {
    if (update.callback_query) await handleButton(db, update.callback_query);
    else await handleMessage(db, update.message);
  } catch (error) {
    console.error(error);
    await sendTelegramMessage(`Algo ha fallado: ${errorMessage(error)}`)
      .catch((sendError) => console.error("Tampoco se pudo avisar por Telegram", sendError));
  }
  return new Response("ok");
});

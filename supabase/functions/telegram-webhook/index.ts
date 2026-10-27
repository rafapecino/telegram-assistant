import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { replyToText } from "../_shared/assistant.ts";
import { replyToCommand } from "../_shared/commands.ts";
import { createAdminClient, getInternalSecret } from "../_shared/database.ts";
import { errorMessage } from "../_shared/env.ts";
import { transcribeAudio } from "../_shared/groq.ts";
import { applyPersonalButton } from "../_shared/personal-replies.ts";
import { applyReminderButton, parseReminderButton } from "../_shared/reminders.ts";
import {
  answerTelegramButton,
  type BotReply,
  downloadTelegramFile,
  editTelegramMessage,
  isAuthorizedUser,
  sendTelegramMessage,
} from "../_shared/telegram.ts";

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

async function buildReply(db: SupabaseClient, text: string, now: Date): Promise<string | BotReply> {
  return await replyToCommand(db, text, now) ?? replyToText(db, text, now);
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

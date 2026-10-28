// Preguntas de sí o no guardadas en el chat del panel (como «¿Has hecho «Correr» hoy?»). Se contestan con su botón,
// en el panel o en Telegram, o escribiendo «sí» o «no»; donde no se haya contestado, el mensaje se actualiza igual.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { applyPersonalButton, type ButtonResult } from "./personal-replies.ts";
import { type BotReply, editTelegramMessage, type TelegramButton } from "./telegram.ts";
import { comparable } from "./text.ts";

const YES_ANSWERS = new Set([
  "si", "sip", "claro", "hecho", "ya", "ya esta", "lo he hecho", "ya lo he hecho", "si lo he hecho", "si hecho",
  "por supuesto", "vale", "ok", "dale", "guardalo",
]);
const NO_ANSWERS = new Set(["no", "nop", "todavia no", "aun no", "no lo he hecho", "hoy no"]);

/** true si el mensaje es solo un «sí», false si es solo un «no» y null si dice algo más. */
export function parseQuickAnswer(text: string): boolean | null {
  const answer = comparable(text).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  if (YES_ANSWERS.has(answer)) return true;
  if (NO_ANSWERS.has(answer)) return false;
  return null;
}

const YES_BUTTON = /^(habit:yes|memory:yes|connection:disconnect):/;
const NO_BUTTON = /^(habit:no|memory:no|connection:keep):/;
// Un «sí» de ayer por la noche aún puede ser a la pregunta de los hábitos; uno de hace días ya no.
const PENDING_HOURS = 24;

export type Channel = "panel" | "telegram";

/**
 * El botón de la pregunta pendiente más reciente que corresponde a la respuesta. En Telegram solo cuentan los
 * hábitos: las demás preguntas guardadas se hicieron en el panel y un «sí» en Telegram no puede ir para ellas.
 */
export async function findPendingButton(
  db: SupabaseClient,
  isYes: boolean,
  channel: Channel,
  now: Date,
): Promise<string | null> {
  const since = new Date(now.getTime() - PENDING_HOURS * 3_600_000).toISOString();
  const { data, error } = await db.from("chat_messages").select("buttons").eq("role", "assistant")
    .not("buttons", "is", null).gte("created_at", since).order("id", { ascending: false }).limit(20);
  if (error) throw new Error(`No se pudieron leer las preguntas pendientes: ${error.message}`);
  const pattern = isYes ? YES_BUTTON : NO_BUTTON;
  for (const row of data as { buttons: TelegramButton[][] }[]) {
    const match = row.buttons.flat().map((button) => button.callback_data)
      .find((callback) => pattern.test(callback) && (channel === "panel" || callback.startsWith("habit:")));
    if (match) return match;
  }
  return null;
}

/**
 * Pone la respuesta en los mensajes del chat que tenían el botón pulsado, y en su copia de Telegram si la tienen.
 * `editedTelegramMessageId` es el mensaje que Telegram ya ha actualizado al pulsar allí.
 */
export async function updateMessagesWithButton(
  db: SupabaseClient,
  callbackData: string,
  reply: BotReply,
  editedTelegramMessageId?: number,
): Promise<void> {
  const { data, error } = await db.from("chat_messages")
    .update({ text: reply.text, buttons: reply.buttons ?? null })
    .filter("buttons", "cs", JSON.stringify([[{ callback_data: callbackData }]]))
    .select("telegram_message_id");
  if (error) throw new Error(`No se pudo actualizar la conversación: ${error.message}`);
  for (const { telegram_message_id: messageId } of data as { telegram_message_id: number | null }[]) {
    if (messageId === null || messageId === editedTelegramMessageId) continue;
    // La respuesta ya está apuntada: si Telegram no deja editar su copia (por ejemplo, porque se borró), solo se
    // queda con los botones viejos.
    await editTelegramMessage(messageId, reply.text, reply.buttons)
      .catch((editError) => console.error("No se pudo actualizar la pregunta en Telegram:", editError));
  }
}

/** Si el mensaje es un «sí» o un «no» y hay una pregunta pendiente, la contesta como si se pulsara su botón. */
export async function answerPendingQuestion(
  db: SupabaseClient,
  text: string,
  channel: Channel,
  now: Date,
): Promise<ButtonResult | null> {
  const isYes = parseQuickAnswer(text);
  if (isYes === null) return null;
  const callbackData = await findPendingButton(db, isYes, channel, now);
  if (!callbackData) return null;
  const result = await applyPersonalButton(db, callbackData, now);
  if (!result) return null;
  await updateMessagesWithButton(db, callbackData, result.message);
  return result;
}

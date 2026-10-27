// Chat del panel web: mismas respuestas que el bot de Telegram, con la conversación guardada en la base de datos.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { replyToText } from "./assistant.ts";
import { replyToCommand } from "./commands.ts";
import { UserFacingError } from "./errors.ts";
import type { ConversationTurn } from "./message-intent.ts";
import { applyPersonalButton } from "./personal-replies.ts";
import type { BotReply } from "./telegram.ts";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_TURN_LENGTH = 2000;
// Bastan unos pocos mensajes para entender continuaciones, y así la petición a Groq no crece sin límite.
export const MAX_HISTORY_TURNS = 10;
// Lo que se enseña al abrir el panel: más que el contexto del modelo, para poder releer la conversación.
export const MAX_SHOWN_MESSAGES = 50;

export type ChatInput =
  | { kind: "message"; message: string }
  // `original` es el texto del mensaje que tenía el botón, para actualizarlo también en la conversación guardada.
  | { kind: "button"; data: string; original: string | null };

/** Un mensaje escrito o la pulsación de un botón de una respuesta anterior (por ejemplo, tachar de la compra). */
export function parseChatInput(raw: Record<string, unknown>): ChatInput {
  if (typeof raw.button === "string") {
    const original = typeof raw.original === "string" ? raw.original : null;
    return { kind: "button", data: raw.button.slice(0, 100), original };
  }
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    throw new UserFacingError(`Escribe un mensaje de hasta ${MAX_MESSAGE_LENGTH} caracteres.`);
  }
  return { kind: "message", message };
}

/** Los últimos mensajes guardados, del más antiguo al más reciente. */
export async function loadChatMessages(db: SupabaseClient, limit = MAX_SHOWN_MESSAGES): Promise<ConversationTurn[]> {
  const { data, error } = await db.from("chat_messages").select("role,text").order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);
  return (data as ConversationTurn[]).reverse();
}

export async function clearChatMessages(db: SupabaseClient): Promise<void> {
  // Supabase no deja borrar sin filtro: este abarca todas las filas.
  const { error } = await db.from("chat_messages").delete().gt("id", 0);
  if (error) throw new Error(`No se pudo borrar la conversación: ${error.message}`);
}

async function saveTurns(db: SupabaseClient, turns: ConversationTurn[]): Promise<void> {
  const { error } = await db.from("chat_messages").insert(turns);
  if (error) throw new Error(`No se pudo guardar la conversación: ${error.message}`);
}

/** Como Telegram al editar el mensaje: así, al recargar, no vuelve una pregunta ya contestada. */
async function replaceSavedReply(db: SupabaseClient, original: string, text: string): Promise<void> {
  const { error } = await db.from("chat_messages").update({ text }).eq("role", "assistant").eq("text", original);
  if (error) throw new Error(`No se pudo actualizar la conversación: ${error.message}`);
}

async function replyToButton(db: SupabaseClient, input: Extract<ChatInput, { kind: "button" }>): Promise<BotReply> {
  const result = await applyPersonalButton(db, input.data);
  if (!result) return { text: "Este botón ya no funciona." };
  if (input.original) await replaceSavedReply(db, input.original, result.message.text);
  return result.message;
}

export async function replyToChat(db: SupabaseClient, input: ChatInput, now: Date): Promise<BotReply> {
  if (input.kind === "button") return replyToButton(db, input);
  const history = (await loadChatMessages(db, MAX_HISTORY_TURNS))
    .map((turn) => ({ ...turn, text: turn.text.slice(0, MAX_TURN_LENGTH) }));
  const reply = await replyToCommand(db, input.message, now) ?? await replyToText(db, input.message, now, history);
  const botReply = typeof reply === "string" ? { text: reply } : reply;
  // Se guardan juntos al final: si la respuesta falla, no queda una pregunta sin contestar en el historial.
  await saveTurns(db, [{ role: "user", text: input.message }, { role: "assistant", text: botReply.text }]);
  return botReply;
}

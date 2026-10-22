// Chat del panel web: mismas respuestas que el bot de Telegram, con historial de la conversación.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { replyToText } from "./assistant.ts";
import type { ConversationTurn } from "./message-intent.ts";
import { applyPersonalButton } from "./personal-replies.ts";
import type { BotReply } from "./telegram.ts";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_TURN_LENGTH = 2000;
// Bastan unos pocos mensajes para entender continuaciones, y así la petición a Groq no crece sin límite.
export const MAX_HISTORY_TURNS = 10;

export type ChatInput =
  | { kind: "message"; message: string; history: ConversationTurn[] }
  | { kind: "button"; data: string };

function parseHistory(raw: unknown): ConversationTurn[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_HISTORY_TURNS) throw new Error("Historial de conversación no válido.");
  return raw.map((turn) => {
    const { role, text } = (turn ?? {}) as { role?: unknown; text?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof text !== "string" || text.length > MAX_TURN_LENGTH) {
      throw new Error("Historial de conversación no válido.");
    }
    return { role, text };
  });
}

/** Un mensaje escrito o la pulsación de un botón de una respuesta anterior (por ejemplo, tachar de la compra). */
export function parseChatInput(raw: Record<string, unknown>): ChatInput {
  if (typeof raw.button === "string") return { kind: "button", data: raw.button.slice(0, 100) };
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Escribe un mensaje de hasta ${MAX_MESSAGE_LENGTH} caracteres.`);
  }
  return { kind: "message", message, history: parseHistory(raw.history) };
}

export async function replyToChat(db: SupabaseClient, input: ChatInput, now: Date): Promise<BotReply> {
  if (input.kind === "button") {
    const result = await applyPersonalButton(db, input.data);
    return result ? result.message : { text: "Este botón ya no funciona." };
  }
  const reply = await replyToText(db, input.message, now, input.history);
  return typeof reply === "string" ? { text: reply } : reply;
}

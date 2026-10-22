import { requireEnv } from "./env.ts";

async function callTelegram<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const url = `https://api.telegram.org/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram rechazó ${method}: ${result.description}`);
  return result.result as T;
}

/** Botón bajo un mensaje. Al pulsarlo, Telegram envía `callback_data` al webhook. */
export interface TelegramButton {
  text: string;
  callback_data: string;
}

function ownerChatId(): string {
  return requireEnv("TELEGRAM_USER_ID").trim();
}

/** El bot es personal: siempre escribe a su único usuario (en un chat privado, chat_id = id del usuario). */
export async function sendTelegramMessage(text: string, buttons?: TelegramButton[][]): Promise<void> {
  await callTelegram("sendMessage", {
    chat_id: ownerChatId(),
    text,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Cambia el texto de un mensaje ya enviado. Sin `buttons`, Telegram le quita los botones. */
export async function editTelegramMessage(
  messageId: number,
  text: string,
  buttons?: TelegramButton[][],
): Promise<void> {
  await callTelegram("editMessageText", {
    chat_id: ownerChatId(),
    message_id: messageId,
    text,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Respuesta del bot: texto y, opcionalmente, botones debajo. */
export interface BotReply {
  text: string;
  buttons?: TelegramButton[][];
}

/** Quita el "cargando" del botón pulsado y muestra un aviso breve. */
export async function answerTelegramButton(callbackQueryId: string, text: string): Promise<void> {
  await callTelegram("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

/** Descarga un archivo que ha enviado el usuario, por ejemplo una nota de voz. */
export async function downloadTelegramFile(fileId: string): Promise<Blob> {
  const file = await callTelegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram no ha dado la ruta del archivo.");
  // La URL lleva el token del bot: por eso no se incluye en el mensaje de error.
  const response = await fetch(
    `https://api.telegram.org/file/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${file.file_path}`,
  );
  if (!response.ok) throw new Error(`No se pudo descargar el archivo de Telegram (${response.status}).`);
  return response.blob();
}

export async function setTelegramWebhook(url: string, secretToken: string): Promise<void> {
  // callback_query: los botones de los recordatorios (Hecho, +1 h, Mañana).
  await callTelegram("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message", "callback_query"] });
}

/** Sin TELEGRAM_USER_ID configurado nadie está autorizado, y el webhook deja el ID de quien escribe en los logs. */
export function isAuthorizedUser(userId: number | undefined): boolean {
  const authorizedUserId = Deno.env.get("TELEGRAM_USER_ID")?.trim();
  return userId !== undefined && authorizedUserId !== undefined && String(userId) === authorizedUserId;
}

import { requireEnv } from "./env.ts";

async function callTelegram(method: string, payload: Record<string, unknown>): Promise<void> {
  const url = `https://api.telegram.org/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram rechazó ${method}: ${result.description}`);
}

/** El bot es personal: siempre escribe a su único usuario (en un chat privado, chat_id = id del usuario). */
export function sendTelegramMessage(text: string): Promise<void> {
  return callTelegram("sendMessage", { chat_id: requireEnv("TELEGRAM_USER_ID").trim(), text });
}

export function setTelegramWebhook(url: string, secretToken: string): Promise<void> {
  return callTelegram("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"] });
}

export function isAuthorizedUser(userId: number | undefined): boolean {
  return userId !== undefined && String(userId) === requireEnv("TELEGRAM_USER_ID").trim();
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { createBankLink } from "../_shared/bank-connection.ts";
import { createAdminClient, getInternalSecret } from "../_shared/database.ts";
import { errorMessage } from "../_shared/env.ts";
import { formatMadridDateTime } from "../_shared/madrid-time.ts";
import { interpretReminder, saveReminder } from "../_shared/reminders.ts";
import { isAuthorizedUser, sendTelegramMessage } from "../_shared/telegram.ts";

const HELP_TEXT = [
  "Esto es lo que sé hacer:",
  '• Recordatorios: escribe, por ejemplo, "recuérdame llamar a Juan el jueves a las 17:00".',
  "• /conectar_banco: conecta tu cuenta del banco para importar los gastos cada día a las 8:00.",
  "• Los domingos a las 20:00 te mando el resumen de gastos de la semana.",
].join("\n");

async function replyToReminderRequest(db: SupabaseClient, text: string, now: Date): Promise<string> {
  const interpretation = await interpretReminder(text, now);
  switch (interpretation.kind) {
    case "not_reminder":
      return `No te he entendido.\n\n${HELP_TEXT}`;
    case "invalid":
      return `No he creado el recordatorio: ${interpretation.reason}.`;
    case "reminder":
      await saveReminder(db, interpretation.text, interpretation.remindAt);
      return `Te recordaré "${interpretation.text}" el ${formatMadridDateTime(interpretation.remindAt)}.`;
  }
}

async function buildReply(db: SupabaseClient, text: string, now: Date): Promise<string> {
  if (text === "/start" || text === "/ayuda") return HELP_TEXT;
  if (text === "/conectar_banco") {
    return `Autoriza el acceso desde tu banco en este enlace (caduca en 30 minutos):\n${await createBankLink(db, now)}`;
  }
  return replyToReminderRequest(db, text, now);
}

Deno.serve(async (request) => {
  const db = createAdminClient();
  const expectedSecret = await getInternalSecret(db, "telegram_webhook_secret");
  if (request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const message = (await request.json()).message;
  // Telegram reintenta si no recibe un 200, así que se responde 200 siempre y los errores se cuentan por el chat.
  if (!message?.text || !isAuthorizedUser(message.from?.id)) return new Response("ok");
  try {
    await sendTelegramMessage(await buildReply(db, message.text.trim(), new Date()));
  } catch (error) {
    console.error(error);
    await sendTelegramMessage(`Algo ha fallado: ${errorMessage(error)}`)
      .catch((sendError) => console.error("Tampoco se pudo avisar por Telegram", sendError));
  }
  return new Response("ok");
});

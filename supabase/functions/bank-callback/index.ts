import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { completeBankLink, InvalidBankLinkError } from "../_shared/bank-connection.ts";
import { createAdminClient } from "../_shared/database.ts";
import { errorMessage } from "../_shared/env.ts";
import { importRecentExpenses } from "../_shared/expenses.ts";
import { formatMadridDateTime } from "../_shared/madrid-time.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";

// Supabase no sirve HTML en peticiones GET a funciones, así que la página es texto plano.
function textPage(message: string, status = 200): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function notifyAndRespond(message: string, status: number): Promise<Response> {
  await sendTelegramMessage(message).catch((error) => console.error("No se pudo avisar por Telegram", error));
  return textPage(message, status);
}

async function importAfterConnecting(db: SupabaseClient, accountCount: number, validUntil: string): Promise<string> {
  const connected = `Banco conectado: ${accountCount} cuenta(s), con acceso hasta el ${
    formatMadridDateTime(new Date(validUntil))
  }.`;
  try {
    const importedCount = await importRecentExpenses(db, new Date());
    return `${connected} He importado ${importedCount} gastos de los últimos 7 días.`;
  } catch (error) {
    console.error(error);
    return `${connected} Pero ha fallado la primera importación de gastos: ${errorMessage(error)}`;
  }
}

Deno.serve(async (request) => {
  const params = new URL(request.url).searchParams;
  const bankError = params.get("error");
  if (bankError) {
    return notifyAndRespond(`El banco no autorizó el acceso: ${params.get("error_description") ?? bankError}`, 400);
  }
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return textPage("Faltan los parámetros state y code.", 400);

  const db = createAdminClient();
  try {
    const session = await completeBankLink(db, state, code, new Date());
    const summary = await importAfterConnecting(db, session.accountUids.length, session.validUntil);
    await sendTelegramMessage(summary).catch((error) => console.error("No se pudo avisar por Telegram", error));
    return textPage(`${summary}\n\nYa puedes cerrar esta pestaña y volver a Telegram.`);
  } catch (error) {
    // Un enlace reutilizado no es un fallo de la conexión: basta con decirlo en la página, sin avisar por Telegram.
    if (error instanceof InvalidBankLinkError) return textPage(error.message, 400);
    console.error(error);
    return notifyAndRespond(`No se pudo conectar el banco: ${errorMessage(error)}`, 500);
  }
});

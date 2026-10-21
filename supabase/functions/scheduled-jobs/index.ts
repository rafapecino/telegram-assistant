import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { createAdminClient, functionUrl, getInternalSecret } from "../_shared/database.ts";
import { errorMessage } from "../_shared/env.ts";
import { importRecentExpenses, sendWeeklySummary } from "../_shared/expenses.ts";
import { madridClock } from "../_shared/madrid-time.ts";
import { sendDueReminders } from "../_shared/reminders.ts";
import { sendTelegramMessage, setTelegramWebhook } from "../_shared/telegram.ts";

const DAILY_IMPORT_HOUR = 8;
const WEEKLY_SUMMARY_HOUR = 20;

async function importAndSummarize(db: SupabaseClient, now: Date): Promise<string> {
  const importedCount = await importRecentExpenses(db, now);
  await sendWeeklySummary(db, now);
  return `Importados ${importedCount} gastos y enviado el resumen`;
}

// pg_cron funciona en UTC: la hora de Madrid se comprueba aquí para no desfasarse con el cambio de horario.
async function runHourlyJobs(db: SupabaseClient, now: Date): Promise<string> {
  const clock = madridClock(now);
  if (clock.isSunday && clock.hour === WEEKLY_SUMMARY_HOUR) return importAndSummarize(db, now);
  if (clock.hour === DAILY_IMPORT_HOUR) return `Importados ${await importRecentExpenses(db, now)} gastos`;
  return "Nada que hacer a esta hora";
}

async function runJob(db: SupabaseClient, job: string, now: Date): Promise<string> {
  switch (job) {
    case "reminders":
      return `Enviados ${await sendDueReminders(db, now)} recordatorios`;
    case "hourly":
      return runHourlyJobs(db, now);
    case "import-expenses":
      return `Importados ${await importRecentExpenses(db, now)} gastos`;
    case "weekly-summary":
      return importAndSummarize(db, now);
    case "setup-telegram-webhook":
      await setTelegramWebhook(functionUrl("telegram-webhook"), await getInternalSecret(db, "telegram_webhook_secret"));
      return "Webhook de Telegram configurado";
    default:
      throw new Error(`Tarea desconocida: ${job}`);
  }
}

Deno.serve(async (request) => {
  const db = createAdminClient();
  if (request.headers.get("x-internal-secret") !== await getInternalSecret(db, "internal_jobs_secret")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { job } = await request.json();
  try {
    return Response.json({ job, result: await runJob(db, job, new Date()) });
  } catch (error) {
    console.error(job, error);
    await sendTelegramMessage(`Ha fallado la tarea "${job}": ${errorMessage(error)}`)
      .catch((sendError) => console.error("No se pudo avisar por Telegram", sendError));
    return Response.json({ job, error: errorMessage(error) }, { status: 500 });
  }
});

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { checkBudgetAlerts } from "../_shared/budgets.ts";
import { createAdminClient, functionUrl, getInternalSecret } from "../_shared/database.ts";
import { errorMessage } from "../_shared/env.ts";
import { importRecentExpenses, sendWeeklySummary } from "../_shared/expenses.ts";
import { askHabits, HABIT_QUESTION_HOUR } from "../_shared/habits.ts";
import { madridClock } from "../_shared/madrid-time.ts";
import { MORNING_SUMMARY_HOUR, sendMorningSummary } from "../_shared/morning.ts";
import { sendDueReminders } from "../_shared/reminders.ts";
import { sendTelegramMessage, setTelegramWebhook } from "../_shared/telegram.ts";

const DAILY_IMPORT_HOUR = 8;
const WEEKLY_SUMMARY_HOUR = 20;

/** Tras cada importación se revisan los presupuestos, porque es cuando cambia lo gastado. */
async function importAndCheckBudgets(db: SupabaseClient, now: Date): Promise<string> {
  const importedCount = await importRecentExpenses(db, now);
  const alertCount = await checkBudgetAlerts(db, now);
  return `Importados ${importedCount} gastos y enviados ${alertCount} avisos de presupuesto`;
}

async function importAndSummarize(db: SupabaseClient, now: Date): Promise<string> {
  const result = await importAndCheckBudgets(db, now);
  await sendWeeklySummary(db, now);
  return `${result}, y enviado el resumen`;
}

async function morningSummary(db: SupabaseClient, now: Date): Promise<string> {
  await sendMorningSummary(db, now);
  return "Enviado el resumen de la mañana";
}

async function habitQuestions(db: SupabaseClient, now: Date): Promise<string> {
  return `Preguntados ${await askHabits(db, now)} hábitos`;
}

/** Hace todas las tareas aunque alguna falle (el resumen no depende del banco) y luego cuenta las que fallaron. */
async function runAll(db: SupabaseClient, now: Date, tasks: ((db: SupabaseClient, now: Date) => Promise<string>)[]) {
  const results: string[] = [];
  const failures: string[] = [];
  for (const task of tasks) {
    try {
      results.push(await task(db, now));
    } catch (error) {
      console.error(task.name, error);
      failures.push(errorMessage(error));
    }
  }
  if (failures.length > 0) throw new Error(failures.join(" | "));
  return results.join("; ");
}

// pg_cron funciona en UTC: la hora de Madrid se comprueba aquí para no desfasarse con el cambio de horario.
async function runHourlyJobs(db: SupabaseClient, now: Date): Promise<string> {
  const clock = madridClock(now);
  const tasks: ((db: SupabaseClient, now: Date) => Promise<string>)[] = [];
  if (clock.hour === MORNING_SUMMARY_HOUR) tasks.push(morningSummary);
  if (clock.hour === DAILY_IMPORT_HOUR) tasks.push(importAndCheckBudgets);
  if (clock.isSunday && clock.hour === WEEKLY_SUMMARY_HOUR) tasks.push(importAndSummarize);
  if (clock.hour === HABIT_QUESTION_HOUR) tasks.push(habitQuestions);
  return tasks.length === 0 ? "Nada que hacer a esta hora" : await runAll(db, now, tasks);
}

async function runJob(db: SupabaseClient, job: string, now: Date): Promise<string> {
  switch (job) {
    case "reminders":
      return `Enviados ${await sendDueReminders(db, now)} recordatorios`;
    case "hourly":
      return runHourlyJobs(db, now);
    case "import-expenses":
      return importAndCheckBudgets(db, now);
    case "weekly-summary":
      return importAndSummarize(db, now);
    case "morning-summary":
      return morningSummary(db, now);
    case "habits":
      return habitQuestions(db, now);
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

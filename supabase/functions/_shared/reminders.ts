import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { askGroqForJson } from "./groq.ts";
import { type MadridClock, madridClock, madridLocalToUtc } from "./madrid-time.ts";
import { sendTelegramMessage } from "./telegram.ts";

export type ReminderInterpretation =
  | { kind: "reminder"; text: string; remindAt: Date }
  | { kind: "not_reminder" }
  | { kind: "invalid"; reason: string };

export function buildReminderPrompt(clock: MadridClock): string {
  return [
    "Interpretas mensajes en español para un bot personal de recordatorios.",
    `Ahora en Madrid es ${clock.weekday} ${clock.localDateTime}.`,
    "Si el mensaje pide un recordatorio, responde solo con este JSON:",
    '{"is_reminder": true, "text": "<qué hay que recordar, breve>", "local_datetime": "YYYY-MM-DDTHH:mm"}',
    "local_datetime es la hora local de Madrid. Sin hora indicada, usa las 09:00.",
    'Si el mensaje no pide un recordatorio, responde solo {"is_reminder": false}.',
  ].join("\n");
}

/** Valida la respuesta del modelo: un modelo pequeño puede equivocarse y no queremos guardar basura. */
export function parseReminderInterpretation(raw: unknown, now: Date): ReminderInterpretation {
  const candidate = raw as { is_reminder?: unknown; text?: unknown; local_datetime?: unknown } | null;
  if (candidate?.is_reminder !== true) return { kind: "not_reminder" };
  if (typeof candidate.text !== "string" || candidate.text.trim() === "") {
    return { kind: "invalid", reason: "no he entendido qué quieres que te recuerde" };
  }
  let remindAt: Date;
  try {
    remindAt = madridLocalToUtc(String(candidate.local_datetime));
  } catch {
    return { kind: "invalid", reason: "no he entendido la fecha" };
  }
  if (remindAt <= now) return { kind: "invalid", reason: "la fecha que he entendido ya ha pasado" };
  return { kind: "reminder", text: candidate.text.trim(), remindAt };
}

export async function interpretReminder(message: string, now: Date): Promise<ReminderInterpretation> {
  const raw = await askGroqForJson(buildReminderPrompt(madridClock(now)), message);
  return parseReminderInterpretation(raw, now);
}

export async function saveReminder(db: SupabaseClient, text: string, remindAt: Date): Promise<void> {
  const { error } = await db.from("reminders").insert({ text, remind_at: remindAt.toISOString() });
  if (error) throw new Error(`No se pudo guardar el recordatorio: ${error.message}`);
}

export async function sendDueReminders(db: SupabaseClient, now: Date): Promise<number> {
  // Se marcan como enviados antes de enviarlos para que dos ejecuciones solapadas no los dupliquen.
  const { data: dueReminders, error } = await db.from("reminders")
    .update({ sent_at: now.toISOString() })
    .is("sent_at", null)
    .lte("remind_at", now.toISOString())
    .select("id, text");
  if (error) throw new Error(`No se pudieron leer los recordatorios pendientes: ${error.message}`);

  for (const reminder of dueReminders) {
    try {
      await sendTelegramMessage(`⏰ ${reminder.text}`);
    } catch (sendError) {
      // Se desmarca para que el siguiente minuto lo reintente.
      await db.from("reminders").update({ sent_at: null }).eq("id", reminder.id);
      throw sendError;
    }
  }
  return dueReminders.length;
}

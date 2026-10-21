import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { madridLocalToUtc } from "./madrid-time.ts";
import { sendTelegramMessage } from "./telegram.ts";

/** Formato que el modelo debe devolver cuando el mensaje pide un recordatorio (ver message-intent.ts). */
export const REMINDER_INTENT_FORMAT =
  'Pide un recordatorio: {"intent": "reminder", "text": "<qué hay que recordar, breve>", ' +
  '"local_datetime": "YYYY-MM-DDTHH:mm"}. local_datetime es la hora local de Madrid; sin hora indicada, usa las 09:00.';

export type ReminderRequest =
  | { kind: "reminder"; text: string; remindAt: Date }
  | { kind: "invalid"; message: string };

function invalidReminder(reason: string): ReminderRequest {
  return { kind: "invalid", message: `No he creado el recordatorio: ${reason}.` };
}

/** Valida la respuesta del modelo: puede equivocarse y no queremos guardar basura. */
export function parseReminderRequest(raw: unknown, now: Date): ReminderRequest {
  const candidate = raw as { text?: unknown; local_datetime?: unknown } | null;
  if (typeof candidate?.text !== "string" || candidate.text.trim() === "") {
    return invalidReminder("no he entendido qué quieres que te recuerde");
  }
  let remindAt: Date;
  try {
    remindAt = madridLocalToUtc(String(candidate.local_datetime));
  } catch {
    return invalidReminder("no he entendido la fecha");
  }
  if (remindAt <= now) return invalidReminder("la fecha que he entendido ya ha pasado");
  return { kind: "reminder", text: candidate.text.trim(), remindAt };
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

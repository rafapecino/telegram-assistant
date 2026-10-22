import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { addDaysToDate, formatMadridDateTime, madridClock, madridLocalToUtc, weekdayOf } from "./madrid-time.ts";
import { sendTelegramMessage, type TelegramButton } from "./telegram.ts";

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly";

const REPEAT_LABELS: Record<Repeat, string> = {
  daily: "cada día",
  weekdays: "de lunes a viernes",
  weekly: "cada semana",
  monthly: "cada mes",
};

/** Formato que el modelo debe devolver cuando el mensaje pide un recordatorio (ver message-intent.ts). */
export const REMINDER_INTENT_FORMAT =
  'Pide un recordatorio: {"intent": "reminder", "text": "<qué hay que recordar, breve>", ' +
  '"local_datetime": "YYYY-MM-DDTHH:mm", "repeat": null}. local_datetime es la hora local de Madrid de la primera vez; ' +
  'sin hora indicada, usa las 09:00. Si se repite, repeat es "daily" (cada día), "weekdays" (de lunes a viernes), ' +
  '"weekly" (cada semana) o "monthly" (cada mes); si no, null.';

export type ReminderRequest =
  | { kind: "reminder"; text: string; remindAt: Date; repeat: Repeat | null }
  | { kind: "invalid"; message: string };

function invalidReminder(reason: string): ReminderRequest {
  return { kind: "invalid", message: `No he creado el recordatorio: ${reason}.` };
}

function isRepeat(value: unknown): value is Repeat {
  return typeof value === "string" && value in REPEAT_LABELS;
}

function isWeekend(date: string): boolean {
  const weekday = weekdayOf(date);
  return weekday === 0 || weekday === 6;
}

/** Misma hora local de Madrid en otra fecha (respeta el cambio de hora: las 9:00 siguen siendo las 9:00). */
function atSameLocalTime(instant: Date, date: string): Date {
  return madridLocalToUtc(`${date}T${madridClock(instant).localDateTime.slice(11)}`);
}

/** Valida la respuesta del modelo: puede equivocarse y no queremos guardar basura. */
export function parseReminderRequest(raw: unknown, now: Date): ReminderRequest {
  const candidate = raw as { text?: unknown; local_datetime?: unknown; repeat?: unknown } | null;
  if (typeof candidate?.text !== "string" || candidate.text.trim() === "") {
    return invalidReminder("no he entendido qué quieres que te recuerde");
  }
  const repeat = candidate.repeat ?? null;
  if (repeat !== null && !isRepeat(repeat)) return invalidReminder("no he entendido cada cuánto se repite");
  let remindAt: Date;
  try {
    remindAt = madridLocalToUtc(String(candidate.local_datetime));
  } catch {
    return invalidReminder("no he entendido la fecha");
  }
  if (repeat === "weekdays") {
    // De lunes a viernes: si la primera vez cae en fin de semana, empieza el lunes.
    let date = madridClock(remindAt).localDate;
    while (isWeekend(date)) date = addDaysToDate(date, 1);
    remindAt = atSameLocalTime(remindAt, date);
  }
  if (remindAt <= now) return invalidReminder("la fecha que he entendido ya ha pasado");
  return { kind: "reminder", text: candidate.text.trim(), remindAt, repeat };
}

/** Para la confirmación: "" si no se repite, " y después cada semana" si se repite. */
export function describeRepeat(repeat: Repeat | null): string {
  return repeat ? ` y después ${REPEAT_LABELS[repeat]}` : "";
}

/** El mismo día del mes siguiente, o el último si ese mes es más corto (31 de enero → 28 de febrero). */
function sameDayNextMonth(date: string, day: number): string {
  const [year, month] = date.split("-").map(Number);
  const nextMonthIndex = month % 12; // 0 = enero
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = new Date(Date.UTC(nextYear, nextMonthIndex + 1, 0)).getUTCDate();
  const nextDay = Math.min(day, lastDay);
  return `${nextYear}-${String(nextMonthIndex + 1).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
}

/** Siguiente vez de un recordatorio que se repite, a la misma hora local de Madrid. */
export function nextOccurrence(previous: Date, repeat: Repeat, repeatDay: number | null): Date {
  const date = madridClock(previous).localDate;
  let next: string;
  switch (repeat) {
    case "daily":
      next = addDaysToDate(date, 1);
      break;
    case "weekly":
      next = addDaysToDate(date, 7);
      break;
    case "weekdays":
      next = addDaysToDate(date, 1);
      while (isWeekend(next)) next = addDaysToDate(next, 1);
      break;
    case "monthly":
      next = sameDayNextMonth(date, repeatDay ?? Number(date.slice(8)));
      break;
  }
  return atSameLocalTime(previous, next);
}

/** Si el bot ha estado parado, salta las veces que ya han pasado: la siguiente siempre es futura. */
export function nextOccurrenceAfter(previous: Date, repeat: Repeat, repeatDay: number | null, now: Date): Date {
  let next = nextOccurrence(previous, repeat, repeatDay);
  while (next <= now) next = nextOccurrence(next, repeat, repeatDay);
  return next;
}

export async function saveReminder(
  db: SupabaseClient,
  text: string,
  remindAt: Date,
  repeat: Repeat | null = null,
): Promise<void> {
  const { error } = await db.from("reminders").insert({
    text,
    remind_at: remindAt.toISOString(),
    repeat,
    repeat_day: repeat === "monthly" ? Number(madridClock(remindAt).localDate.slice(8)) : null,
  });
  if (error) throw new Error(`No se pudo guardar el recordatorio: ${error.message}`);
}

// --- Botones del aviso ---

type ButtonAction = "done" | "1h" | "tomorrow";

export interface ReminderButton {
  action: ButtonAction;
  reminderId: number;
}

export function reminderButtons(reminderId: number): TelegramButton[][] {
  return [[
    { text: "✅ Hecho", callback_data: `reminder:done:${reminderId}` },
    { text: "⏰ +1 h", callback_data: `reminder:1h:${reminderId}` },
    { text: "📅 Mañana 9:00", callback_data: `reminder:tomorrow:${reminderId}` },
  ]];
}

/** Lee el `callback_data` de un botón. Devuelve null si no es de un recordatorio o está mal formado. */
export function parseReminderButton(data: string): ReminderButton | null {
  const match = data.match(/^reminder:(done|1h|tomorrow):(\d+)$/);
  return match ? { action: match[1] as ButtonAction, reminderId: Number(match[2]) } : null;
}

export function snoozeUntil(action: "1h" | "tomorrow", now: Date): Date {
  if (action === "1h") return new Date(now.getTime() + 3_600_000);
  return madridLocalToUtc(`${addDaysToDate(madridClock(now).localDate, 1)}T09:00`);
}

/**
 * Aplica el botón pulsado y devuelve el texto con el que queda el aviso. Posponer crea un recordatorio nuevo de una
 * sola vez: si el original se repite, sigue con su calendario.
 */
export async function applyReminderButton(db: SupabaseClient, button: ReminderButton, now: Date): Promise<string> {
  const { data: reminder, error } = await db.from("reminders").select("text").eq("id", button.reminderId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el recordatorio: ${error.message}`);
  if (!reminder) return "Este recordatorio ya no existe.";
  if (button.action === "done") return `⏰ ${reminder.text}\n\n✅ Hecho`;
  const until = snoozeUntil(button.action, now);
  await saveReminder(db, reminder.text, until);
  return `⏰ ${reminder.text}\n\nPospuesto al ${formatMadridDateTime(until)}.`;
}

// --- Envío ---

interface DueReminder {
  id: number;
  text: string;
  remind_at: string;
  repeat: Repeat | null;
  repeat_day: number | null;
}

async function reschedule(db: SupabaseClient, reminder: DueReminder & { repeat: Repeat }, now: Date): Promise<void> {
  const next = nextOccurrenceAfter(new Date(reminder.remind_at), reminder.repeat, reminder.repeat_day, now);
  const { error } = await db.from("reminders")
    .update({ remind_at: next.toISOString(), sent_at: null })
    .eq("id", reminder.id);
  if (error) throw new Error(`No se pudo programar la siguiente vez de "${reminder.text}": ${error.message}`);
}

export async function sendDueReminders(db: SupabaseClient, now: Date): Promise<number> {
  // Se marcan como enviados antes de enviarlos para que dos ejecuciones solapadas no los dupliquen.
  const { data: dueReminders, error } = await db.from("reminders")
    .update({ sent_at: now.toISOString() })
    .is("sent_at", null)
    .lte("remind_at", now.toISOString())
    .select("id, text, remind_at, repeat, repeat_day");
  if (error) throw new Error(`No se pudieron leer los recordatorios pendientes: ${error.message}`);

  for (const reminder of dueReminders as DueReminder[]) {
    try {
      await sendTelegramMessage(`⏰ ${reminder.text}`, reminderButtons(reminder.id));
    } catch (sendError) {
      // Se desmarca para que el siguiente minuto lo reintente.
      await db.from("reminders").update({ sent_at: null }).eq("id", reminder.id);
      throw sendError;
    }
    if (reminder.repeat) await reschedule(db, { ...reminder, repeat: reminder.repeat }, now);
  }
  return dueReminders.length;
}

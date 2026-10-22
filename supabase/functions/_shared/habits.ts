import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { addDaysToDate, madridClock } from "./madrid-time.ts";
import { sendTelegramMessage, type TelegramButton } from "./telegram.ts";
import { tidyName } from "./text.ts";

export const HABIT_QUESTION_HOUR = 21;
const HISTORY_DAYS = 60;

/** Formato que el modelo debe devolver cuando el mensaje habla de hábitos (ver message-intent.ts). */
export const HABIT_INTENT_FORMAT =
  'Hábitos diarios: {"intent": "habit", "action": "create", "name": "<hábito, breve>", "done": null}. action es ' +
  '"create" para empezar a seguir uno ("quiero leer cada día"), "log" para apuntar si hoy lo ha hecho ("hoy he hecho ' +
  'ejercicio", con done true o false), "list" para ver cómo va y "delete" para dejar de seguirlo.';

export type HabitRequest =
  | { kind: "habit_create"; name: string }
  | { kind: "habit_delete"; name: string }
  | { kind: "habit_log"; name: string; done: boolean }
  | { kind: "habit_list" }
  | { kind: "invalid"; message: string };

export function parseHabitRequest(raw: unknown): HabitRequest {
  const candidate = raw as { action?: unknown; name?: unknown; done?: unknown } | null;
  if (candidate?.action === "list") return { kind: "habit_list" };
  const name = typeof candidate?.name === "string" ? tidyName(candidate.name).slice(0, 100) : "";
  if (!name) return { kind: "invalid", message: "No he entendido de qué hábito hablas." };
  if (candidate?.action === "create") return { kind: "habit_create", name };
  if (candidate?.action === "delete") return { kind: "habit_delete", name };
  if (candidate?.action === "log") {
    if (typeof candidate.done !== "boolean") return { kind: "invalid", message: "No he entendido si lo has hecho." };
    return { kind: "habit_log", name, done: candidate.done };
  }
  return { kind: "invalid", message: "No he entendido qué hacer con el hábito." };
}

export interface Habit {
  id: number;
  name: string;
  scheduled_days?: number[];
}

export interface HabitCheck {
  habit_id: number;
  date: string;
  done: boolean;
}

/** Días seguidos cumplidos hasta hoy. Si hoy aún no se ha contestado, cuenta hasta ayer: la racha no se rompe. */
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
function weekday(date: string): number { return new Date(`${date}T12:00:00Z`).getUTCDay() || 7; }

export function currentStreak(checks: HabitCheck[], today: string, scheduledDays = ALL_DAYS): number {
  const doneDays = new Set(checks.filter((check) => check.done).map((check) => check.date));
  const answeredToday = checks.some((check) => check.date === today);
  let day = answeredToday ? today : addDaysToDate(today, -1);
  let streak = 0;
  for (let count = 0; count < 366; count++) {
    if (scheduledDays.includes(weekday(day))) {
      if (!doneDays.has(day)) break;
      streak++;
    }
    day = addDaysToDate(day, -1);
  }
  return streak;
}

/** Cuántos de los últimos 7 días (hoy incluido) se ha cumplido. */
export function doneLastWeek(checks: HabitCheck[], today: string, scheduledDays = ALL_DAYS): number {
  const weekStart = addDaysToDate(today, -6);
  return checks.filter((check) => check.done && check.date >= weekStart && check.date <= today && scheduledDays.includes(weekday(check.date))).length;
}

export function habitButtons(habitId: number, date: string): TelegramButton[][] {
  return [[
    { text: "✅ Sí", callback_data: `habit:yes:${habitId}:${date}` },
    { text: "❌ No", callback_data: `habit:no:${habitId}:${date}` },
  ]];
}

/** El botón lleva la fecha: si se contesta al día siguiente, cuenta para el día en que se preguntó. */
export function parseHabitButton(data: string): { habitId: number; date: string; done: boolean } | null {
  const match = data.match(/^habit:(yes|no):(\d+):(\d{4}-\d{2}-\d{2})$/);
  return match ? { habitId: Number(match[2]), date: match[3], done: match[1] === "yes" } : null;
}

function streakText(streak: number): string {
  return streak === 1 ? "1 día" : `${streak} días`;
}

export function describeAnswer(habit: Habit, done: boolean, streak: number): string {
  if (!done) return `❌ ${habit.name}: hoy no. Mañana más.`;
  return `✅ ${habit.name}: hecho. Racha: ${streakText(streak)}.`;
}

export function formatHabitList(habits: Habit[], checks: HabitCheck[], today: string): string {
  if (habits.length === 0) return "No sigues ningún hábito. Prueba con «quiero leer cada día».";
  const lines = habits.map((habit) => {
    const own = checks.filter((check) => check.habit_id === habit.id);
    const days = habit.scheduled_days ?? ALL_DAYS;
    return `• ${habit.name}: racha de ${streakText(currentStreak(own, today, days))} · ${
      doneLastWeek(own, today, days)
    } de ${days.length} días previstos esta semana`;
  });
  return [`Tus hábitos (te pregunto los días elegidos a las ${HABIT_QUESTION_HOUR}:00):`, ...lines].join("\n");
}

export async function listHabits(db: SupabaseClient): Promise<Habit[]> {
  const { data, error } = await db.from("habits").select("id, name, scheduled_days").order("created_at");
  if (error) throw new Error(`No se pudieron leer los hábitos: ${error.message}`);
  return data;
}

export async function loadChecks(db: SupabaseClient, today: string): Promise<HabitCheck[]> {
  const { data, error } = await db.from("habit_checks").select("habit_id, date, done")
    .gte("date", addDaysToDate(today, -HISTORY_DAYS));
  if (error) throw new Error(`No se pudo leer el seguimiento de los hábitos: ${error.message}`);
  return data;
}

export async function createHabit(db: SupabaseClient, name: string): Promise<void> {
  const { error } = await db.from("habits").upsert({ name }, { onConflict: "name", ignoreDuplicates: true });
  if (error) throw new Error(`No se pudo crear el hábito: ${error.message}`);
}

export async function deleteHabit(db: SupabaseClient, habitId: number): Promise<void> {
  const { error } = await db.from("habits").delete().eq("id", habitId);
  if (error) throw new Error(`No se pudo borrar el hábito: ${error.message}`);
}

/** Apunta si se ha cumplido un día y devuelve la racha resultante. */
export async function recordHabit(db: SupabaseClient, habit: Habit, date: string, done: boolean): Promise<number> {
  const { error } = await db.from("habit_checks")
    .upsert({ habit_id: habit.id, date, done, answered_at: new Date().toISOString() }, { onConflict: "habit_id,date" });
  if (error) throw new Error(`No se pudo apuntar el hábito: ${error.message}`);
  const checks = (await loadChecks(db, date)).filter((check) => check.habit_id === habit.id);
  return currentStreak(checks, date, habit.scheduled_days ?? ALL_DAYS);
}

/** A las 21:00 pregunta por cada hábito que aún no se haya apuntado hoy. Devuelve cuántas preguntas ha hecho. */
export async function askHabits(db: SupabaseClient, now: Date): Promise<number> {
  const today = madridClock(now).localDate;
  const habits = await listHabits(db);
  if (habits.length === 0) return 0;
  const answered = new Set(
    (await loadChecks(db, today)).filter((check) => check.date === today).map((check) => check.habit_id),
  );
  const pending = habits.filter((habit) =>
    (habit.scheduled_days ?? ALL_DAYS).includes(weekday(today)) && !answered.has(habit.id)
  );
  for (const habit of pending) {
    await sendTelegramMessage(`¿Has hecho «${habit.name}» hoy?`, habitButtons(habit.id, today));
  }
  return pending.length;
}

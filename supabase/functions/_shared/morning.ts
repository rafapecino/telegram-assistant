import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { type Birthday, birthdaysOn, listBirthdays, nameWithAge } from "./birthdays.ts";
import { type CalendarEvent, isCalendarConnected, listEvents } from "./calendar.ts";
import { errorMessage } from "./env.ts";
import { addDaysToDate, madridClock, madridLocalToUtc } from "./madrid-time.ts";
import { listShoppingItems } from "./shopping.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { DEFAULT_CITY, describeWeather, fetchTodayWeather } from "./weather.ts";

export const MORNING_SUMMARY_HOUR = 8;

const longDate = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function localTime(instant: Date): string {
  return madridClock(instant).localDateTime.slice(11);
}

export function greetingLine(today: string): string {
  return `☀️ Buenos días. Hoy es ${longDate.format(new Date(`${today}T00:00:00Z`))}.`;
}

export function reminderLines(reminders: { text: string; remind_at: string }[]): string[] {
  if (reminders.length === 0) return [];
  return ["⏰ Recordatorios de hoy:", ...reminders.map((r) => `• ${localTime(new Date(r.remind_at))} ${r.text}`)];
}

export function eventLines(events: CalendarEvent[]): string[] {
  if (events.length === 0) return ["📅 Hoy no tienes nada en el calendario."];
  return [
    "📅 Hoy en tu calendario:",
    ...events.map((event) => `• ${event.start ? localTime(event.start) : "Todo el día"} ${event.title}`),
  ];
}

export function birthdayLines(birthdays: Birthday[], today: string): string[] {
  const tomorrow = addDaysToDate(today, 1);
  return [
    ...birthdaysOn(birthdays, today).map((birthday) => `🎂 Hoy es el cumpleaños de ${nameWithAge(birthday, today)}.`),
    ...birthdaysOn(birthdays, tomorrow).map((birthday) =>
      `🎁 Mañana es el cumpleaños de ${nameWithAge(birthday, tomorrow)}.`
    ),
  ];
}

export function shoppingLines(itemCount: number): string[] {
  if (itemCount === 0) return [];
  return [`🛒 Tienes ${itemCount} ${itemCount === 1 ? "cosa" : "cosas"} en la lista de la compra.`];
}

/** Une las partes que tienen algo que decir, separadas por una línea en blanco. */
export function composeSummary(sections: string[][]): string {
  return sections.filter((lines) => lines.length > 0).map((lines) => lines.join("\n")).join("\n\n");
}

/** Si una parte falla, el resumen lo dice en su lugar y se envía igual con el resto. */
async function section(label: string, load: () => Promise<string[]>): Promise<string[]> {
  try {
    return await load();
  } catch (error) {
    console.error(`Resumen de la mañana: no se pudo consultar ${label}`, error);
    return [`(No he podido consultar ${label}: ${errorMessage(error)})`];
  }
}

async function todayReminders(db: SupabaseClient, today: string) {
  const { data, error } = await db.from("reminders").select("text, remind_at")
    .is("sent_at", null)
    .gte("remind_at", madridLocalToUtc(`${today}T00:00`).toISOString())
    .lt("remind_at", madridLocalToUtc(`${addDaysToDate(today, 1)}T00:00`).toISOString())
    .order("remind_at");
  if (error) throw new Error(error.message);
  return data;
}

export async function buildMorningSummary(db: SupabaseClient, now: Date): Promise<string> {
  const today = madridClock(now).localDate;
  const city = Deno.env.get("WEATHER_CITY")?.trim() || DEFAULT_CITY;
  return composeSummary([
    [greetingLine(today)],
    await section("el tiempo", async () => [describeWeather(await fetchTodayWeather(city))]),
    await section("los recordatorios", async () => reminderLines(await todayReminders(db, today))),
    // Sin calendario conectado no hay nada que decir: no es un fallo.
    await section(
      "el calendario",
      async () => await isCalendarConnected(db) ? eventLines(await listEvents(db, today, today)) : [],
    ),
    await section("los cumpleaños", async () => birthdayLines(await listBirthdays(db), today)),
    await section("la lista de la compra", async () => shoppingLines((await listShoppingItems(db)).length)),
  ]);
}

export async function sendMorningSummary(db: SupabaseClient, now: Date): Promise<void> {
  await sendTelegramMessage(await buildMorningSummary(db, now));
}

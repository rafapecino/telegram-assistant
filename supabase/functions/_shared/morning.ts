import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { fetchWeatherAlerts, morningAlertLines } from "./aemet.ts";
import { type Birthday, birthdaysOn, listBirthdays, nameWithAge } from "./birthdays.ts";
import { type CalendarEvent, isCalendarConnected, listEvents } from "./calendar.ts";
import { errorMessage } from "./env.ts";
import { MORNING_QUERY, morningEmailLines, searchEmails } from "./gmail.ts";
import { addDaysToDate, madridClock, madridLocalToUtc } from "./madrid-time.ts";
import { inventFunnyLine } from "./memory.ts";
import { listShoppingItems } from "./shopping.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { DEFAULT_CITY, describeWeather, fetchTodayWeather } from "./weather.ts";

export const MORNING_SUMMARY_HOUR = 8;

const longDate = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function localTime(instant: Date): string {
  return madridClock(instant).localDateTime.slice(11);
}

// Uno distinto cada día para que no suene a robot; con guasa porque así lo quiere Rafa (que no le llamen Rafita).
const GREETINGS = [
  "☀️ Buenos días, Petzi.",
  "☀️ Arriba, Petzi, que se te pegan las sábanas.",
  "☀️ Venga, pringao, que el día no se hace solo.",
  "☀️ Buenas, Rafa. A ver qué nos trae hoy.",
  "☀️ Despierta, cabrón, que hay cosas que hacer.",
  "☀️ Muy buenas, Petzi. Primero café y luego hablamos.",
  "☀️ Hola, Rafa. Otro día más aguantándote.",
  "☀️ Buenos días, ingeniero. La tesis no se escribe sola.",
  "☀️ Arriba, Rafa, que la energética no se bebe sola.",
  "☀️ Buenos días, Petzi. Hoy toca gimnasio, no te hagas el loco.",
  "☀️ Venga, cabrón, que hoy es un gran día para no procrastinar.",
  "☀️ Buenos días, Rafa. Te he preparado el día; el café ya es cosa tuya.",
  "☀️ Despierta, pringao, que el mundo no se consulta solo.",
  "☀️ Buenas, Petzi. ¿Hoy sí o hoy tampoco?",
  "☀️ Arriba, Rafa, que hasta el banco ha madrugado más que tú.",
  "☀️ Buenos días, máquina. Bueno, máquina a medias.",
  "☀️ Hola, Petzi. Tu asistente favorito ya está currando, ¿y tú?",
  "☀️ Buenos días, cabrón. Menos móvil y más tesis.",
  "☀️ Arriba, Rafa. Hoy te veo con cara de ir al gimnasio. O no.",
  "☀️ Buenos días, Petzi. Que no se te olvide que yo me acuerdo de todo.",
  "☀️ Buenos días, fiera. Hoy vas a comerte el mundo (después del café).",
  "☀️ Arriba, mamón, que las sábanas no pagan facturas.",
  "☀️ Buenos días, señor ingeniero. Sus energéticas le esperan.",
  "☀️ Despierta, melón, que ya ha salido el sol sin ti.",
  "☀️ Muy buenas, crack. Hoy toca demostrar que lo eres.",
  "☀️ Buenos días, doctorando. ¿Una página de tesis antes del primer cigarro?",
  "☀️ Arriba, golfo, que ayer te vi conectado hasta tarde.",
  "☀️ Buenos días, figura. El estanco abre a las 9, la tesis cuando quieras.",
  "☀️ Venga, tronco, que el gimnasio no se va a ir a buscarte.",
  "☀️ Buenos días, sinvergüenza. Hoy te portas bien, ¿vale?",
  "☀️ Arriba, campeón, que el día está para ganarlo.",
  "☀️ Buenos días, zángano. Hoy sí, ¿eh?",
  "☀️ Buenos días, artista. Pinta bien el día.",
  "☀️ Despierta, cenutrio, que tienes cosas pendientes.",
  "☀️ Buenos días, jefe. Aquí tu becario digital, al pie del cañón.",
  "☀️ Arriba, bribón, que te conozco.",
  "☀️ Buenos días, Rafa. Hoy es buen día para no fumar. Lo dejo caer.",
  "☀️ Muy buenas, pájaro. ¿Dormiste o estuviste dándole a la tesis?",
  "☀️ Buenos días, bestia. A por el día.",
];
// Uno de cada tantos días el saludo lo inventa Groq con la memoria, para que sorprenda.
const SURPRISE_EVERY_DAYS = 3;

const MS_PER_DAY = 86_400_000;

function dayNumber(today: string): number {
  return Math.floor(Date.parse(`${today}T00:00:00Z`) / MS_PER_DAY);
}

function todayText(today: string): string {
  return `Hoy es ${longDate.format(new Date(`${today}T00:00:00Z`))}.`;
}

export function greetingLine(today: string): string {
  // Por número de día y no al azar: rota sin repetirse en días seguidos y los tests son estables.
  return `${GREETINGS[dayNumber(today) % GREETINGS.length]} ${todayText(today)}`;
}

/** Los días de sorpresa, frase inventada por Groq; si falla, el saludo de siempre (el resumen tiene que llegar). */
export async function morningGreeting(db: SupabaseClient, today: string): Promise<string> {
  if (dayNumber(today) % SURPRISE_EVERY_DAYS !== 0) return greetingLine(today);
  try {
    return `☀️ ${await inventFunnyLine(db)} ${todayText(today)}`;
  } catch (error) {
    console.error("Resumen de la mañana: no se pudo inventar el saludo", error);
    return greetingLine(today);
  }
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
    [await morningGreeting(db, today)],
    await section("el tiempo", async () => [describeWeather(await fetchTodayWeather(city))]),
    await section("los avisos de AEMET", async () => morningAlertLines(await fetchWeatherAlerts(), now)),
    await section("los recordatorios", async () => reminderLines(await todayReminders(db, today))),
    // Sin calendario conectado no hay nada que decir: no es un fallo.
    await section(
      "el calendario",
      async () => await isCalendarConnected(db) ? eventLines(await listEvents(db, today, today)) : [],
    ),
    await section("el correo", async () => {
      if (!await isCalendarConnected(db)) return [];
      const { emails, total } = await searchEmails(db, MORNING_QUERY);
      return morningEmailLines(emails, total);
    }),
    await section("los cumpleaños", async () => birthdayLines(await listBirthdays(db), today)),
    await section("la lista de la compra", async () => shoppingLines((await listShoppingItems(db)).length)),
  ]);
}

export async function sendMorningSummary(db: SupabaseClient, now: Date): Promise<void> {
  await sendTelegramMessage(await buildMorningSummary(db, now));
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { tidyName } from "./text.ts";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const UPCOMING_LISTED = 10;

/** Formato que el modelo debe devolver cuando el mensaje habla de cumpleaños (ver message-intent.ts). */
export const BIRTHDAY_INTENT_FORMAT =
  'Cumpleaños: {"intent": "birthday", "action": "save", "name": "<de quién>", "month": 3, "day": 14, "year": null}. ' +
  'action es "save" para guardar uno, "delete" para borrarlo y "list" para ver los próximos. year es el año de ' +
  "nacimiento si lo dice; si no, null.";

export type BirthdayRequest =
  | { kind: "birthday_save"; name: string; month: number; day: number; year: number | null }
  | { kind: "birthday_delete"; name: string }
  | { kind: "birthday_list" }
  | { kind: "invalid"; message: string };

function daysInMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseBirthdayRequest(raw: unknown, currentYear: number): BirthdayRequest {
  const candidate = raw as { action?: unknown; name?: unknown; month?: unknown; day?: unknown; year?: unknown } | null;
  if (candidate?.action === "list") return { kind: "birthday_list" };
  const name = typeof candidate?.name === "string" ? tidyName(candidate.name).slice(0, 100) : "";
  if (!name) return { kind: "invalid", message: "No he entendido de quién es el cumpleaños." };
  if (candidate?.action === "delete") return { kind: "birthday_delete", name };
  if (candidate?.action !== "save") return { kind: "invalid", message: "No he entendido qué hacer con el cumpleaños." };
  const month = Number(candidate.month);
  const day = Number(candidate.day);
  // 2024 es bisiesto: así se acepta el 29 de febrero.
  if (
    !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 ||
    day > daysInMonth(month, 2024)
  ) {
    return { kind: "invalid", message: "No he entendido la fecha del cumpleaños." };
  }
  const year = candidate.year === null || candidate.year === undefined ? null : Number(candidate.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > currentYear)) {
    return { kind: "invalid", message: "No he entendido el año de nacimiento." };
  }
  return { kind: "birthday_save", name, month, day, year };
}

export interface Birthday {
  id: number;
  name: string;
  month: number;
  day: number;
  year: number | null;
}

/** El cumpleaños en un año concreto. Quien nació el 29 de febrero lo celebra el 28 en los años no bisiestos. */
function birthdayIn(birthday: Birthday, year: number): string {
  const day = Math.min(birthday.day, daysInMonth(birthday.month, year));
  return `${year}-${String(birthday.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Fecha (YYYY-MM-DD) del próximo cumpleaños a partir de `today`, incluido hoy. */
export function nextBirthday(birthday: Birthday, today: string): string {
  const year = Number(today.slice(0, 4));
  const thisYear = birthdayIn(birthday, year);
  return thisYear >= today ? thisYear : birthdayIn(birthday, year + 1);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Años que cumple en `date`, o null si no se sabe el año de nacimiento. */
export function ageOn(birthday: Birthday, date: string): number | null {
  return birthday.year === null ? null : Number(date.slice(0, 4)) - birthday.year;
}

/** Cumpleaños que caen exactamente en `date`. */
export function birthdaysOn(birthdays: Birthday[], date: string): Birthday[] {
  return birthdays.filter((birthday) => birthdayIn(birthday, Number(date.slice(0, 4))) === date);
}

export function describeBirthdayDate(birthday: Pick<Birthday, "day" | "month">): string {
  return `${birthday.day} de ${MONTHS[birthday.month - 1]}`;
}

/** "Mamá (60)" o "Mamá" si no se sabe el año. */
export function nameWithAge(birthday: Birthday, date: string): string {
  const age = ageOn(birthday, date);
  return age === null ? birthday.name : `${birthday.name} (${age})`;
}

export function formatUpcomingBirthdays(birthdays: Birthday[], today: string): string {
  if (birthdays.length === 0) return "No tienes cumpleaños guardados. Prueba con «el cumple de mamá es el 3 de marzo».";
  const upcoming = birthdays
    .map((birthday) => ({ birthday, date: nextBirthday(birthday, today) }))
    .sort((first, second) => first.date.localeCompare(second.date))
    .slice(0, UPCOMING_LISTED)
    .map(({ birthday, date }) => {
      const days = daysBetween(today, date);
      const when = days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`;
      return `• ${nameWithAge(birthday, date)}: ${describeBirthdayDate(birthday)}, ${when}`;
    });
  return ["Próximos cumpleaños:", ...upcoming].join("\n");
}

export async function listBirthdays(db: SupabaseClient): Promise<Birthday[]> {
  const { data, error } = await db.from("birthdays").select("id, name, month, day, year");
  if (error) throw new Error(`No se pudieron leer los cumpleaños: ${error.message}`);
  return data;
}

export async function saveBirthday(
  db: SupabaseClient,
  birthday: Omit<Birthday, "id">,
): Promise<void> {
  const { error } = await db.from("birthdays").upsert(birthday, { onConflict: "name" });
  if (error) throw new Error(`No se pudo guardar el cumpleaños: ${error.message}`);
}

export async function deleteBirthday(db: SupabaseClient, birthdayId: number): Promise<void> {
  const { error } = await db.from("birthdays").delete().eq("id", birthdayId);
  if (error) throw new Error(`No se pudo borrar el cumpleaños: ${error.message}`);
}

// Formatos en español y horas de Madrid, aunque el navegador esté en otra zona horaria.

const MADRID_TIME_ZONE = "Europe/Madrid";

const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export function formatEuros(amount: number): string {
  return euros.format(amount);
}

const madridDateTime = new Intl.DateTimeFormat("es-ES", {
  timeZone: MADRID_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Por ejemplo "jue, 23 oct, 17:00". */
export function formatMadridDateTime(isoInstant: string): string {
  return madridDateTime.format(new Date(isoInstant));
}

const shortDate = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short" });

/** Fecha sin hora ("2026-10-20") como "20 oct". */
export function formatDay(isoDate: string): string {
  return shortDate.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Minutos que Madrid va por delante de UTC en un instante dado: 60 en invierno, 120 en verano. */
function madridOffsetMinutes(instant: Date): number {
  const offsetName = new Intl.DateTimeFormat("en-US", { timeZone: MADRID_TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offsetName.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Convierte la hora local de Madrid de un <input type="datetime-local"> ("2026-10-26T17:00") en ISO con desfase. */
export function madridLocalToIso(localDateTime: string): string {
  const wallClockAsUtc = Date.parse(`${localDateTime}:00Z`);
  // El desfase depende del propio instante: se recalcula una vez para acertar en los días de cambio de hora.
  const firstGuess = wallClockAsUtc - madridOffsetMinutes(new Date(wallClockAsUtc)) * 60_000;
  const offset = madridOffsetMinutes(new Date(firstGuess));
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return `${localDateTime}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** Hora local de Madrid de un instante en el formato de <input type="datetime-local">. */
function toMadridLocal(instant: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: MADRID_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function madridNowLocal(now: Date = new Date()): string {
  return toMadridLocal(now);
}

/** Suma días a una fecha sin hora ("2026-10-31" + 1 = "2026-11-01"). */
function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  return Math.round((Date.parse(`${toIsoDate}T00:00:00Z`) - Date.parse(`${fromIsoDate}T00:00:00Z`)) / 86_400_000);
}

// --- Atajos del formulario de recordatorios (devuelven el formato de <input type="datetime-local">) ---

export function inOneHourLocal(now: Date = new Date()): string {
  return toMadridLocal(new Date(now.getTime() + 3_600_000));
}

export function tomorrowAtNineLocal(now: Date = new Date()): string {
  return `${addDays(toMadridLocal(now).slice(0, 10), 1)}T09:00`;
}

/** El próximo lunes a las 9:00 que aún no haya pasado (si hoy es lunes antes de las 9, hoy). */
export function nextMondayAtNineLocal(now: Date = new Date()): string {
  const local = toMadridLocal(now);
  const today = local.slice(0, 10);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = domingo, 1 = lunes
  let daysAhead = (8 - weekday) % 7;
  if (daysAhead === 0 && local.slice(11) >= "09:00") daysAhead = 7;
  return `${addDays(today, daysAhead)}T09:00`;
}

// --- Fecha relativa de un recordatorio ---

const weekdayName = new Intl.DateTimeFormat("es-ES", { timeZone: MADRID_TIME_ZONE, weekday: "long" });
const shortWeekdayDate = new Intl.DateTimeFormat("es-ES", {
  timeZone: MADRID_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/**
 * "Hoy · 18:00", "Mañana · 09:00", "Viernes · 09:00" (de 2 a 6 días) o "jue, 30 oct · 09:00".
 * Hoy y mañana se cuentan en el calendario de Madrid, no en el del navegador.
 */
export function formatReminderWhen(isoInstant: string, now: Date = new Date()): string {
  const instant = new Date(isoInstant);
  const local = toMadridLocal(instant);
  const daysAhead = daysBetween(toMadridLocal(now).slice(0, 10), local.slice(0, 10));
  let day: string;
  if (daysAhead === 0) day = "Hoy";
  else if (daysAhead === 1) day = "Mañana";
  else if (daysAhead >= 2 && daysAhead <= 6) {
    const name = weekdayName.format(instant);
    day = name.charAt(0).toUpperCase() + name.slice(1);
  } else day = shortWeekdayDate.format(instant);
  return `${day} · ${local.slice(11)}`;
}

const MADRID_TIME_ZONE = "Europe/Madrid";
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Minutos que Madrid va por delante de UTC en un instante dado: 60 en invierno, 120 en verano. */
function madridOffsetMinutes(instant: Date): number {
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offsetName.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Convierte una hora local de Madrid ("2026-10-26T17:00") en un instante, respetando el cambio de hora. */
export function madridLocalToUtc(localDateTime: string): Date {
  const match = localDateTime.match(LOCAL_DATE_TIME_PATTERN);
  if (!match) throw new Error(`Fecha local con formato no válido: ${localDateTime}`);
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wallClockAsUtc).getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new Error(`Fecha local inexistente: ${localDateTime}`);
  }
  // El desfase depende del propio instante: se recalcula una vez para acertar en los días de cambio de hora.
  const firstGuess = wallClockAsUtc - madridOffsetMinutes(new Date(wallClockAsUtc)) * 60_000;
  return new Date(wallClockAsUtc - madridOffsetMinutes(new Date(firstGuess)) * 60_000);
}

export interface MadridClock {
  localDateTime: string;
  localDate: string;
  weekday: string;
  hour: number;
  isSunday: boolean;
}

export function madridClock(instant: Date): MadridClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("es-ES", {
      timeZone: MADRID_TIME_ZONE,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    localDateTime: `${localDate}T${parts.hour}:${parts.minute}`,
    localDate,
    weekday: parts.weekday,
    hour: Number(parts.hour),
    isSunday: new Date(`${localDate}T00:00:00Z`).getUTCDay() === 0,
  };
}

/** Fecha legible en español, por ejemplo "jueves, 23 de octubre, 17:00". */
export function formatMadridDateTime(instant: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: MADRID_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/** Fecha local de Madrid (YYYY-MM-DD) de hace `days` días. */
export function madridDateDaysAgo(now: Date, days: number): string {
  return madridClock(new Date(now.getTime() - days * 86_400_000)).localDate;
}

/** Primer día del mes en curso en Madrid, por ejemplo "2026-10-01". */
export function madridMonthStart(now: Date): string {
  return `${madridClock(now).localDate.slice(0, 8)}01`;
}

/** Suma días a una fecha sin hora: "2026-10-31" + 1 = "2026-11-01". */
export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Día de la semana de una fecha sin hora: 0 domingo, 1 lunes… 6 sábado. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

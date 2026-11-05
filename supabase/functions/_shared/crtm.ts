// Autobuses interurbanos del CRTM (627, N907…): próximos pasos en tiempo real y, si no hay, los del horario.
// El tiempo real sale del servicio que usan los widgets de crtm.es: no es una API pública documentada, así que si falla
// se responde con el horario. Los horarios están en crtm-schedules.json (ver scripts/crtm-schedules.ts).
import schedules from "./crtm-schedules.json" with { type: "json" };
import { addDaysToDate, madridClock, madridLocalToUtc, weekdayOf } from "./madrid-time.ts";
import { matchByName } from "./text.ts";

const STOP_TIMES_URL = "https://www.crtm.es/widgets/api/GetStopsTimes.php";
// Código corto de parada interurbana, el que aparece en la marquesina: «10590».
export const INTERURBAN_STOP = /^\d{5}$/;
const DEPARTURES_SHOWN = 3;
// Pocas peticiones a un servicio que no es público: la misma parada se reutiliza durante un minuto.
const CACHE_MS = 60_000;

export interface Departure {
  line: string;
  destination: string;
  at: Date;
  isScheduled: boolean;
}

interface Schedules {
  stops: Record<string, string>;
  services: Record<string, { days: number[]; start: string; end: string; added: string[]; removed: string[] }>;
  // «lv»: solo de lunes a viernes; «sdf»: sábados, domingos y festivos; null: lo que diga el calendario.
  trips: {
    line: string;
    service: string;
    headsign: string;
    dayType: "lv" | "sdf" | null;
    times: Record<string, string>;
  }[];
}
const SCHEDULES = schedules as unknown as Schedules;

/** Las paradas de las líneas con horario, para buscarlas por nombre («Universidad» → 10590). */
/** Las paradas de ese nombre: en los dos sentidos se llaman igual y tienen códigos distintos (10589 y 10590). */
export function findScheduledStop(name: string): { codes: string[]; name: string } | null {
  const byName = new Map<string, string[]>();
  for (const [code, stopName] of Object.entries(SCHEDULES.stops)) {
    byName.set(stopName, [...(byName.get(stopName) ?? []), code]);
  }
  return matchByName([...byName].map(([stopName, codes]) => ({ name: stopName, codes })), name);
}

export function scheduledStopName(code: string): string | null {
  return SCHEDULES.stops[code] ?? null;
}

type Trip = Schedules["trips"][number];

/** Los viajes desde los que se puede subir en la parada: no cuentan los que terminan en ella. */
function boardingTrips(stopCode: string): Trip[] {
  return SCHEDULES.trips.filter((trip) => {
    const time = trip.times[stopCode];
    return time !== undefined && Object.values(trip.times).some((other) => other > time);
  });
}

/**
 * Si los viajes que se cogen en la parada salen de ella (Moncloa): ahí manda el horario. Basta con tres de cada cuatro: el
 * GTFS trae algún viaje suelto que empieza una parada antes.
 */
export function isLineOrigin(stopCode: string): boolean {
  const trips = boardingTrips(stopCode);
  const starting = trips.filter((trip) => Object.values(trip.times).every((time) => time >= trip.times[stopCode]));
  return trips.length > 0 && starting.length >= trips.length * 0.75;
}

/** Las líneas con horario (627 y N907): sin línea pedida, se enseñan solo estas, no todas las de la parada. */
export const KNOWN_LINES = [...new Set(SCHEDULES.trips.map((trip) => trip.line))];
const isWanted = (line: string | null) => (departure: { line: string }) =>
  line ? departure.line === line : KNOWN_LINES.includes(departure.line);

function runsOn(trip: Trip, date: string): boolean {
  const service = SCHEDULES.services[trip.service];
  if (!service || service.removed.includes(date)) return false;
  const weekday = weekdayOf(date);
  // Los festivos entre semana no se distinguen: ese día se enseña el horario de laborables.
  if (trip.dayType === "lv" && (weekday === 0 || weekday === 6)) return false;
  if (trip.dayType === "sdf" && weekday !== 0 && weekday !== 6) return false;
  if (service.added.includes(date)) return true;
  // weekdayOf: 0 = domingo; en el GTFS el primer día es el lunes.
  return date >= service.start && date <= service.end && service.days[(weekday + 6) % 7] === 1;
}

/** Las próximas salidas programadas desde la parada. Los nocturnos de las 00:30 cuentan como «24:30» del día anterior. */
export function scheduledDepartures(stopCode: string, line: string | null, now: Date): Departure[] {
  const today = madridClock(now).localDate;
  const departures: Departure[] = [];
  for (const serviceDate of [addDaysToDate(today, -1), today, addDaysToDate(today, 1)]) {
    for (const trip of boardingTrips(stopCode)) {
      const time = trip.times[stopCode];
      if (!time || (line && trip.line !== line) || !runsOn(trip, serviceDate)) continue;
      const [hours, minutes] = time.split(":").map(Number);
      const date = addDaysToDate(serviceDate, Math.floor(hours / 24));
      const at = madridLocalToUtc(`${date}T${String(hours % 24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
      if (at > now) departures.push({ line: trip.line, destination: trip.headsign, at, isScheduled: true });
    }
  }
  const seen = new Set<string>();
  return departures.sort((a, b) => a.at.getTime() - b.at.getTime()).filter((departure) => {
    const key = `${departure.at.getTime()}|${departure.line}|${departure.destination}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface TimetableEntry {
  time: string;
  line: string;
  destination: string;
}

/** Todas las salidas programadas de un día en las paradas. Los nocturnos de madrugada van al final («24:14» → 00:14). */
export function dayTimetable(stopCodes: string[], serviceDate: string): TimetableEntry[] {
  const entries = stopCodes.flatMap((code) =>
    boardingTrips(code).filter((trip) => runsOn(trip, serviceDate)).map((trip) => ({
      sortKey: trip.times[code],
      time: `${String(Number(trip.times[code].slice(0, 2)) % 24).padStart(2, "0")}${trip.times[code].slice(2)}`,
      line: trip.line,
      destination: trip.headsign,
    }))
  );
  // El GTFS repite algún viaje (mismo bus con dos variantes de recorrido): se enseña una vez.
  const seen = new Set<string>();
  return entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).flatMap(({ time, line, destination }) => {
    const key = `${time}|${line}|${destination}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ time, line, destination }];
  });
}

const NIGHT_LINE = "N907";
const NIGHT_ENDS = "06:00";

/**
 * «¿Cuál es el último para Villanueva?»: el último de hoy de la línea pedida (el 627 si no dice) y, si no pide otra,
 * los nocturnos de esta noche, que en el horario cuentan como madrugada del día siguiente.
 */
export function formatLastOfDay(label: string, stopCodes: string[], line: string | null, now: Date): string {
  const clock = madridClock(now), nowTime = clock.localDateTime.slice(11, 16);
  const tonight = dayTimetable(stopCodes, addDaysToDate(clock.localDate, 1))
    .filter((entry) => entry.line === NIGHT_LINE && entry.time < NIGHT_ENDS);
  const nightText = tonight.length
    ? `el ${NIGHT_LINE} esta noche a las ${tonight.map((entry) => entry.time).join(", ")}`
    : `ningún ${NIGHT_LINE} esta noche`;
  if (line === NIGHT_LINE) return `🚌 ${label}: tienes ${nightText}.\nDatos: CRTM (horario)`;
  const wanted = line ?? KNOWN_LINES.find((known) => known !== NIGHT_LINE) ?? "627";
  const last = dayTimetable(stopCodes, clock.localDate)
    .filter((entry) => entry.line === wanted && entry.time >= NIGHT_ENDS).at(-1);
  if (!last) return `🚌 ${label}: hoy no hay ${wanted} según el horario.\nDatos: CRTM (horario)`;
  const verb = last.time < nowTime ? "salió" : "sale";
  const after = line ? "" : ` Después, ${nightText}.`;
  return `🚌 ${label}: el último ${wanted} de hoy ${verb} a las ${last.time} hacia ${last.destination}.${after}\n` +
    "Datos: CRTM (horario)";
}

const DAY_TYPES = [
  { label: "Laborables", matches: (weekday: number) => weekday >= 1 && weekday <= 5 },
  { label: "Sábados", matches: (weekday: number) => weekday === 6 },
  { label: "Domingos", matches: (weekday: number) => weekday === 0 },
];

/** El horario del próximo laborable, sábado y domingo desde hoy (festivos aparte: ese día manda el del CRTM). */
export function weekTimetables(stopCodes: string[], now: Date) {
  const today = madridClock(now).localDate;
  return DAY_TYPES.map(({ label, matches }) => {
    let date = today;
    while (!matches(weekdayOf(date))) date = addDaysToDate(date, 1);
    return { label, date, departures: dayTimetable(stopCodes, date) };
  });
}

/** Fecha en que se sacaron los horarios del GTFS del CRTM. */
export const SCHEDULES_GENERATED_ON = (schedules as { generatedOn: string }).generatedOn;

interface CrtmTime {
  line?: { shortDescription?: unknown };
  destination?: unknown;
  destinationStop?: { name?: unknown };
  time?: unknown;
}

/** El CRTM manda un objeto en vez de una lista cuando solo hay un paso. */
export function parseStopTimes(raw: unknown): Departure[] {
  const time = (raw as { stopTimes?: { times?: { Time?: CrtmTime | CrtmTime[] } } } | null)?.stopTimes?.times?.Time;
  const list = time === undefined ? [] : Array.isArray(time) ? time : [time];
  return list.flatMap((item): Departure[] => {
    const at = new Date(String(item.time));
    const line = item.line?.shortDescription;
    if (typeof line !== "string" || Number.isNaN(at.getTime())) return [];
    // «destination» es el recorrido entero; la última parada dice mejor hacia dónde va.
    const destination = String(item.destinationStop?.name ?? item.destination ?? "").trim();
    return [{ line, destination, at, isScheduled: false }];
  });
}

const cache = new Map<string, { fetchedAt: number; departures: Departure[] }>();

export async function fetchRealtimeDepartures(stopCode: string, now: Date): Promise<Departure[]> {
  const cached = cache.get(stopCode);
  if (cached && now.getTime() - cached.fetchedAt < CACHE_MS) return cached.departures;
  const params = new URLSearchParams({ codStop: `8_${stopCode}`, type: "1", orderBy: "2", stopTimesByIti: "3" });
  const response = await fetch(`${STOP_TIMES_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`El CRTM respondió ${response.status} al pedir la parada ${stopCode}`);
  const departures = parseStopTimes(await response.json());
  cache.set(stopCode, { fetchedAt: now.getTime(), departures });
  return departures;
}

/**
 * Tiempo real si lo hay; si no (el N907 de día, o el servicio caído), el horario. Así siempre hay una respuesta útil
 * y queda claro de dónde sale cada hora.
 */
export async function interurbanDepartures(
  stopCodes: string[],
  line: string | null,
  now: Date,
): Promise<Departure[]> {
  // En la cabecera el bus sale a su hora: el horario es exacto y no hace falta preguntar al CRTM.
  if (stopCodes.every(isLineOrigin)) {
    return stopCodes.flatMap((code) => scheduledDepartures(code, line, now))
      .sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, DEPARTURES_SHOWN);
  }
  let realtime: Departure[] = [];
  try {
    realtime = (await Promise.all(stopCodes.map((code) => fetchRealtimeDepartures(code, now)))).flat()
      .filter(isWanted(line));
  } catch (error) {
    console.error("CRTM: no hay tiempo real, se usa el horario:", error);
  }
  const departures = realtime.length > 0 ? realtime : stopCodes.flatMap((code) => scheduledDepartures(code, line, now));
  return departures.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, DEPARTURES_SHOWN);
}

function describeDeparture(departure: Departure, now: Date): string {
  const time = madridClock(departure.at).localDateTime.slice(11, 16);
  const minutes = Math.round((departure.at.getTime() - now.getTime()) / 60_000);
  const wait = minutes < 1 ? "llegando" : minutes < 60 ? `en ${minutes} min` : null;
  const day = madridClock(departure.at).localDate === madridClock(now).localDate ? "" : " de mañana";
  return `${time}${day}${wait ? ` (${wait})` : ""}${departure.isScheduled ? ", horario" : ""}`;
}

export function formatInterurbanDepartures(label: string, departures: Departure[], line: string | null, now: Date) {
  if (departures.length === 0) {
    return `🚌 ${label}: no encuentro próximos pasos ${line ? `del ${line}` : "de interurbanos"}.\nDatos: CRTM`;
  }
  const lines = departures.map((departure) =>
    `• ${departure.line}${departure.destination ? ` → ${departure.destination}` : ""}: ${
      describeDeparture(departure, now)
    }`
  );
  return [`🚌 ${label}:`, ...lines, "Datos: CRTM"].join("\n");
}

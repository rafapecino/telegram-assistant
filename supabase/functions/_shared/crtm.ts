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
  trips: { line: string; service: string; headsign: string; times: Record<string, string> }[];
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

function runsOn(serviceId: string, date: string): boolean {
  const service = SCHEDULES.services[serviceId];
  if (!service || service.removed.includes(date)) return false;
  if (service.added.includes(date)) return true;
  // weekdayOf: 0 = domingo; en el GTFS el primer día es el lunes.
  return date >= service.start && date <= service.end && service.days[(weekdayOf(date) + 6) % 7] === 1;
}

/** Las próximas salidas programadas desde la parada. Los nocturnos de las 00:30 cuentan como «24:30» del día anterior. */
export function scheduledDepartures(stopCode: string, line: string | null, now: Date): Departure[] {
  const today = madridClock(now).localDate;
  const departures: Departure[] = [];
  for (const serviceDate of [addDaysToDate(today, -1), today, addDaysToDate(today, 1)]) {
    for (const trip of SCHEDULES.trips) {
      const time = trip.times[stopCode];
      if (!time || (line && trip.line !== line) || !runsOn(trip.service, serviceDate)) continue;
      const [hours, minutes] = time.split(":").map(Number);
      const date = addDaysToDate(serviceDate, Math.floor(hours / 24));
      const at = madridLocalToUtc(`${date}T${String(hours % 24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
      if (at > now) departures.push({ line: trip.line, destination: trip.headsign, at, isScheduled: true });
    }
  }
  return departures.sort((a, b) => a.at.getTime() - b.at.getTime());
}

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
  let realtime: Departure[] = [];
  try {
    realtime = (await Promise.all(stopCodes.map((code) => fetchRealtimeDepartures(code, now)))).flat()
      .filter((departure) => !line || departure.line === line);
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
  return `${time}${day}${wait ? ` (${wait})` : ""}${departure.isScheduled ? ", según horario" : ""}`;
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

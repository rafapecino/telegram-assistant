// Autobuses de la EMT de Madrid (MobilityLabs): cuánto le queda al bus en una parada, guardada o por número.
// Los interurbanos del CRTM (627, N907…) comparten intención y paradas guardadas; su consulta está en crtm.ts.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  findScheduledStop,
  formatInterurbanDepartures,
  formatLastOfDay,
  interurbanDepartures,
  scheduledStopName,
} from "./crtm.ts";
import { requireEnv } from "./env.ts";
import { madridClock } from "./madrid-time.ts";
import { matchByName, tidyName } from "./text.ts";

const LOGIN_URL = "https://openapi.emtmadrid.es/v1/mobilitylabs/user/login/";
const ARRIVALS_URL = "https://openapi.emtmadrid.es/v2/transport/busemtmad/stops";
// La EMT usa 999999 cuando el bus tarda más de 45 minutos (90 en los nocturnos).
const FAR_AWAY_SECONDS = 999999;
const STOP_NUMBER = /^\d{1,5}$/;
const LINE = /^[A-Za-z0-9]{1,4}$/;

/** Formato que el modelo debe devolver cuando el mensaje habla de autobuses (ver message-intent.ts). */
export const BUS_INTENT_FORMAT =
  'Autobuses de Madrid, de la EMT o interurbanos: {"intent": "bus", "action": "arrivals", "stop": "<nombre guardado, ' +
  'número o nombre de la parada>", "line": "<línea>" o null, "network": "emt", "interurbano" o null} para saber ' +
  'cuándo pasa ("¿cuándo pasa el bus de casa?", "¿cuánto le queda al 27 en la parada 1234?", "¿cuándo pasa el 627 ' +
  'por la parada 10590?"; stop es null si no dice parada); {"intent": "bus", "action": "save", "name": "<nombre>", "stop_id": "<número>", "network": ' +
  '"emt" o "interurbano"} para guardar una parada ("la parada de casa es la 1234"); {"intent": "bus", "action": ' +
  '"delete", "name": "<nombre>"} para olvidarla; {"intent": "bus", "action": "list"} para ver las guardadas. ' +
  'network es "interurbano" si habla de un interurbano del CRTM (líneas verdes que salen de Madrid, como 627 o el ' +
  'nocturno N907), "emt" si es un bus urbano de Madrid y null si no se sabe. Si habla de ir a Villanueva de la ' +
  "Cañada, Brunete o «a casa» en autobús, o de volver a Moncloa o a Madrid, es interurbano aunque no diga la línea. " +
  "Si dice adónde va en vez de la parada, stop es la del otro extremo: «para Villanueva» o «para Brunete» → " +
  '"Moncloa"; «para Moncloa» o «para Madrid» → "Villanueva". En arrivals, "which" es "last" si pregunta por el ' +
  'último de hoy y "next" en los demás casos.';

export type BusNetwork = "emt" | "interurbano";

export type BusRequest =
  | { kind: "bus_arrivals"; stop: string; line: string | null; network: BusNetwork | null; isLastOfDay?: boolean }
  | { kind: "bus_stop_save"; name: string; stopId: string; network: BusNetwork }
  | { kind: "bus_stop_delete"; name: string }
  | { kind: "bus_stop_list" }
  | { kind: "invalid"; message: string };

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function parseBusRequest(raw: unknown): BusRequest {
  const candidate = raw as Record<string, unknown> | null;
  const name = tidyName(cleanText(candidate?.name, 50));
  const network: BusNetwork | null = candidate?.network === "emt" || candidate?.network === "interurbano"
    ? candidate.network
    : null;
  switch (candidate?.action) {
    case "arrivals": {
      const stop = cleanText(candidate.stop, 50);
      const line = cleanText(candidate.line, 4).toUpperCase();
      // «¿Cuándo pasa el 627?» sin parada: se enseñan las paradas interurbanas guardadas.
      if (!stop && network !== "interurbano") {
        return { kind: "invalid", message: "¿De qué parada? Dime su número o el nombre que le diste." };
      }
      // El último del día sale del horario, que solo tienen los interurbanos.
      const isLastOfDay = candidate.which === "last" && network === "interurbano";
      return {
        kind: "bus_arrivals",
        stop,
        line: LINE.test(line) ? line : null,
        network,
        ...(isLastOfDay ? { isLastOfDay } : {}),
      };
    }
    case "save": {
      const stopId = cleanText(String(candidate.stop_id ?? ""), 5);
      if (!name || !STOP_NUMBER.test(stopId)) {
        const message = "Dime el nombre y el número de la parada, por ejemplo «la de casa es la 1234».";
        return { kind: "invalid", message };
      }
      return { kind: "bus_stop_save", name, stopId, network: network ?? "emt" };
    }
    case "delete":
      return name ? { kind: "bus_stop_delete", name } : { kind: "invalid", message: "¿Qué parada quieres que olvide?" };
    case "list":
      return { kind: "bus_stop_list" };
    default:
      return { kind: "invalid", message: "No he entendido qué quieres saber del autobús." };
  }
}

export interface BusStop {
  id: number;
  name: string;
  stop_id: string;
  network: BusNetwork;
}

export async function listBusStops(db: SupabaseClient): Promise<BusStop[]> {
  const { data, error } = await db.from("bus_stops").select("id,name,stop_id,network").order("name");
  if (error) throw new Error(`No se pudieron leer tus paradas: ${error.message}`);
  return data ?? [];
}

/** Si ya había una parada con ese nombre, se cambia su número. */
export async function saveBusStop(
  db: SupabaseClient,
  name: string,
  stopId: string,
  network: BusNetwork = "emt",
): Promise<void> {
  const { error } = await db.from("bus_stops").upsert({ name, stop_id: stopId, network }, { onConflict: "name" });
  if (error) throw new Error(`No se pudo guardar la parada: ${error.message}`);
}

export async function deleteBusStop(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("bus_stops").delete().eq("id", id);
  if (error) throw new Error(`No se pudo borrar la parada: ${error.message}`);
}

/** Una parada interurbana guardada puede juntar varios códigos («06002,2419»: en Moncloa cada línea sale de una). */
function savedStop(saved: BusStop): ResolvedStop {
  const stopIds = saved.stop_id.split(",");
  return { stopIds, label: `${saved.name} (${stopIds.join(" y ")})`, network: saved.network };
}

interface ResolvedStop {
  // Varias solo en interurbanos buscados por nombre: la marquesina de cada sentido tiene su código.
  stopIds: string[];
  label: string;
  network: BusNetwork;
}

/**
 * El número de parada y su red, con el nombre guardado si lo tiene. Una parada guardada manda sobre lo que haya
 * entendido el modelo. Los interurbanos también se buscan por el nombre de la marquesina («Universidad»).
 * Null si no se encuentra.
 */
export function resolveStop(stops: BusStop[], stop: string, network: BusNetwork | null = null): ResolvedStop | null {
  if (STOP_NUMBER.test(stop)) {
    const saved = stops.find((candidate) => candidate.stop_id === stop && (!network || candidate.network === network));
    if (saved) return savedStop(saved);
    const scheduledName = network === "interurbano" ? scheduledStopName(stop) : null;
    return {
      stopIds: [stop],
      label: scheduledName ? `${scheduledName} (${stop})` : `Parada ${stop}`,
      network: network ?? "emt",
    };
  }
  const name = stop.replace(/^(la )?parada (de |del )?/i, "");
  const saved = matchByName(stops, name);
  if (saved) return savedStop(saved);
  const scheduled = network === "interurbano" ? findScheduledStop(name) : null;
  return scheduled
    ? { stopIds: scheduled.codes, label: `${scheduled.name} (${scheduled.codes.join(" y ")})`, network: "interurbano" }
    : null;
}

interface EmtResponse {
  code?: string;
  description?: string;
  data?: unknown[];
}

async function callEmt(url: string, init: RequestInit): Promise<EmtResponse> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`La EMT respondió ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Cada consulta abre sesión: son dos llamadas, muy por debajo del límite diario, y no hay que guardar el token. */
async function login(): Promise<string> {
  const result = await callEmt(LOGIN_URL, {
    headers: { email: requireEnv("EMT_EMAIL"), password: requireEnv("EMT_PASSWORD") },
  });
  const token = (result.data?.[0] as { accessToken?: unknown } | undefined)?.accessToken;
  if (typeof token !== "string") {
    throw new Error(`La EMT no ha dejado iniciar sesión: ${result.description ?? "revisa EMT_EMAIL y EMT_PASSWORD"}.`);
  }
  return token;
}

export interface BusArrival {
  line: string;
  destination: string;
  seconds: number;
}

export async function fetchArrivals(stopId: string, now: Date): Promise<BusArrival[]> {
  const accessToken = await login();
  const result = await callEmt(`${ARRIVALS_URL}/${stopId}/arrives/`, {
    method: "POST",
    headers: { accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      cultureInfo: "ES",
      Text_StopRequired_YN: "N",
      Text_EstimationsRequired_YN: "Y",
      Text_IncidencesRequired_YN: "N",
      DateTime_Referenced_Incidencies_YYYYMMDD: madridClock(now).localDate.replaceAll("-", ""),
    }),
  });
  if (result.code !== "00") {
    throw new Error(`La EMT no ha dado las llegadas: ${result.description ?? result.code}.`);
  }
  const stopData = result.data?.[0] as { Arrive?: Record<string, unknown>[] } | undefined;
  const arrivals = stopData?.Arrive ?? [];
  return arrivals.map((arrival) => ({
    line: String(arrival.line ?? "?"),
    destination: String(arrival.destination ?? "").trim(),
    seconds: Number(arrival.estimateArrive),
  }));
}

function describeWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds >= FAR_AWAY_SECONDS) return "más de 45 min";
  if (seconds < 60) return "llegando";
  return `${Math.round(seconds / 60)} min`;
}

/** Una línea por bus y destino, con sus esperas en orden: «• 27 → Plaza Castilla: 3 min, 12 min». */
export function formatArrivals(label: string, arrivals: BusArrival[], line: string | null): string {
  const wanted = line ? arrivals.filter((arrival) => arrival.line.toUpperCase() === line) : arrivals;
  if (wanted.length === 0) {
    return `🚌 ${label}: ahora no hay ${line ? `llegadas previstas del ${line}` : "buses previstos"}.`;
  }
  const groups = new Map<string, number[]>();
  for (const arrival of [...wanted].sort((a, b) => a.seconds - b.seconds)) {
    const key = arrival.destination ? `${arrival.line} → ${arrival.destination}` : arrival.line;
    groups.set(key, [...(groups.get(key) ?? []), arrival.seconds]);
  }
  const lines = [...groups].map(([key, waits]) => `• ${key}: ${waits.map(describeWait).join(", ")}`);
  return [`🚌 ${label}:`, ...lines].join("\n");
}

export function formatBusStops(stops: BusStop[]): string {
  if (stops.length === 0) return "No tienes paradas guardadas. Dime, por ejemplo, «la parada de casa es la 1234».";
  return [
    "Tus paradas:",
    ...stops.map((stop) => `• ${stop.name}: ${stop.stop_id}${stop.network === "interurbano" ? " (interurbano)" : ""}`),
  ].join("\n");
}

async function replyToArrivals(
  db: SupabaseClient,
  request: Extract<BusRequest, { kind: "bus_arrivals" }>,
  now: Date,
): Promise<string> {
  const { stop, line } = request;
  if (!stop) return await replyToSavedInterurbanStops(db, line, now);
  const resolved = resolveStop(await listBusStops(db), stop, request.network);
  if (!resolved && request.network === "interurbano") {
    return `No encuentro una sola parada «${stop}» en el 627 ni en el N907. Dime su número (5 cifras, en la ` +
      `marquesina) o guárdala: «la del trabajo es la 10590 del interurbano».`;
  }
  if (!resolved) {
    return `No tengo guardada la parada «${stop}». Dime su número o guárdala: «la de ${stop} es la 1234».`;
  }
  if (resolved.network === "interurbano" && request.isLastOfDay) {
    return formatLastOfDay(resolved.label, resolved.stopIds, line, now);
  }
  if (resolved.network === "interurbano") {
    return formatInterurbanDepartures(
      resolved.label,
      await interurbanDepartures(resolved.stopIds, line, now),
      line,
      now,
    );
  }
  return formatArrivals(resolved.label, await fetchArrivals(resolved.stopIds[0], now), line);
}

async function replyToSavedInterurbanStops(db: SupabaseClient, line: string | null, now: Date): Promise<string> {
  const saved = (await listBusStops(db)).filter((stop) => stop.network === "interurbano");
  if (saved.length === 0) return "¿De qué parada? Dime su número (5 cifras, en la marquesina) o guárdala.";
  const replies = [];
  for (const stop of saved.map(savedStop)) {
    replies.push(
      formatInterurbanDepartures(stop.label, await interurbanDepartures(stop.stopIds, line, now), line, now),
    );
  }
  // Una sola atribución al final, no una por parada.
  return replies.map((reply) => reply.replace(/\nDatos: CRTM$/, "")).join("\n\n") + "\nDatos: CRTM";
}

/** La sección Transporte del panel: próximos pasos de cada parada interurbana guardada. */
export async function loadTransit(db: SupabaseClient, now: Date) {
  const saved = (await listBusStops(db)).filter((stop) => stop.network === "interurbano");
  const stops = await Promise.all(saved.map(async (stop) => {
    const { stopIds, label } = savedStop(stop);
    return {
      name: stop.name,
      label,
      departures: await interurbanDepartures(stopIds, null, now),
    };
  }));
  return { stops };
}

export async function replyToBus(db: SupabaseClient, request: BusRequest, now: Date): Promise<string> {
  switch (request.kind) {
    case "bus_arrivals":
      return replyToArrivals(db, request, now);
    case "bus_stop_save":
      await saveBusStop(db, request.name, request.stopId, request.network);
      return `Guardada: la parada «${request.name}» es la ${request.stopId}. Pregúntame «¿cuándo pasa el bus de ` +
        `${request.name.toLowerCase()}?».`;
    case "bus_stop_delete": {
      const stop = matchByName(await listBusStops(db), request.name);
      if (!stop) return `No tengo ninguna parada «${request.name}».`;
      await deleteBusStop(db, stop.id);
      return `He olvidado la parada «${stop.name}».`;
    }
    case "bus_stop_list":
      return formatBusStops(await listBusStops(db));
    case "invalid":
      return request.message;
  }
}

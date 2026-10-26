// Autobuses de la EMT de Madrid (MobilityLabs): cuánto le queda al bus en una parada, guardada o por número.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
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
  'Autobuses EMT de Madrid: {"intent": "bus", "action": "arrivals", "stop": "<nombre guardado o número de parada>", ' +
  '"line": "<línea>" o null} para saber cuándo pasa ("¿cuándo pasa el bus de casa?", "¿cuánto le queda al 27 en la ' +
  'parada 1234?"); {"intent": "bus", "action": "save", "name": "<nombre>", "stop_id": "<número>"} para guardar una ' +
  'parada ("la parada de casa es la 1234"); {"intent": "bus", "action": "delete", "name": "<nombre>"} para ' +
  'olvidarla; {"intent": "bus", "action": "list"} para ver las guardadas.';

export type BusRequest =
  | { kind: "bus_arrivals"; stop: string; line: string | null }
  | { kind: "bus_stop_save"; name: string; stopId: string }
  | { kind: "bus_stop_delete"; name: string }
  | { kind: "bus_stop_list" }
  | { kind: "invalid"; message: string };

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function parseBusRequest(raw: unknown): BusRequest {
  const candidate = raw as Record<string, unknown> | null;
  const name = tidyName(cleanText(candidate?.name, 50));
  switch (candidate?.action) {
    case "arrivals": {
      const stop = cleanText(candidate.stop, 50);
      const line = cleanText(candidate.line, 4).toUpperCase();
      if (!stop) return { kind: "invalid", message: "¿De qué parada? Dime su número o el nombre que le diste." };
      return { kind: "bus_arrivals", stop, line: LINE.test(line) ? line : null };
    }
    case "save": {
      const stopId = cleanText(String(candidate.stop_id ?? ""), 5);
      if (!name || !STOP_NUMBER.test(stopId)) {
        const message = "Dime el nombre y el número de la parada, por ejemplo «la de casa es la 1234».";
        return { kind: "invalid", message };
      }
      return { kind: "bus_stop_save", name, stopId };
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
}

export async function listBusStops(db: SupabaseClient): Promise<BusStop[]> {
  const { data, error } = await db.from("bus_stops").select("id,name,stop_id").order("name");
  if (error) throw new Error(`No se pudieron leer tus paradas: ${error.message}`);
  return data ?? [];
}

/** Si ya había una parada con ese nombre, se cambia su número. */
export async function saveBusStop(db: SupabaseClient, name: string, stopId: string): Promise<void> {
  const { error } = await db.from("bus_stops").upsert({ name, stop_id: stopId }, { onConflict: "name" });
  if (error) throw new Error(`No se pudo guardar la parada: ${error.message}`);
}

export async function deleteBusStop(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("bus_stops").delete().eq("id", id);
  if (error) throw new Error(`No se pudo borrar la parada: ${error.message}`);
}

/** El número de parada, con el nombre guardado si lo tiene. Null si no es un número ni una parada guardada. */
export function resolveStop(stops: BusStop[], stop: string): { stopId: string; label: string } | null {
  if (STOP_NUMBER.test(stop)) {
    const saved = stops.find((candidate) => candidate.stop_id === stop);
    return { stopId: stop, label: saved ? `${saved.name} (${stop})` : `Parada ${stop}` };
  }
  const saved = matchByName(stops, stop.replace(/^(la )?parada (de |del )?/i, ""));
  return saved ? { stopId: saved.stop_id, label: `${saved.name} (${saved.stop_id})` } : null;
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
  return ["Tus paradas:", ...stops.map((stop) => `• ${stop.name}: ${stop.stop_id}`)].join("\n");
}

async function replyToArrivals(db: SupabaseClient, stop: string, line: string | null, now: Date): Promise<string> {
  const resolved = resolveStop(await listBusStops(db), stop);
  if (!resolved) {
    return `No tengo guardada la parada «${stop}». Dime su número o guárdala: «la de ${stop} es la 1234».`;
  }
  return formatArrivals(resolved.label, await fetchArrivals(resolved.stopId, now), line);
}

export async function replyToBus(db: SupabaseClient, request: BusRequest, now: Date): Promise<string> {
  switch (request.kind) {
    case "bus_arrivals":
      return replyToArrivals(db, request.stop, request.line, now);
    case "bus_stop_save":
      await saveBusStop(db, request.name, request.stopId);
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

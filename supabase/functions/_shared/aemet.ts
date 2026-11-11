// Avisos meteorológicos oficiales de AEMET para la Comunidad de Madrid. La previsión sigue siendo de Open-Meteo.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import { requireEnv } from "./env.ts";
import { addDaysToDate, formatMadridDateTime, madridClock, madridLocalToUtc } from "./madrid-time.ts";
import { sendTelegramMessage } from "./telegram.ts";

// Área 72: Comunidad de Madrid. Incluye sus tres zonas (Sierra, Metropolitana y Henares, Sur, Vegas y Oeste).
const WARNINGS_URL = "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/72";
// AEMET falla a ratos con 5xx, 429 (límite de peticiones) o cortando la conexión sin responder: se reintenta antes
// de rendirse.
export const RETRY_DELAYS_MS = [2_000, 5_000];
const TAR_BLOCK = 512;
const LEVEL_EMOJI: Record<string, string> = { amarillo: "🟡", naranja: "🟠", rojo: "🔴" };
// Solo las zonas por las que se mueve: Metropolitana y Henares (Madrid capital) y Sur, Vegas y Oeste (Villanueva de
// la Cañada). Los de la Sierra no le afectan.
export const MY_ZONES = ["722802", "722803"];

export interface WeatherAlert {
  id: string;
  level: string;
  event: string;
  zone: string;
  onset: Date;
  expires: Date;
}

async function fetchWithRetry(url: string, init: RequestInit, retryDelaysMs: number[]): Promise<Response> {
  for (let attempt = 0;; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // fetch lanza TypeError cuando falla la red; cualquier otro error no es pasajero.
      if (!(error instanceof TypeError) || attempt >= retryDelaysMs.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      continue;
    }
    const isTransient = response.status >= 500 || response.status === 429;
    if (!isTransient || attempt >= retryDelaysMs.length) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
  }
}

/** Los ficheros de un .tar: cabeceras de 512 bytes con nombre y tamaño (en octal), y el contenido detrás. */
export function readTar(bytes: Uint8Array): { name: string; content: Uint8Array }[] {
  const files = [];
  const decoder = new TextDecoder();
  for (let offset = 0; offset + TAR_BLOCK <= bytes.length;) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK);
    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0.*$/s, "").trim() || "0", 8);
    offset += TAR_BLOCK;
    files.push({ name, content: bytes.subarray(offset, offset + size) });
    offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return files;
}

async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return bytes;
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Los XML que manda AEMET: normalmente un .tar con uno por aviso; si solo hay uno, a veces llega el XML suelto. */
export async function extractXmlDocuments(bytes: Uint8Array): Promise<string[]> {
  const raw = await gunzipIfNeeded(bytes);
  const decoder = new TextDecoder();
  if (decoder.decode(raw.subarray(0, 100)).trimStart().startsWith("<")) return [decoder.decode(raw)];
  return readTar(raw).filter((file) => file.name.endsWith(".xml")).map((file) => decoder.decode(file.content));
}

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });

interface CapInfo {
  language?: string;
  event?: string;
  onset?: string;
  expires?: string;
  parameter?: { valueName?: string; value?: string } | { valueName?: string; value?: string }[];
  area?: CapArea | CapArea[];
}

interface CapArea {
  areaDesc?: string;
  geocode?: { valueName?: string; value?: string } | { valueName?: string; value?: string }[];
}

/** Si el aviso toca alguna de sus zonas. Uno sin código de zona se enseña: mejor de más que perderse uno. */
function touchesMyZones(areas: CapArea[]): boolean {
  const codes = areas.flatMap((area) => asArray(area.geocode))
    .filter((geocode) => geocode.valueName === "AEMET-Meteoalerta zona").map((geocode) => String(geocode.value));
  return codes.length === 0 || codes.some((code) => MY_ZONES.includes(code));
}

/**
 * Un aviso en formato CAP, con la parte en español. Null si se cancela, es de nivel verde, no toca sus zonas o le
 * faltan datos.
 */
export function parseCapAlert(xml: string): WeatherAlert | null {
  const alert = xmlParser.parse(xml)?.alert;
  if (!alert || alert.msgType === "Cancel") return null;
  const info = asArray<CapInfo>(alert.info).find((candidate) => String(candidate.language).startsWith("es"));
  const level = asArray(info?.parameter).find((parameter) => parameter.valueName === "AEMET-Meteoalerta nivel")?.value;
  const onset = new Date(info?.onset ?? "");
  const expires = new Date(info?.expires ?? "");
  if (!info || !level || !LEVEL_EMOJI[level] || Number.isNaN(onset.getTime()) || Number.isNaN(expires.getTime())) {
    return null;
  }
  if (!touchesMyZones(asArray(info.area))) return null;
  return {
    id: String(alert.identifier),
    level,
    event: String(info.event ?? "Aviso meteorológico"),
    zone: asArray(info.area).map((area) => area.areaDesc).filter(Boolean).join(", ") || "Comunidad de Madrid",
    onset,
    expires,
  };
}

/** Los avisos que tiene publicados AEMET ahora en sus zonas de la Comunidad de Madrid. */
export async function fetchWeatherAlerts(retryDelaysMs = RETRY_DELAYS_MS): Promise<WeatherAlert[]> {
  const headers = { api_key: requireEnv("AEMET_API_KEY") };
  const response = await fetchWithRetry(WARNINGS_URL, { headers }, retryDelaysMs);
  const result = await response.json().catch(() => ({})) as { estado?: number; datos?: string; descripcion?: string };
  // Sin avisos, AEMET contesta 404 "No hay datos que satisfagan esos criterios".
  if (result.estado === 404) return [];
  if (!response.ok || result.estado !== 200 || !result.datos) {
    throw new Error(`AEMET respondió ${result.estado ?? response.status}: ${result.descripcion ?? "sin datos"}.`);
  }
  const data = await fetchWithRetry(result.datos, {}, retryDelaysMs);
  if (!data.ok) throw new Error(`AEMET no ha dado el fichero de avisos (${data.status}).`);
  const documents = await extractXmlDocuments(new Uint8Array(await data.arrayBuffer()));
  return documents.map(parseCapAlert).filter((alert): alert is WeatherAlert => alert !== null);
}

export function describeAlert(alert: WeatherAlert): string {
  return `${LEVEL_EMOJI[alert.level]} ${alert.event} · ${alert.zone} · de ${formatMadridDateTime(alert.onset)} a ${
    formatMadridDateTime(alert.expires)
  }`;
}

/**
 * AEMET publica un aviso por zona y otro cada vez que lo actualiza: se juntan los del mismo fenómeno, nivel y zona,
 * desde el primero que empieza hasta el último que acaba.
 */
export function mergeAlerts(alerts: WeatherAlert[]): WeatherAlert[] {
  const merged = new Map<string, WeatherAlert>();
  for (const alert of [...alerts].sort((a, b) => a.onset.getTime() - b.onset.getTime())) {
    const key = `${alert.level}|${alert.event}|${alert.zone}`;
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, expires: new Date(Math.max(+previous.expires, +alert.expires)) } : alert);
  }
  return [...merged.values()];
}

/** Para el resumen de la mañana: los que tocan algún momento de hoy y aún no han terminado. */
export function morningAlertLines(alerts: WeatherAlert[], now: Date): string[] {
  const tomorrow = madridLocalToUtc(`${addDaysToDate(madridClock(now).localDate, 1)}T00:00`);
  const today = alerts.filter((alert) => alert.onset < tomorrow && alert.expires > now);
  if (today.length === 0) return [];
  return ["⚠️ Avisos de AEMET para hoy:", ...mergeAlerts(today).map(describeAlert)];
}

// Para saber si un aviso es más grave que lo ya avisado hoy.
const LEVEL_RANK: Record<string, number> = { amarillo: 1, naranja: 2, rojo: 3 };

/**
 * Un mensaje al día con todos los avisos vigentes de sus zonas, la primera hora que los haya. Ese mismo día solo
 * vuelve a avisar si sube a naranja o rojo por encima de lo ya avisado; las actualizaciones del mismo nivel esperan al
 * día siguiente o al resumen de la mañana. El límite se cuenta desde la medianoche de Madrid.
 * Devuelve cuántos avisos de AEMET ha resumido en el mensaje (0 si no ha mandado nada).
 */
export async function notifyNewWeatherAlerts(db: SupabaseClient, now: Date): Promise<number> {
  const current = (await fetchWeatherAlerts()).filter((alert) => alert.expires > now);
  if (current.length === 0) return 0;
  const startOfToday = madridLocalToUtc(`${madridClock(now).localDate}T00:00`);
  const { data, error } = await db.from("weather_alerts_sent").select("level")
    .gte("sent_at", startOfToday.toISOString());
  if (error) throw new Error(`No se pudo comprobar qué se ha avisado hoy: ${error.message}`);
  const sentToday = (data ?? []) as { level: string | null }[];
  const notifiedRank = Math.max(0, ...sentToday.map((row) => LEVEL_RANK[row.level ?? ""] ?? 1));
  const toSend = sentToday.length === 0
    ? current
    : current.filter((alert) => LEVEL_RANK[alert.level] >= 2 && LEVEL_RANK[alert.level] > notifiedRank);
  if (toSend.length === 0) return 0;
  const title = sentToday.length === 0 ? "⚠️ Avisos de AEMET en Madrid y Villanueva:" : "⚠️ Sube el aviso de AEMET:";
  await sendTelegramMessage([title, ...mergeAlerts(toSend).map(describeAlert)].join("\n"));
  const { error: insertError } = await db.from("weather_alerts_sent").upsert(
    toSend.map((alert) => ({ id: alert.id, level: alert.level, sent_at: now.toISOString() })),
    { onConflict: "id" },
  );
  if (insertError) throw new Error(`No se pudieron apuntar los avisos enviados: ${insertError.message}`);
  return toSend.length;
}

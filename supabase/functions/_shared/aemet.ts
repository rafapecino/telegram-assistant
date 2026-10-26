// Avisos meteorológicos oficiales de AEMET para la Comunidad de Madrid. La previsión sigue siendo de Open-Meteo.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import { requireEnv } from "./env.ts";
import { addDaysToDate, formatMadridDateTime, madridClock, madridLocalToUtc } from "./madrid-time.ts";
import { sendTelegramMessage } from "./telegram.ts";

// Área 72: Comunidad de Madrid. Incluye sus tres zonas (Sierra, Metropolitana y Henares, Sur, Vegas y Oeste).
const WARNINGS_URL = "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/72";
// AEMET falla a ratos con 5xx o 429 (límite de peticiones): se reintenta antes de rendirse.
export const RETRY_DELAYS_MS = [2_000, 5_000];
const TAR_BLOCK = 512;
const LEVEL_EMOJI: Record<string, string> = { amarillo: "🟡", naranja: "🟠", rojo: "🔴" };

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
    const response = await fetch(url, init);
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
  area?: { areaDesc?: string } | { areaDesc?: string }[];
}

/** Un aviso en formato CAP, con la parte en español. Null si se cancela, es de nivel verde o le faltan datos. */
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
  return {
    id: String(alert.identifier),
    level,
    event: String(info.event ?? "Aviso meteorológico"),
    zone: asArray(info.area).map((area) => area.areaDesc).filter(Boolean).join(", ") || "Comunidad de Madrid",
    onset,
    expires,
  };
}

/** Los avisos que tiene publicados AEMET ahora para la Comunidad de Madrid. */
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

/** Para el resumen de la mañana: los que tocan algún momento de hoy y aún no han terminado. */
export function morningAlertLines(alerts: WeatherAlert[], now: Date): string[] {
  const tomorrow = madridLocalToUtc(`${addDaysToDate(madridClock(now).localDate, 1)}T00:00`);
  const today = alerts.filter((alert) => alert.onset < tomorrow && alert.expires > now);
  if (today.length === 0) return [];
  return ["⚠️ Avisos de AEMET para hoy:", ...today.map(describeAlert)];
}

/** Manda por Telegram los avisos vigentes que aún no se han enviado. Devuelve cuántos ha mandado. */
export async function notifyNewWeatherAlerts(db: SupabaseClient, now: Date): Promise<number> {
  const current = (await fetchWeatherAlerts()).filter((alert) => alert.expires > now);
  if (current.length === 0) return 0;
  const { data, error } = await db.from("weather_alerts_sent").select("id").in("id", current.map((alert) => alert.id));
  if (error) throw new Error(`No se pudieron leer los avisos ya enviados: ${error.message}`);
  const sent = new Set((data ?? []).map((row) => row.id));
  const fresh = current.filter((alert) => !sent.has(alert.id));
  if (fresh.length === 0) return 0;
  const title = fresh.length === 1 ? "⚠️ Nuevo aviso de AEMET:" : "⚠️ Nuevos avisos de AEMET:";
  await sendTelegramMessage([title, ...fresh.map(describeAlert)].join("\n"));
  const { error: insertError } = await db.from("weather_alerts_sent").insert(fresh.map((alert) => ({ id: alert.id })));
  if (insertError) throw new Error(`No se pudieron apuntar los avisos enviados: ${insertError.message}`);
  return fresh.length;
}

// Defensas de panel-api que no dependen de cada recurso: orígenes permitidos, límite de peticiones, accesos denegados
// y qué parte de un error ve el navegador.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { UserFacingError } from "./errors.ts";
import { sendTelegramMessage } from "./telegram.ts";

const PRODUCTION_ORIGIN = "https://telegram-assistant-preview.vercel.app";
// Las previsualizaciones de Vercel de cada rama, para poder probar un cambio antes de publicarlo.
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/telegram-assistant-preview-[a-z0-9-]+-rafapecinos-projects\.vercel\.app$/;
// `vite` y `vite preview` en local.
const LOCAL_ORIGINS = new Set(["http://localhost:5173", "http://localhost:4173"]);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return origin === PRODUCTION_ORIGIN || LOCAL_ORIGINS.has(origin) || VERCEL_PREVIEW_ORIGIN.test(origin);
}

/**
 * Cabeceras CORS. La autorización la da el JWT, no CORS; limitar el origen evita que otra web use el panel con una
 * sesión que haya conseguido.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!isAllowedOrigin(origin)) return headers;
  return {
    ...headers,
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
}

// Abrir el panel o guardar algo recarga todo: unas 16 peticiones de golpe. 300 deja margen para usarlo con prisa.
const GENERAL_LIMIT_PER_MINUTE = 300;
// Chat, notas de voz y la frase del saludo gastan cuota de Groq.
const GROQ_LIMIT_PER_MINUTE = 10;

export function usesGroq(method: string, resource: string): boolean {
  return (method === "POST" && (resource === "chat" || resource === "transcribe")) ||
    (method === "GET" && resource === "greeting");
}

/** Suma una petición a `bucket` en la ventana actual y devuelve cuántas lleva. */
async function countRequest(db: SupabaseClient, bucket: string, windowSeconds: number): Promise<number> {
  const { data, error } = await db.rpc("count_panel_request", { bucket_name: bucket, window_seconds: windowSeconds });
  if (error) throw new Error(`No se pudo contar la petición: ${error.message}`);
  return data as number;
}

export async function isOverRateLimit(
  db: SupabaseClient,
  userId: string,
  method: string,
  resource: string,
): Promise<boolean> {
  if (await countRequest(db, `user:${userId}`, 60) > GENERAL_LIMIT_PER_MINUTE) return true;
  if (!usesGroq(method, resource)) return false;
  return await countRequest(db, `groq:${userId}`, 60) > GROQ_LIMIT_PER_MINUTE;
}

const DENIED_ALERT_THRESHOLD = 5;
const DENIED_WINDOW_SECONDS = 600;

/**
 * Apunta un acceso denegado sin guardar el token. Al llegar a 5 en 10 minutos avisa por Telegram una sola vez por
 * ventana: lo normal es no tener ninguno, porque el panel solo lo usa una persona.
 */
export async function recordAccessDenied(db: SupabaseClient, reason: string): Promise<void> {
  console.warn(`Acceso denegado al panel: ${reason}`);
  const denied = await countRequest(db, "access_denied", DENIED_WINDOW_SECONDS);
  if (denied !== DENIED_ALERT_THRESHOLD) return;
  await sendTelegramMessage(
    `⚠️ El panel ha rechazado ${denied} accesos en menos de 10 minutos (el último: ${reason}). ` +
      "Si no has sido tú, cambia la contraseña del panel.",
  );
}

/** Lo que ve el navegador de un error: el mensaje solo si está pensado para el usuario. */
export function describeErrorForClient(error: unknown): { status: number; message: string } {
  if (error instanceof UserFacingError) return { status: 400, message: error.message };
  return { status: 500, message: "No se pudo completar la operación. Inténtalo de nuevo." };
}

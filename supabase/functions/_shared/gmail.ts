// Gmail, solo lectura: busca correos y enseña remitente, asunto y fecha. El contenido de los correos no se lee ni
// se manda a Groq; Groq solo traduce la pregunta a una búsqueda de Gmail.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { CalendarNotConnectedError, getAccessToken, parseJsonOrEmpty } from "./calendar.ts";
import { formatMadridDateTime } from "./madrid-time.ts";

const MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const MAX_LISTED_EMAILS = 10;
const MAX_QUERY_LENGTH = 200;
const DEFAULT_QUERY = "is:unread in:inbox";
// Promociones (salvo las que Gmail marca como importantes), Social y Foros. Lo de importante es por las respuestas
// de reclutadores, que Gmail a veces mete en Promociones.
const NOISE_CATEGORIES = ["(category:promotions -is:important)", "category:social", "category:forums"];
// Un correo que sería ruido se enseña igual si el asunto tiene alguna de estas palabras. Van con y sin tilde por si
// el remitente las escribe sin ella.
const IMPORTANT_SUBJECT_WORDS = [
  "factura", "recibo", "pedido", "envío", "envio", "entrega", "devolución", "devolucion", "reembolso", "pago",
  "cita", "entrevista", "candidatura", "contraseña", "contrasena", "código", "codigo", "verificación",
  "verificacion", "urgente", "importante", "invoice", "receipt", "order", "payment", "interview",
];
export const IMPORTANT_SUBJECT = `subject:(${IMPORTANT_SUBJECT_WORDS.join(" OR ")})`;
const SENDER_FILTER = /^[a-z0-9.+_@-]{3,100}$/;
/** Lo del resumen de la mañana: importantes sin leer que han llegado desde el día anterior. */
export const MORNING_QUERY = "is:unread is:important newer_than:1d";

/** Formato que el modelo debe devolver cuando el mensaje habla del correo (ver message-intent.ts). */
export const GMAIL_INTENT_FORMAT =
  'Correo de Gmail, si pregunta por sus correos o emails: {"intent": "gmail", "query": "<búsqueda>"} con la sintaxis ' +
  'de búsqueda de Gmail, por ejemplo "from:hacienda" ("¿tengo algo de Hacienda?"), "is:unread in:inbox" ' +
  '("¿tengo correos sin leer?"), "subject:factura newer_than:7d". Sin más detalles, "is:unread in:inbox". ' +
  'Para dejar de ver los correos de alguien ("no me enseñes los correos de Uber"): {"intent": "gmail", "action": ' +
  '"block", "sender": "<una palabra del remitente, su dominio o su dirección, en minúsculas y sin espacios>"}; para ' +
  'volver a verlos, "action": "unblock" con el mismo "sender"; para ver cuáles no le enseñas, "action": "filters".';

export type GmailRequest =
  | { kind: "gmail_search"; query: string }
  | { kind: "gmail_block"; sender: string }
  | { kind: "gmail_unblock"; sender: string }
  | { kind: "gmail_filters" }
  | { kind: "invalid"; message: string };

/** Lo que se filtra va tal cual a la búsqueda de Gmail: por eso solo letras, números y . + _ @ -. */
function parseSenderFilter(raw: unknown, kind: "gmail_block" | "gmail_unblock"): GmailRequest {
  const sender = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!SENDER_FILTER.test(sender)) {
    return { kind: "invalid", message: "Dime de quién: una palabra del remitente, su dominio o su dirección." };
  }
  return { kind, sender };
}

export function parseGmailRequest(raw: unknown): GmailRequest {
  const candidate = raw as { action?: unknown; sender?: unknown } | null;
  if (candidate?.action === "block") return parseSenderFilter(candidate.sender, "gmail_block");
  if (candidate?.action === "unblock") return parseSenderFilter(candidate.sender, "gmail_unblock");
  if (candidate?.action === "filters") return { kind: "gmail_filters" };
  const query = (raw as { query?: unknown } | null)?.query;
  if (query == null || query === "") return { kind: "gmail_search", query: DEFAULT_QUERY };
  if (typeof query !== "string" || query.trim().length > MAX_QUERY_LENGTH) {
    return { kind: "invalid", message: "No he entendido qué correos quieres buscar." };
  }
  return { kind: "gmail_search", query: query.trim() || DEFAULT_QUERY };
}

export interface EmailSummary {
  from: string;
  subject: string;
  date: Date | null;
}

/** El acceso de Google no incluye Gmail: pasa con las conexiones hechas antes de añadir el permiso. */
export class GmailPermissionError extends Error {
  constructor() {
    super("Me falta permiso para leer tu Gmail. Vuelve a conectar Google con /conectar_calendario y acepta Gmail.");
  }
}

function describeGmailError(status: number, details: Record<string, unknown>): Error {
  const text = JSON.stringify(details);
  if (status === 403 && /SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(text)) {
    return new GmailPermissionError();
  }
  if (status === 403 && /SERVICE_DISABLED|accessNotConfigured/.test(text)) {
    return new Error("La API de Gmail está desactivada. Actívala en Google Cloud (APIs y servicios → Gmail API).");
  }
  const message = (details.error as { message?: unknown } | undefined)?.message;
  return new Error(`Gmail respondió ${status}: ${typeof message === "string" ? message : "no se pudo leer."}`);
}

async function callGmail(accessToken: string, url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw describeGmailError(response.status, parseJsonOrEmpty(await response.text()));
  return response.json();
}

interface GmailHeader {
  name?: string;
  value?: string;
}

/** "Juan Pérez <juan@x.com>" → "Juan Pérez"; sin nombre, la dirección. */
export function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return name || from.replace(/[<>]/g, "").trim() || "(sin remitente)";
}

export function toEmailSummary(message: { payload?: { headers?: GmailHeader[] } }): EmailSummary {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  const date = new Date(header("Date"));
  return {
    from: senderName(header("From")),
    subject: header("Subject").trim() || "(sin asunto)",
    date: Number.isNaN(date.getTime()) ? null : date,
  };
}

/** Remitentes que no se enseñan (tabla email_filters). La tabla ya valida el formato, para no romper la búsqueda. */
export async function loadBlockedSenders(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("email_filters").select("sender").order("sender");
  if (error) throw new Error(`No se pudieron leer los filtros del correo: ${error.message}`);
  return (data ?? []).map((row) => row.sender);
}

/**
 * Quita el ruido (pestañas y remitentes filtrados) salvo que el asunto parezca importante. Si la búsqueda pide un
 * remitente concreto no quita nada: "¿me ha escrito Uber?" debe encontrarlo.
 */
export function withoutNoise(query: string, blockedSenders: string[]): string {
  if (/(^|\s|-)from:/i.test(query)) return query;
  const senders = blockedSenders.length > 0 ? [`from:(${blockedSenders.join(" OR ")})`] : [];
  return `${query} -({${[...NOISE_CATEGORIES, ...senders].join(" ")}} -${IMPORTANT_SUBJECT})`;
}

export async function blockSender(db: SupabaseClient, sender: string): Promise<void> {
  const { error } = await db.from("email_filters").upsert({ sender }, { onConflict: "sender", ignoreDuplicates: true });
  if (error) throw new Error(`No se pudo guardar el filtro del correo: ${error.message}`);
}

/** Quita los filtros que contienen lo que dice ("uber" quita también "uber@uber.com"). Devuelve los que quitó. */
export async function unblockSender(db: SupabaseClient, sender: string): Promise<string[]> {
  const { data, error } = await db.from("email_filters").delete().ilike("sender", `%${sender}%`).select("sender");
  if (error) throw new Error(`No se pudo quitar el filtro del correo: ${error.message}`);
  return (data ?? []).map((row) => row.sender);
}

export function formatFilters(senders: string[]): string {
  const tabs = "No te enseño Promociones (salvo las importantes), Social ni Foros";
  const list = senders.length > 0 ? `, ni los correos de: ${senders.join(", ")}` : "";
  return `${tabs}${list}. Si el asunto parece importante (factura, pedido, entrevista, código…), te lo enseño igual.`;
}

type SenderFilterRequest = Extract<GmailRequest, { kind: "gmail_block" | "gmail_unblock" | "gmail_filters" }>;

async function replyToSenderFilter(db: SupabaseClient, request: SenderFilterRequest): Promise<string> {
  switch (request.kind) {
    case "gmail_block":
      await blockSender(db, request.sender);
      return `Vale, ya no te enseño los correos de «${request.sender}», salvo si el asunto parece importante. ` +
        `Para volver a verlos, dime «vuelve a enseñarme los correos de ${request.sender}».`;
    case "gmail_unblock": {
      const removed = await unblockSender(db, request.sender);
      return removed.length > 0
        ? `Vuelvo a enseñarte los correos de: ${removed.join(", ")}.`
        : `No tenía filtrado nada con «${request.sender}».`;
    }
    case "gmail_filters":
      return formatFilters(await loadBlockedSenders(db));
  }
}

/** Los correos que encuentra la búsqueda, del más reciente al más antiguo, y cuántos hay en total (aproximado). */
export async function searchEmails(
  db: SupabaseClient,
  query: string,
): Promise<{ emails: EmailSummary[]; total: number }> {
  const accessToken = await getAccessToken(db);
  const q = withoutNoise(query, await loadBlockedSenders(db));
  const list = await callGmail(
    accessToken,
    `${MESSAGES_URL}?${new URLSearchParams({ q, maxResults: String(MAX_LISTED_EMAILS) })}`,
  );
  const ids = ((list.messages ?? []) as { id: string }[]).map((message) => message.id);
  const metadata = new URLSearchParams({ format: "metadata" });
  for (const name of ["From", "Subject", "Date"]) metadata.append("metadataHeaders", name);
  const messages = await Promise.all(ids.map((id) => callGmail(accessToken, `${MESSAGES_URL}/${id}?${metadata}`)));
  return { emails: messages.map(toEmailSummary), total: Number(list.resultSizeEstimate ?? ids.length) };
}

function describeEmail(email: EmailSummary): string {
  const date = email.date ? ` (${formatMadridDateTime(email.date)})` : "";
  return `• ${email.from}: ${email.subject}${date}`;
}

export function formatEmails(emails: EmailSummary[], total: number): string {
  if (emails.length === 0) return "No he encontrado ningún correo así.";
  const more = total > emails.length ? `\n…y unos ${total - emails.length} más.` : "";
  return [`📧 ${emails.length === 1 ? "1 correo" : `${emails.length} correos`}:`, ...emails.map(describeEmail)]
    .join("\n") + more;
}

export async function replyToGmail(db: SupabaseClient, request: GmailRequest): Promise<string> {
  if (request.kind === "invalid") return request.message;
  if (request.kind !== "gmail_search") return replyToSenderFilter(db, request);
  try {
    const { emails, total } = await searchEmails(db, request.query);
    return formatEmails(emails, total);
  } catch (error) {
    if (error instanceof CalendarNotConnectedError) {
      return "No tienes Google conectado. Conéctalo con /conectar_calendario para que pueda leer tu correo.";
    }
    if (error instanceof GmailPermissionError) return error.message;
    throw error;
  }
}

/** Para el resumen de la mañana. Sin correos importantes no dice nada. */
export function morningEmailLines(emails: EmailSummary[], total: number): string[] {
  if (emails.length === 0) return [];
  const count = total > emails.length ? total : emails.length;
  return [
    `📧 ${count === 1 ? "1 correo importante" : `${count} correos importantes`} sin leer:`,
    ...emails.map((email) => `• ${email.from}: ${email.subject}`),
  ];
}

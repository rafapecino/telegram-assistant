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
export const NOISE_CATEGORIES = "-(category:promotions -is:important) -category:social -category:forums";
/** Lo del resumen de la mañana: importantes sin leer que han llegado desde el día anterior. */
export const MORNING_QUERY = "is:unread is:important newer_than:1d";

/** Formato que el modelo debe devolver cuando el mensaje habla del correo (ver message-intent.ts). */
export const GMAIL_INTENT_FORMAT =
  'Correo de Gmail, si pregunta por sus correos o emails: {"intent": "gmail", "query": "<búsqueda>"} con la sintaxis ' +
  'de búsqueda de Gmail, por ejemplo "from:hacienda" ("¿tengo algo de Hacienda?"), "is:unread in:inbox" ' +
  '("¿tengo correos sin leer?"), "subject:factura newer_than:7d". Sin más detalles, "is:unread in:inbox".';

export type GmailRequest =
  | { kind: "gmail_search"; query: string }
  | { kind: "invalid"; message: string };

export function parseGmailRequest(raw: unknown): GmailRequest {
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

/** Quita el ruido, salvo si la búsqueda pide un remitente concreto: "¿me ha escrito Uber?" debe encontrarlo. */
export function withoutNoise(query: string, blockedSenders: string[]): string {
  if (/(^|\s|-)from:/i.test(query)) return query;
  const senders = blockedSenders.length > 0 ? ` -from:(${blockedSenders.join(" OR ")})` : "";
  return `${query} ${NOISE_CATEGORIES}${senders}`;
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

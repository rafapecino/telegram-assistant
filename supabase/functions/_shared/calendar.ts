import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { functionUrl } from "./database.ts";
import { requireEnv } from "./env.ts";
import { isCalendarDate } from "./expense-queries.ts";
import { addDaysToDate, formatMadridDateTime, madridLocalToUtc } from "./madrid-time.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
// Solo eventos (leer y crear), no la configuración de los calendarios ni compartirlos.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
// Gmail va en la misma conexión, solo para leer: no puede enviar, borrar ni cambiar nada.
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTHORIZATION_LINK_LIFETIME_MINUTES = 30;
const MAX_LIST_DAYS = 62;

/** Formato que el modelo debe devolver cuando el mensaje habla del calendario (ver message-intent.ts). */
export const CALENDAR_INTENT_FORMAT =
  'Agenda (calendario de Google, recordatorios, hábitos o rutinas del día y cumpleaños), si pregunta qué tiene o qué ' +
  'tiene que hacer algún día, qué rutinas le tocan, por su agenda o calendario, o qué recordatorios tiene: ' +
  '{"intent": "calendar", "action": "list", "date_from": "YYYY-MM-DD", ' +
  '"date_to": "YYYY-MM-DD"} para verlos ("¿qué tengo mañana?"; "esta semana" o "qué hay para esta semana", de hoy al ' +
  'domingo; sin días concretos, hoy y los 30 siguientes), ' +
  'o {"intent": "calendar", "action": "create", "title": "<evento>", "local_datetime": "YYYY-MM-DDTHH:mm" o null, ' +
  '"date": "YYYY-MM-DD" o null, "duration_minutes": 60} para crear uno: con hora, local_datetime en hora de Madrid; ' +
  "de todo el día, date. Si pide que se le avise, es un recordatorio.";

export type CalendarRequest =
  | { kind: "calendar_list"; dateFrom: string; dateTo: string }
  | { kind: "calendar_create"; title: string; start: Date; durationMinutes: number }
  | { kind: "calendar_create_all_day"; title: string; date: string }
  | { kind: "invalid"; message: string };

export function parseCalendarRequest(raw: unknown): CalendarRequest {
  const candidate = raw as Record<string, unknown> | null;
  if (candidate?.action === "list") {
    const { date_from: dateFrom, date_to: dateTo } = candidate;
    if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo) {
      return { kind: "invalid", message: "No he entendido de qué días quieres ver el calendario." };
    }
    if (addDaysToDate(dateFrom, MAX_LIST_DAYS) < dateTo) {
      return { kind: "invalid", message: "Puedo enseñarte como mucho dos meses del calendario de una vez." };
    }
    return { kind: "calendar_list", dateFrom, dateTo };
  }
  if (candidate?.action !== "create") {
    return { kind: "invalid", message: "No he entendido qué hacer con el calendario." };
  }
  const title = typeof candidate.title === "string" ? candidate.title.trim().slice(0, 200) : "";
  if (!title) return { kind: "invalid", message: "No he entendido qué evento quieres crear." };
  if (typeof candidate.local_datetime === "string") {
    let start: Date;
    try {
      start = madridLocalToUtc(candidate.local_datetime);
    } catch {
      return { kind: "invalid", message: "No he entendido la fecha del evento." };
    }
    const duration = Number(candidate.duration_minutes ?? 60);
    const durationMinutes = Number.isInteger(duration) && duration >= 5 && duration <= 1440 ? duration : 60;
    return { kind: "calendar_create", title, start, durationMinutes };
  }
  if (isCalendarDate(candidate.date)) return { kind: "calendar_create_all_day", title, date: candidate.date };
  return { kind: "invalid", message: "No he entendido la fecha del evento." };
}

/** No hay ningún calendario conectado: no es un fallo, se explica cómo conectarlo. */
export class CalendarNotConnectedError extends Error {
  constructor() {
    super("No tienes el calendario conectado. Conéctalo con /conectar_calendario.");
  }
}

/** El enlace ya se usó o ha caducado. */
export class InvalidCalendarLinkError extends Error {}

function redirectUrl(): string {
  return functionUrl("google-callback");
}

/** Devuelve el enlace en el que se autoriza el acceso al calendario desde Google. */
export async function createCalendarLink(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.from("google_authorizations").insert({}).select("state").single();
  if (error) throw new Error(`No se pudo preparar la autorización de Google: ${error.message}`);
  return `${GOOGLE_AUTH_URL}?${new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUrl(),
    response_type: "code",
    scope: `${CALENDAR_SCOPE} ${GMAIL_SCOPE}`,
    // offline + consent: Google da un refresh_token, que permite seguir usando el calendario sin volver a autorizar.
    access_type: "offline",
    prompt: "consent",
    state: data.state,
  })}`;
}

export function parseJsonOrEmpty(text: string): Record<string, unknown> {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function postGoogleForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const text = await response.text();
  const result = parseJsonOrEmpty(text);
  if (!response.ok) {
    if (result.error === "invalid_grant") {
      throw new Error("Google ha retirado el acceso al calendario. Vuelve a conectarlo con /conectar_calendario.");
    }
    throw new Error(`Google respondió ${response.status} (${result.error ?? text})`);
  }
  return result;
}

/** Canjea el código que devuelve Google. El state se consume una sola vez para que un enlace viejo no sirva. */
export async function completeCalendarLink(db: SupabaseClient, state: string, code: string, now: Date): Promise<void> {
  const oldestValidLink = new Date(now.getTime() - AUTHORIZATION_LINK_LIFETIME_MINUTES * 60_000);
  const { data: claimed, error } = await db.from("google_authorizations")
    .update({ used_at: now.toISOString() })
    .eq("state", state)
    .is("used_at", null)
    .gte("created_at", oldestValidLink.toISOString())
    .select("state");
  if (error) throw new Error(`No se pudo validar la autorización de Google: ${error.message}`);
  if (claimed.length === 0) {
    throw new InvalidCalendarLinkError(
      "Este enlace ya se usó o ha caducado. Si necesitas conectar el calendario, pide otro con /conectar_calendario.",
    );
  }
  const tokens = await postGoogleForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: redirectUrl(),
    grant_type: "authorization_code",
  });
  if (typeof tokens.refresh_token !== "string") {
    throw new Error("Google no ha dado acceso permanente. Vuelve a intentarlo con /conectar_calendario.");
  }
  // Solo una conexión: la nueva sustituye a la anterior.
  const { error: deleteError } = await db.from("google_connections").delete().gt("id", 0);
  if (deleteError) throw new Error(`No se pudo sustituir la conexión anterior: ${deleteError.message}`);
  const { error: insertError } = await db.from("google_connections").insert({ refresh_token: tokens.refresh_token });
  if (insertError) throw new Error(`No se pudo guardar la conexión con Google: ${insertError.message}`);
}

async function getRefreshToken(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.from("google_connections").select("refresh_token")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`No se pudo leer la conexión con Google: ${error.message}`);
  return data?.refresh_token ?? null;
}

export async function isCalendarConnected(db: SupabaseClient): Promise<boolean> {
  return (await getRefreshToken(db)) !== null;
}

/** Token de acceso de la conexión con Google: sirve para el calendario y para Gmail. */
export async function getAccessToken(db: SupabaseClient): Promise<string> {
  const refreshToken = await getRefreshToken(db);
  if (!refreshToken) throw new CalendarNotConnectedError();
  const tokens = await postGoogleForm(GOOGLE_TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  if (typeof tokens.access_token !== "string") throw new Error("Google no ha devuelto un token de acceso.");
  return tokens.access_token;
}

async function callCalendar(db: SupabaseClient, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await getAccessToken(db)}`, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const details = parseJsonOrEmpty(await response.text());
    const googleError = details.error as Record<string, unknown> | undefined;
    const status = googleError?.status;
    const errors = googleError?.errors as { reason?: string }[] | undefined;
    if (status === "PERMISSION_DENIED" &&
      (googleError?.code === 403 || response.status === 403) &&
      (JSON.stringify(details).includes("SERVICE_DISABLED") || errors?.some((error) => error.reason === "accessNotConfigured"))) {
      throw new Error("La API de Google Calendar está desactivada. Actívala en Google Cloud y vuelve a actualizar el panel.");
    }
    throw new Error(`Google Calendar respondió ${response.status}: ${typeof googleError?.message === "string" ? googleError.message : "No se pudo consultar el calendario."}`);
  }
  return response.json();
}

export interface CalendarEvent {
  title: string;
  /** Instante de inicio, o null si es de todo el día. */
  start: Date | null;
  /** Fecha (YYYY-MM-DD) de los eventos de todo el día. */
  date: string | null;
}

interface GoogleEvent {
  summary?: string;
  start?: { dateTime?: string; date?: string };
}

export function toCalendarEvent(event: GoogleEvent): CalendarEvent {
  return {
    title: event.summary?.trim() || "(sin título)",
    start: event.start?.dateTime ? new Date(event.start.dateTime) : null,
    date: event.start?.date ?? null,
  };
}

/** Eventos de los días indicados (en hora de Madrid), en orden. */
export async function listEvents(db: SupabaseClient, dateFrom: string, dateTo: string): Promise<CalendarEvent[]> {
  const query = new URLSearchParams({
    timeMin: madridLocalToUtc(`${dateFrom}T00:00`).toISOString(),
    timeMax: madridLocalToUtc(`${addDaysToDate(dateTo, 1)}T00:00`).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  const result = await callCalendar(db, `${EVENTS_URL}?${query}`);
  return ((result.items ?? []) as GoogleEvent[]).map(toCalendarEvent);
}

/** Cuerpo del evento para la API de Google. Los de todo el día terminan el día siguiente (Google lo cuenta así). */
export function eventBody(request: Exclude<CalendarRequest, { kind: "calendar_list" } | { kind: "invalid" }>) {
  if (request.kind === "calendar_create_all_day") {
    return { summary: request.title, start: { date: request.date }, end: { date: addDaysToDate(request.date, 1) } };
  }
  const end = new Date(request.start.getTime() + request.durationMinutes * 60_000);
  return {
    summary: request.title,
    start: { dateTime: request.start.toISOString(), timeZone: "Europe/Madrid" },
    end: { dateTime: end.toISOString(), timeZone: "Europe/Madrid" },
  };
}

export async function createEvent(
  db: SupabaseClient,
  request: Exclude<CalendarRequest, { kind: "calendar_list" } | { kind: "invalid" }>,
): Promise<void> {
  await callCalendar(db, EVENTS_URL, { method: "POST", body: JSON.stringify(eventBody(request)) });
}

const longDate = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function describeEvent(event: CalendarEvent): string {
  if (event.start) return `• ${formatMadridDateTime(event.start)} · ${event.title}`;
  return `• ${longDate.format(new Date(`${event.date}T00:00:00Z`))} (todo el día) · ${event.title}`;
}

export function formatEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return "No tienes nada en el calendario esos días.";
  return ["En tu calendario:", ...events.map(describeEvent)].join("\n");
}

export function describeCreatedEvent(
  request: Exclude<CalendarRequest, { kind: "calendar_list" } | { kind: "invalid" }>,
) {
  if (request.kind === "calendar_create_all_day") {
    return `Añadido al calendario: «${request.title}», ${longDate.format(new Date(`${request.date}T00:00:00Z`))}.`;
  }
  return `Añadido al calendario: «${request.title}», ${
    formatMadridDateTime(request.start)
  } (${request.durationMinutes} min).`;
}

/** Retira el permiso en Google y borra la conexión. Devuelve si había una. */
export async function disconnectCalendar(db: SupabaseClient): Promise<boolean> {
  const refreshToken = await getRefreshToken(db);
  if (!refreshToken) return false;
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  });
  // invalid_token: Google ya no lo reconocía (retirado antes desde la cuenta de Google), no queda nada que retirar.
  const alreadyRevoked = parseJsonOrEmpty(await response.text()).error === "invalid_token";
  if (!response.ok && !alreadyRevoked) {
    throw new Error(`Google respondió ${response.status} al retirar el permiso. Inténtalo de nuevo.`);
  }
  const { error } = await db.from("google_connections").delete().gt("id", 0);
  if (error) throw new Error(`No se pudo borrar la conexión con Google: ${error.message}`);
  return true;
}

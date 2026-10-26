import { createAdminClient } from "../_shared/database.ts";
import { addDaysToDate, madridClock, madridMonthStart } from "../_shared/madrid-time.ts";
import { listEvents, createEvent, createCalendarLink, isCalendarConnected, parseCalendarRequest } from "../_shared/calendar.ts";
import { loadBudgetStatuses, parseBudgetRequest, saveBudget, deleteBudget } from "../_shared/budgets.ts";
import { parseReminderRequest, saveReminder } from "../_shared/reminders.ts";
import { recordHabit } from "../_shared/habits.ts";
import { createBankLink, disconnectBank, hasBankConnections } from "../_shared/bank-connection.ts";
import { clearChatMessages, loadChatMessages, parseChatInput, replyToChat } from "../_shared/panel-chat.ts";
import { parseWeightRequest, saveWeight } from "../_shared/weight.ts";
import { transcribeAudio } from "../_shared/groq.ts";
import { inventFunnyLine, loadMemory, saveMemory } from "../_shared/memory.ts";
import { fetchWeatherAlerts } from "../_shared/aemet.ts";
import { DEFAULT_CITY, describeWeatherCode, fetchTodayWeather } from "../_shared/weather.ts";

const resources = new Set(["shopping_items", "notes", "birthdays", "habits", "reminders", "expenses", "incomes", "weight_entries"]);
const editable = new Set(["shopping_items", "notes", "birthdays", "habits", "reminders", "weight_entries"]);
const fields: Record<string, string> = {
  shopping_items: "id,text,created_at", notes: "id,text,created_at",
  birthdays: "id,name,day,month,year", habits: "id,name,created_at,scheduled_days",
  reminders: "id,text,remind_at,repeat,sent_at,advance_minutes", expenses: "id,booking_date,amount,category,description,currency",
  incomes: "id,booking_date,amount,description,currency", weight_entries: "id,date,kg",
};
const MAX_BODY = 4096;
// El mensaje del chat (1000 caracteres) y la memoria (4000) pueden ocupar varios bytes por carácter.
const MAX_CHAT_BODY = 32768;
// Unos 2 minutos de nota de voz comprimida, como el límite del bot de Telegram.
const MAX_AUDIO_BYTES = 2_000_000;
/** Groq reconoce el formato por la extensión: Chrome graba webm, Safari mp4 y Firefox ogg. */
function audioFileName(contentType: string): string {
  const extension = contentType.includes("mp4") ? "mp4" : contentType.includes("ogg") ? "ogg" : "webm";
  return `nota-de-voz.${extension}`;
}
async function transcribeUpload(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) throw new Error("La nota de voz es demasiado larga.");
  const audio = await request.blob();
  if (audio.size === 0) throw new Error("No se ha recibido audio.");
  if (audio.size > MAX_AUDIO_BYTES) throw new Error("La nota de voz es demasiado larga.");
  return transcribeAudio(audio, audioFileName(request.headers.get("content-type") ?? ""));
}
function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}
function validText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`Escribe un texto de hasta ${max} caracteres.`);
  return value.trim();
}
function validId(value: unknown): number {
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Identificador no válido."); return n;
}
function validScheduledDays(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 7 ||
    value.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(value).size !== value.length) {
    throw new Error("Elige al menos un día de la semana.");
  }
  return [...value].sort((a, b) => a - b);
}
async function body(request: Request, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBody) throw new Error("Solicitud demasiado grande.");
  const text = await request.text(); if (text.length > maxBody) throw new Error("Solicitud demasiado grande.");
  const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Datos no válidos.");
  return parsed;
}
Deno.serve(async (request) => {
  // CORS no autoriza a nadie: solo facilita las llamadas del navegador con un JWT válido.
  const cors: HeadersInit = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const received = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!received) return json({ error: "Inicia sesión para acceder." }, 401, cors);
  const db = createAdminClient();
  const { data: { user }, error: authError } = await db.auth.getUser(received);
  if (authError || !user) return json({ error: "Sesión caducada. Inicia sesión de nuevo." }, 401, cors);
  const { data: access, error: accessError } = await db.from("panel_users")
    .select("user_id").eq("user_id", user.id).maybeSingle();
  if (accessError) { console.error("Error de acceso al panel:", accessError); return json({ error: "No se pudo comprobar el acceso." }, 503, cors); }
  if (!access) return json({ error: "Esta cuenta no tiene acceso al panel." }, 403, cors);
  try {
    const url = new URL(request.url), resource = url.searchParams.get("resource") ?? "";
    const now = new Date(), today = madridClock(now).localDate;
    if (request.method === "GET") {
      if (resources.has(resource)) {
        let query = db.from(resource).select(fields[resource]).limit(150);
        if (resource === "reminders") query = query.is("sent_at", null).order("remind_at");
        else if (resource === "weight_entries") query = query.order("date", { ascending: false });
        else if (resource === "expenses" || resource === "incomes") query = query.gte("booking_date", url.searchParams.get("from") ?? madridMonthStart(now)).order("booking_date", { ascending: false });
        else query = query.order("id", { ascending: false });
        const { data, error } = await query; if (error) throw error; return json(data, 200, cors);
      }
      if (resource === "budgets") return json(await loadBudgetStatuses(db, now), 200, cors);
      if (resource === "memory") return json({ content: await loadMemory(db) }, 200, cors);
      if (resource === "chat_messages") return json(await loadChatMessages(db), 200, cors);
      if (resource === "greeting") return json({ text: await inventFunnyLine(db) }, 200, cors);
      if (resource === "weather") {
        const weather = await fetchTodayWeather(Deno.env.get("WEATHER_CITY")?.trim() || DEFAULT_CITY);
        return json({ ...weather, description: describeWeatherCode(weather.code) }, 200, cors);
      }
      // Separado del tiempo: si AEMET falla, la previsión se sigue viendo.
      if (resource === "weather_alerts") {
        return json((await fetchWeatherAlerts()).filter((alert) => alert.expires > now), 200, cors);
      }
      if (resource === "bank_connection") return json({ connected: await hasBankConnections(db) }, 200, cors);
      if (resource === "habit_checks") {
        const { data, error } = await db.from("habit_checks").select("habit_id,date,done").gte("date", addDaysToDate(today, -120));
        if (error) throw error; return json(data, 200, cors);
      }
      if (resource === "calendar") {
        if (!await isCalendarConnected(db)) return json({ connected: false, events: [] }, 200, cors);
        const month = url.searchParams.get("month") ?? today.slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes no válido.");
        const [year, number] = month.split("-").map(Number);
        const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
        return json({ connected: true, events: await listEvents(db, `${month}-01`, end) }, 200, cors);
      }
    }
    if (request.method === "POST" && resource === "transcribe") return json({ text: await transcribeUpload(request) }, 200, cors);
    if (request.method === "POST") {
      const input = await body(request, resource === "chat" || resource === "memory" ? MAX_CHAT_BODY : MAX_BODY);
      if (resource === "chat") return json(await replyToChat(db, parseChatInput(input), now), 200, cors);
      if (resource === "memory") { await saveMemory(db, input.content); return json({ ok: true }, 200, cors); }
      if (resource === "shopping_items" || resource === "notes") {
        const { error } = await db.from(resource).insert({ text: validText(input.text, resource === "notes" ? 1000 : 100) }); if (error) throw error;
      } else if (resource === "birthdays") {
        const day = Number(input.day), month = Number(input.month), year = input.year === "" || input.year == null ? null : Number(input.year);
        if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > new Date(2024, month, 0).getDate() || year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) throw new Error("Fecha de cumpleaños no válida.");
        const { error } = await db.from(resource).insert({ name: validText(input.name, 100), day, month, year }); if (error) throw error;
      } else if (resource === "habits") {
        const scheduled_days = validScheduledDays(input.scheduled_days ?? [1, 2, 3, 4, 5, 6, 7]);
        const { error } = input.id == null
          ? await db.from(resource).insert({ name: validText(input.name, 100), scheduled_days })
          : await db.from(resource).update({ scheduled_days }).eq("id", validId(input.id));
        if (error) throw error;
      } else if (resource === "habit_checks") {
        const id = validId(input.habit_id); if (typeof input.done !== "boolean") throw new Error("Respuesta no válida.");
        const date = input.date ?? today;
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || date < addDaysToDate(today, -120) || date > today) {
          throw new Error("Solo puedes marcar días de los últimos cuatro meses.");
        }
        const { data, error } = await db.from("habits").select("id,name,scheduled_days").eq("id", id).single(); if (error || !data) throw new Error("Hábito no encontrado.");
        await recordHabit(db, data, date, input.done);
      } else if (resource === "reminders") {
        const reminder = parseReminderRequest({ text: input.text, local_datetime: input.local_datetime, repeat: input.repeat ?? null,
          advance_minutes: input.advance_minutes ?? null }, now);
        if (reminder.kind === "invalid") throw new Error(reminder.message);
        await saveReminder(db, reminder.text, reminder.remindAt, reminder.repeat, reminder.advanceMinutes);
      } else if (resource === "weight_entries") {
        const weight = parseWeightRequest({ action: "save", kg: input.kg, date: input.date }, today);
        if (weight.kind !== "weight_save") throw new Error(weight.kind === "invalid" ? weight.message : "Peso no válido.");
        await saveWeight(db, weight.date, weight.kg);
      } else if (resource === "budgets") {
        const intent = parseBudgetRequest({ action: "set", category: input.category, monthly_limit: input.monthly_limit });
        if (intent.kind === "invalid") throw new Error(intent.message);
        if (intent.kind !== "budget_set") throw new Error("Presupuesto no válido.");
        await saveBudget(db, intent.category, intent.monthlyLimit, now);
      } else if (resource === "calendar") {
        const intent = parseCalendarRequest({ action: "create", title: input.title, local_datetime: input.local_datetime, date: input.date, duration_minutes: input.duration_minutes });
        if (intent.kind === "invalid") throw new Error(intent.message);
        if (intent.kind === "calendar_list") throw new Error("Evento no válido.");
        await createEvent(db, intent);
      } else if (resource === "calendar_link") return json({ url: await createCalendarLink(db) }, 200, cors);
      else if (resource === "bank_link") return json({ url: await createBankLink(db, now) }, 200, cors);
      else return json({ error: "Recurso no encontrado." }, 404, cors);
      return json({ ok: true }, 200, cors);
    }
    if (request.method === "DELETE") {
      if (resource === "budgets") {
        const category = url.searchParams.get("category") ?? "";
        const intent = parseBudgetRequest({ action: "delete", category }); if (intent.kind !== "budget_delete") throw new Error("Categoría no válida.");
        await deleteBudget(db, category);
      } else if (resource === "bank_connection") {
        await disconnectBank(db, now);
      } else if (resource === "chat_messages") {
        await clearChatMessages(db);
      } else if (editable.has(resource)) {
        const id = validId(url.searchParams.get("id")); const { error } = await db.from(resource).delete().eq("id", id); if (error) throw error;
      } else return json({ error: "Recurso no encontrado." }, 404, cors);
      return json({ ok: true }, 200, cors);
    }
    return json({ error: "Operación no admitida." }, 405, cors);
  } catch (error) {
    console.error("Error del panel:", error);
    return json({ error: error instanceof Error && !("code" in error) ? error.message : "No se pudo completar la operación." }, 400, cors);
  }
});

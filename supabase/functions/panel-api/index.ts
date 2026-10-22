import { createAdminClient } from "../_shared/database.ts";
import { madridClock, madridMonthStart } from "../_shared/madrid-time.ts";
import { listEvents, createEvent, createCalendarLink, isCalendarConnected, parseCalendarRequest } from "../_shared/calendar.ts";
import { loadBudgetStatuses, parseBudgetRequest, saveBudget, deleteBudget } from "../_shared/budgets.ts";
import { parseReminderRequest, saveReminder } from "../_shared/reminders.ts";
import { recordHabit } from "../_shared/habits.ts";
import { createBankLink, disconnectBank, hasBankConnections } from "../_shared/bank-connection.ts";
import { parseChatInput, replyToChat } from "../_shared/panel-chat.ts";

const resources = new Set(["shopping_items", "notes", "birthdays", "habits", "reminders", "expenses", "incomes"]);
const editable = new Set(["shopping_items", "notes", "birthdays", "habits", "reminders"]);
const fields: Record<string, string> = {
  shopping_items: "id,text,created_at", notes: "id,text,created_at",
  birthdays: "id,name,day,month,year", habits: "id,name,created_at",
  reminders: "id,text,remind_at,repeat,sent_at", expenses: "id,booking_date,amount,category,description,currency",
  incomes: "id,booking_date,amount,description,currency",
};
const MAX_BODY = 4096;
// El chat envía también los últimos mensajes de la conversación.
const MAX_CHAT_BODY = 32768;
function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}
function safeEqual(a: string, b: string) {
  const encoder = new TextEncoder(); const left = encoder.encode(a); const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
function validText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`Escribe un texto de hasta ${max} caracteres.`);
  return value.trim();
}
function validId(value: unknown): number {
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Identificador no válido."); return n;
}
async function body(request: Request, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBody) throw new Error("Solicitud demasiado grande.");
  const text = await request.text(); if (text.length > maxBody) throw new Error("Solicitud demasiado grande.");
  const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Datos no válidos.");
  return parsed;
}
Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const allowed = (Deno.env.get("PANEL_ORIGINS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const cors: HeadersInit = origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS" } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
  const token = Deno.env.get("PANEL_TOKEN");
  const received = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || !received || !safeEqual(token, received)) return json({ error: "Acceso denegado." }, 401, cors);
  try {
    const url = new URL(request.url), resource = url.searchParams.get("resource") ?? "";
    const db = createAdminClient(), now = new Date(), today = madridClock(now).localDate;
    if (request.method === "GET") {
      if (resources.has(resource)) {
        let query = db.from(resource).select(fields[resource]).limit(150);
        if (resource === "reminders") query = query.is("sent_at", null).order("remind_at");
        else if (resource === "expenses" || resource === "incomes") query = query.gte("booking_date", url.searchParams.get("from") ?? madridMonthStart(now)).order("booking_date", { ascending: false });
        else query = query.order("id", { ascending: false });
        const { data, error } = await query; if (error) throw error; return json(data, 200, cors);
      }
      if (resource === "budgets") return json(await loadBudgetStatuses(db, now), 200, cors);
      if (resource === "bank_connection") return json({ connected: await hasBankConnections(db) }, 200, cors);
      if (resource === "habit_checks") {
        const { data, error } = await db.from("habit_checks").select("habit_id,date,done").gte("date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
        if (error) throw error; return json(data, 200, cors);
      }
      if (resource === "calendar") {
        if (!await isCalendarConnected(db)) return json({ connected: false, events: [] }, 200, cors);
        const end = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        return json({ connected: true, events: await listEvents(db, today, end) }, 200, cors);
      }
    }
    if (request.method === "POST") {
      const input = await body(request, resource === "chat" ? MAX_CHAT_BODY : MAX_BODY);
      if (resource === "chat") return json(await replyToChat(db, parseChatInput(input), now), 200, cors);
      if (resource === "shopping_items" || resource === "notes") {
        const { error } = await db.from(resource).insert({ text: validText(input.text, resource === "notes" ? 1000 : 100) }); if (error) throw error;
      } else if (resource === "birthdays") {
        const day = Number(input.day), month = Number(input.month), year = input.year === "" || input.year == null ? null : Number(input.year);
        if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > new Date(2024, month, 0).getDate() || year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) throw new Error("Fecha de cumpleaños no válida.");
        const { error } = await db.from(resource).insert({ name: validText(input.name, 100), day, month, year }); if (error) throw error;
      } else if (resource === "habits") {
        const { error } = await db.from(resource).insert({ name: validText(input.name, 100) }); if (error) throw error;
      } else if (resource === "habit_checks") {
        const id = validId(input.habit_id); if (typeof input.done !== "boolean") throw new Error("Respuesta no válida.");
        const { data, error } = await db.from("habits").select("id,name").eq("id", id).single(); if (error || !data) throw new Error("Hábito no encontrado.");
        await recordHabit(db, data, today, input.done);
      } else if (resource === "reminders") {
        const reminder = parseReminderRequest({ text: input.text, local_datetime: input.local_datetime, repeat: input.repeat ?? null }, now);
        if (reminder.kind === "invalid") throw new Error(reminder.message);
        await saveReminder(db, reminder.text, reminder.remindAt, reminder.repeat);
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

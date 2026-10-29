import { loadFinanceInsightExpenses } from '../_shared/finance-insights.ts';
import { preparePanelDraft } from '../_shared/panel-drafts.ts';
import { createAdminClient } from "../_shared/database.ts";
import { addDaysToDate, madridClock, madridMonthStart } from "../_shared/madrid-time.ts";
import { listEvents, createEvent, createCalendarLink, disconnectCalendar, isCalendarConnected, parseCalendarRequest } from "../_shared/calendar.ts";
import { describeGoogleAccount, listBankAccess } from "../_shared/connected-accounts.ts";
import { deletePersonalData, exportPersonalData, parseCategories, summarizePersonalData } from "../_shared/personal-data.ts";
import { loadBudgetStatuses, parseBudgetRequest, saveBudget, deleteBudget } from "../_shared/budgets.ts";
import { parseReminderRequest, saveReminder } from "../_shared/reminders.ts";
import { recordHabit } from "../_shared/habits.ts";
import { EXPENSE_CATEGORIES } from "../_shared/expenses.ts";
import { parseManualEntry, saveManualEntry } from "../_shared/manual-entries.ts";
import { createBankLink, disconnectBank, hasBankConnections } from "../_shared/bank-connection.ts";
import { clearChatMessages, loadChatMessages, parseChatInput, replyToChat } from "../_shared/panel-chat.ts";
import { parseWeightRequest, saveWeight } from "../_shared/weight.ts";
import { transcribeAudio } from "../_shared/groq.ts";
import { inventFunnyLine, loadMemory, saveMemory } from "../_shared/memory.ts";
import { fetchWeatherAlerts } from "../_shared/aemet.ts";
import { loadNews, NEWS_TOPICS } from "../_shared/news.ts";
import { fetchCuriosity } from "../_shared/curiosity.ts";
import { fetchQuotes, followAsset, loadWatchlist, type MarketKind, unfollowAsset } from "../_shared/markets.ts";
import { addWatch, comparePrices, listWatches, removeWatch } from "../_shared/prices.ts";
import { parseMovementFilters, searchEverything, searchMovements } from "../_shared/search.ts";
import { UserFacingError } from "../_shared/errors.ts";
import { addIngredientsToShopping, chooseDishes, loadMealWeek, type MealWeek, pendingIngredients, proposeDishes, removeDish, setDishCooked, weekStartOf } from "../_shared/meals.ts";
import { corsHeaders, describeErrorForClient, isOverRateLimit, recordAccessDenied } from "../_shared/panel-security.ts";
import {
  describeWeatherCode,
  fetchForecast,
  FORECAST_DAYS,
  mainPlace,
  type Place,
  VILLANUEVA_DE_LA_CANADA,
} from "../_shared/weather.ts";

const resources = new Set(["shopping_items", "notes", "birthdays", "habits", "reminders", "expenses", "incomes", "weight_entries"]);
const editable = new Set(["shopping_items", "notes", "birthdays", "habits", "reminders", "weight_entries"]);
const fields: Record<string, string> = {
  shopping_items: "id,text,created_at", notes: "id,text,created_at",
  birthdays: "id,name,day,month,year", habits: "id,name,created_at,scheduled_days",
  reminders: "id,text,remind_at,repeat,sent_at,advance_minutes", expenses: "id,booking_date,amount,category,description,currency",
  incomes: "id,booking_date,amount,description,currency", weight_entries: "id,date,kg",
};
const MAX_BODY = 4096;
/** El menú de la semana tal como lo pinta el panel: los platos y los ingredientes que quedan por revisar. */
function mealPlanView(week: MealWeek) {
  return { week_start: week.weekStart, dishes: week.dishes, pending: pendingIngredients(week) };
}
function validIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 60) throw new UserFacingError("Platos no válidos.");
  return value.map(validId);
}
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
  if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) throw new UserFacingError("La nota de voz es demasiado larga.");
  const audio = await request.blob();
  if (audio.size === 0) throw new UserFacingError("No se ha recibido audio.");
  if (audio.size > MAX_AUDIO_BYTES) throw new UserFacingError("La nota de voz es demasiado larga.");
  return transcribeAudio(audio, audioFileName(request.headers.get("content-type") ?? ""));
}
/** Los 7 días de un sitio, con el cielo ya en palabras. */
async function weekForecast(place: Place) {
  const days = await fetchForecast(place, FORECAST_DAYS);
  return { place: place.name, days: days.map((day) => ({ ...day, description: describeWeatherCode(day.code) })) };
}
function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}
function validText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new UserFacingError(`Escribe un texto de hasta ${max} caracteres.`);
  return value.trim();
}
function validId(value: unknown): number {
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new UserFacingError("Identificador no válido."); return n;
}
function validScheduledDays(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 7 ||
    value.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(value).size !== value.length) {
    throw new UserFacingError("Elige al menos un día de la semana.");
  }
  return [...value].sort((a, b) => a - b);
}
async function body(request: Request, maxBody = MAX_BODY): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBody) throw new UserFacingError("Solicitud demasiado grande.");
  const text = await request.text(); if (text.length > maxBody) throw new UserFacingError("Solicitud demasiado grande.");
  let parsed; try { parsed = JSON.parse(text); } catch { throw new UserFacingError("Datos no válidos."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UserFacingError("Datos no válidos.");
  return parsed;
}
// Marca de «este recurso no existe» para lecturas: distinta de cualquier dato que pueda devolver un recurso.
const NOT_FOUND = Symbol("recurso no encontrado");
// Lo que el panel carga al abrirse, en una sola petición: con una por recurso, Supabase cortaba con 429.
const DASHBOARD_RESOURCES = [
  "expenses", "incomes", "budgets", "reminders", "shopping_items", "birthdays", "habits", "habit_checks",
  "weight_entries", "calendar", "bank_connection", "memory", "weather", "weather_alerts", "meal_plan",
];
async function readResource(db: ReturnType<typeof createAdminClient>, resource: string, params: URLSearchParams, now: Date, today: string): Promise<unknown> {
  if (resources.has(resource)) {
    let query = db.from(resource).select(fields[resource]).limit(150);
    if (resource === "reminders") query = query.is("sent_at", null).order("remind_at");
    else if (resource === "weight_entries") query = query.order("date", { ascending: false });
    else if (resource === "expenses" || resource === "incomes") query = query.gte("booking_date", params.get("from") ?? madridMonthStart(now)).order("booking_date", { ascending: false });
    else query = query.order("id", { ascending: false });
    const { data, error } = await query; if (error) throw error; return data;
  }
  if (resource === "budgets") return await loadBudgetStatuses(db, now);
  if (resource === "meal_plan") return mealPlanView(await loadMealWeek(db, weekStartOf(today)));
  if (resource === "memory") return { content: await loadMemory(db) };
  if (resource === "chat_messages") return await loadChatMessages(db);
  if (resource === "greeting") return { text: await inventFunnyLine(db) };
  if (resource === "weather") {
    const places = [await mainPlace(), VILLANUEVA_DE_LA_CANADA];
    return await Promise.all(places.map(weekForecast));
  }
  // Separado del tiempo: si AEMET falla, la previsión se sigue viendo.
  if (resource === "weather_alerts") {
    return (await fetchWeatherAlerts()).filter((alert) => alert.expires > now);
  }
  if (resource === "bank_connection") return { connected: await hasBankConnections(db) };
  // Ajustes: se piden al abrir la sección, no con el resto, porque consultan a Google.
  if (resource === "connected_accounts") {
    return { google: await describeGoogleAccount(db), bank: await listBankAccess(db) };
  }
  if (resource === "finance_insights") return await loadFinanceInsightExpenses(db,today);
  if (resource === "movements") return await searchMovements(db, parseMovementFilters(params));
  if (resource === "search") return await searchEverything(db, params.get("q"), today);
  if (resource === "markets") {
    const assets = await loadWatchlist(db);
    return { assets, ...await fetchQuotes(assets, now) };
  }
  if (resource === "prices") return await comparePrices(params.get("q"));
  if (resource === "price_watches") return await listWatches(db);
  if (resource === "curiosity") return await fetchCuriosity(today);
  if (resource === "news_topics") {
    return Object.entries(NEWS_TOPICS).map(([id, topic]) => ({ id, label: topic.label }));
  }
  if (resource === "news") {
    const topic = params.get("topic") ?? "";
    if (!Object.hasOwn(NEWS_TOPICS, topic)) throw new UserFacingError("Tema de noticias no válido.");
    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 30);
    return await loadNews(topic, limit, now);
  }
  if (resource === "expense_categories") return EXPENSE_CATEGORIES;
  if (resource === "data_summary") return await summarizePersonalData(db);
  if (resource === "data_export") return await exportPersonalData(db, now);
  if (resource === "habit_checks") {
    const { data, error } = await db.from("habit_checks").select("habit_id,date,done").gte("date", addDaysToDate(today, -120));
    if (error) throw error; return data;
  }
  if (resource === "calendar") {
    if (!await isCalendarConnected(db)) return { connected: false, events: [] };
    const month = params.get("month") ?? today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new UserFacingError("Mes no válido.");
    const [year, number] = month.split("-").map(Number);
    const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    return { connected: true, events: await listEvents(db, `${month}-01`, end) };
  }
  return NOT_FOUND;
}
Deno.serve(async (request) => {
  const cors = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const db = createAdminClient();
  // Si no se puede apuntar el intento, se rechaza igual: el aviso es un extra, no lo que protege el panel.
  const deny = async (reason: string, message: string, status: number) => {
    await recordAccessDenied(db, reason).catch((error) => console.error("No se pudo apuntar el acceso denegado:", error));
    return json({ error: message }, status, cors);
  };
  const received = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!received) return deny("sin sesión", "Inicia sesión para acceder.", 401);
  const { data: { user }, error: authError } = await db.auth.getUser(received);
  if (authError || !user) return deny("sesión no válida", "Sesión caducada. Inicia sesión de nuevo.", 401);
  const { data: panelUsers, error: accessError } = await db.from("panel_users")
    .select("user_id").limit(2);
  if (accessError) { console.error("Error de acceso al panel:", accessError); return json({ error: "No se pudo comprobar el acceso." }, 503, cors); }
  if (!panelUsers?.some((panelUser) => panelUser.user_id === user.id)) {
    return deny(`cuenta sin acceso (${user.id})`, "Esta cuenta no tiene acceso al panel.", 403);
  }
  // Los datos del panel aún son un único espacio personal. Si se autorizan varias cuentas,
  // bloquear antes de leer o modificar nada evita que compartan finanzas y datos privados.
  if (panelUsers.length !== 1) {
    return json({ error: "Este panel está configurado para una sola cuenta. Antes de autorizar más usuarios hay que separar sus datos." }, 409, cors);
  }
  const url = new URL(request.url), resource = url.searchParams.get("resource") ?? "";
  try {
    if (await isOverRateLimit(db, user.id, request.method, resource)) {
      return json({ error: "Demasiadas peticiones seguidas. Espera un minuto y vuelve a intentarlo." }, 429, cors);
    }
  } catch (error) {
    console.error("Error al comprobar el límite de peticiones:", error);
    return json({ error: "No se pudo comprobar el acceso." }, 503, cors);
  }
  try {
    const now = new Date(), today = madridClock(now).localDate;
    if (request.method === "GET") {
      // Cada parte va por su lado: si una falla, llega su error y las demás se enseñan.
      if (resource === "dashboard") {
        const results = await Promise.allSettled(DASHBOARD_RESOURCES.map((name) => readResource(db, name, url.searchParams, now, today)));
        return json(Object.fromEntries(results.map((result, index) => {
          if (result.status === "fulfilled") return [DASHBOARD_RESOURCES[index], { data: result.value }];
          console.error(`Error del panel en ${DASHBOARD_RESOURCES[index]}:`, result.reason);
          return [DASHBOARD_RESOURCES[index], { error: describeErrorForClient(result.reason).message }];
        })), 200, cors);
      }
      const data = await readResource(db, resource, url.searchParams, now, today);
      if (data !== NOT_FOUND) return json(data, 200, cors);
    }
    if (request.method === "POST" && resource === "transcribe") return json({ text: await transcribeUpload(request) }, 200, cors);
    if (request.method === "POST") {
      const input = await body(request, resource === "chat" || resource === "memory" ? MAX_CHAT_BODY : MAX_BODY);
      if (resource === "chat_draft") {
        const parsed=parseChatInput(input);
        if(parsed.kind!=='message')throw new UserFacingError('Escribe lo que quieres preparar.');
        return json({proposal:await preparePanelDraft(parsed.message,now)},200,cors);
      }
      if (resource === "chat") return json(await replyToChat(db, parseChatInput(input), now), 200, cors);
      if (resource === "memory") { await saveMemory(db, input.content); return json({ ok: true }, 200, cors); }
      if (resource === "meal_ideas") {
        const hint = input.hint == null || input.hint === "" ? "" : validText(input.hint, 200);
        return json(mealPlanView(await proposeDishes(db, weekStartOf(today), hint)), 200, cors);
      }
      if (resource === "meal_plan") {
        const weekStart = weekStartOf(today);
        let added: string[] = [];
        if (input.action === "choose") await chooseDishes(db, weekStart, validIds(input.ids));
        else if (input.action === "cook") {
          if (typeof input.cooked !== "boolean") throw new UserFacingError("Respuesta no válida.");
          await setDishCooked(db, validId(input.id), input.cooked);
        } else if (input.action === "add_ingredients") {
          if (!Array.isArray(input.keys) || input.keys.length > 200 || input.keys.some((key) => typeof key !== "string")) {
            throw new UserFacingError("Ingredientes no válidos.");
          }
          added = await addIngredientsToShopping(db, weekStart, input.keys as string[]);
        } else throw new UserFacingError("Acción del menú no válida.");
        return json({ ...mealPlanView(await loadMealWeek(db, weekStart)), added }, 200, cors);
      }
      if (resource === "shopping_items" || resource === "notes") {
        const text=validText(input.text,resource==='notes'?1000:100);
        const {error}=resource==='notes'&&input.id!=null
          ?await db.from('notes').update({text}).eq('id',validId(input.id))
          :await db.from(resource).insert({text});
        if(error)throw error;
      } else if (resource === "birthdays") {
        const day = Number(input.day), month = Number(input.month), year = input.year === "" || input.year == null ? null : Number(input.year);
        if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > new Date(2024, month, 0).getDate() || year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) throw new UserFacingError("Fecha de cumpleaños no válida.");
        const { error } = await db.from(resource).insert({ name: validText(input.name, 100), day, month, year }); if (error) throw error;
      } else if (resource === "habits") {
        const scheduled_days = validScheduledDays(input.scheduled_days ?? [1, 2, 3, 4, 5, 6, 7]);
        const { error } = input.id == null
          ? await db.from(resource).insert({ name: validText(input.name, 100), scheduled_days })
          : await db.from(resource).update({ scheduled_days }).eq("id", validId(input.id));
        if (error) throw error;
      } else if (resource === "habit_checks") {
        const id = validId(input.habit_id); if (typeof input.done !== "boolean") throw new UserFacingError("Respuesta no válida.");
        const date = input.date ?? today;
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || date < addDaysToDate(today, -120) || date > today) {
          throw new UserFacingError("Solo puedes marcar días de los últimos cuatro meses.");
        }
        const { data, error } = await db.from("habits").select("id,name,scheduled_days").eq("id", id).single(); if (error || !data) throw new UserFacingError("Hábito no encontrado.");
        await recordHabit(db, data, date, input.done);
      } else if (resource === "reminders") {
        const reminder = parseReminderRequest({ text: input.text, local_datetime: input.local_datetime, repeat: input.repeat ?? null,
          advance_minutes: input.advance_minutes ?? null }, now);
        if (reminder.kind === "invalid") throw new UserFacingError(reminder.message);
        await saveReminder(db, reminder.text, reminder.remindAt, reminder.repeat, reminder.advanceMinutes);
      } else if (resource === "market_watchlist") {
        if (input.kind !== "stock" && input.kind !== "crypto" && input.kind !== "currency") throw new UserFacingError("Elige qué tipo es.");
        const asset = await followAsset(db, input.kind as MarketKind, String(input.query ?? ""));
        return json({ ok: true, asset }, 200, cors);
      } else if (resource === "price_watches") {
        return json({ ok: true, watch: await addWatch(db, input.query, input.max_price) }, 200, cors);
      } else if (resource === "expenses" || resource === "incomes") {
        const kind = resource === "expenses" ? "expense" : "income";
        await saveManualEntry(db, kind, parseManualEntry(input, kind, today));
      } else if (resource === "weight_entries") {
        const weight = parseWeightRequest({ action: "save", kg: input.kg, date: input.date }, today);
        if (weight.kind !== "weight_save") throw new UserFacingError(weight.kind === "invalid" ? weight.message : "Peso no válido.");
        await saveWeight(db, weight.date, weight.kg);
      } else if (resource === "budgets") {
        const intent = parseBudgetRequest({ action: "set", category: input.category, monthly_limit: input.monthly_limit });
        if (intent.kind === "invalid") throw new UserFacingError(intent.message);
        if (intent.kind !== "budget_set") throw new UserFacingError("Presupuesto no válido.");
        await saveBudget(db, intent.category, intent.monthlyLimit, now);
      } else if (resource === "calendar") {
        const intent = parseCalendarRequest({ action: "create", title: input.title, local_datetime: input.local_datetime, date: input.date, duration_minutes: input.duration_minutes });
        if (intent.kind === "invalid") throw new UserFacingError(intent.message);
        if (intent.kind === "calendar_list") throw new UserFacingError("Evento no válido.");
        await createEvent(db, intent);
      } else if (resource === "calendar_link") return json({ url: await createCalendarLink(db) }, 200, cors);
      else if (resource === "bank_link") return json({ url: await createBankLink(db, now) }, 200, cors);
      else return json({ error: "Recurso no encontrado." }, 404, cors);
      return json({ ok: true }, 200, cors);
    }
    if (request.method === "DELETE") {
      if (resource === "budgets") {
        const category = url.searchParams.get("category") ?? "";
        const intent = parseBudgetRequest({ action: "delete", category }); if (intent.kind !== "budget_delete") throw new UserFacingError("Categoría no válida.");
        await deleteBudget(db, category);
      } else if (resource === "bank_connection") {
        await disconnectBank(db, now);
      } else if (resource === "market_watchlist") {
        await unfollowAsset(db, validId(url.searchParams.get("id")));
      } else if (resource === "price_watches") {
        await removeWatch(db, validId(url.searchParams.get("id")));
      } else if (resource === "google_connection") {
        await disconnectCalendar(db);
      } else if (resource === "personal_data") {
        // Además de la confirmación del panel: una llamada a la API sin ella no borra nada.
        if (url.searchParams.get("confirm") !== "BORRAR") throw new UserFacingError("Falta confirmar el borrado.");
        const deleted = await deletePersonalData(db, parseCategories(url.searchParams.get("categories")));
        return json({ ok: true, deleted }, 200, cors);
      } else if (resource === "chat_messages") {
        await clearChatMessages(db);
      } else if (resource === "meal_plan") {
        await removeDish(db, validId(url.searchParams.get("id")));
      } else if (editable.has(resource)) {
        const id = validId(url.searchParams.get("id")); const { error } = await db.from(resource).delete().eq("id", id); if (error) throw error;
      } else return json({ error: "Recurso no encontrado." }, 404, cors);
      return json({ ok: true }, 200, cors);
    }
    return json({ error: "Operación no admitida." }, 405, cors);
  } catch (error) {
    console.error("Error del panel:", error);
    const { status, message } = describeErrorForClient(error);
    return json({ error: message }, status, cors);
  }
});

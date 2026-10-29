// Respuestas de las funciones que no dependen del banco: compra, notas, cumpleaños, hábitos, peso y agenda
// (calendario, recordatorios, hábitos y cumpleaños del día).
import { applyMealButton, type MealsRequest, replyToMeals } from "./meals.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  type BirthdayRequest,
  deleteBirthday,
  describeBirthdayDate,
  formatBirthdaysBetween,
  formatUpcomingBirthdays,
  listBirthdays,
  saveBirthday,
} from "./birthdays.ts";
import {
  CalendarNotConnectedError,
  type CalendarRequest,
  createEvent,
  describeCreatedEvent,
  formatEvents,
  listEvents,
} from "./calendar.ts";
import {
  applyConnectionButton,
  type ConnectionRequest,
  parseConnectionButton,
  replyToConnection,
} from "./connections.ts";
import { type BusRequest, replyToBus } from "./emt.ts";
import { type GmailRequest, replyToGmail } from "./gmail.ts";
import {
  createHabit,
  deleteHabit,
  describeAnswer,
  formatHabitList,
  formatHabitsForDay,
  formatHabitsForRange,
  HABIT_QUESTION_HOUR,
  type HabitRequest,
  listHabits,
  loadChecks,
  parseHabitButton,
  recordHabit,
} from "./habits.ts";
import { madridClock } from "./madrid-time.ts";
import { type MarketsRequest, replyToMarkets } from "./markets.ts";
import { applyMemoryButton, parseMemoryButton } from "./memory.ts";
import { type PricesRequest, replyToPrices } from "./prices.ts";
import type { MessageIntent } from "./message-intent.ts";
import {
  answerFromNotes,
  deleteMatchingNotes,
  describeDeletedNotes,
  formatNoteList,
  listNotes,
  type NoteRequest,
  saveNote,
} from "./notes.ts";
import { formatRemindersBetween, listRemindersBetween } from "./reminders.ts";
import { replyToWeather } from "./weather.ts";
import {
  addShoppingItems,
  clearShoppingList,
  describeAdded,
  describeRemoved,
  listShoppingItems,
  parseShoppingButton,
  removeShoppingItems,
  shoppingListReply,
  type ShoppingRequest,
  tickShoppingItem,
} from "./shopping.ts";
import type { BotReply } from "./telegram.ts";
import { matchByName } from "./text.ts";
import { describeSavedWeight, formatWeightTrend, listWeights, saveWeight, type WeightRequest } from "./weight.ts";

async function replyToShopping(db: SupabaseClient, request: ShoppingRequest): Promise<BotReply> {
  switch (request.kind) {
    case "shopping_add": {
      const added = await addShoppingItems(db, request.items);
      return shoppingListReply(await listShoppingItems(db), describeAdded(added, request.items));
    }
    case "shopping_remove": {
      const removed = await removeShoppingItems(db, request.items);
      return shoppingListReply(await listShoppingItems(db), describeRemoved(removed));
    }
    case "shopping_list":
      return shoppingListReply(await listShoppingItems(db));
    case "shopping_clear": {
      const count = await clearShoppingList(db);
      return { text: count === 0 ? "La lista ya estaba vacía." : `Lista vaciada (${count} cosas).` };
    }
    case "invalid":
      return { text: request.message };
  }
}

async function replyToNote(db: SupabaseClient, request: NoteRequest): Promise<string> {
  switch (request.kind) {
    case "note_save":
      await saveNote(db, request.text);
      return `Apuntado: «${request.text}».`;
    case "note_ask":
      return answerFromNotes(request.question, await listNotes(db));
    case "note_list":
      return formatNoteList(await listNotes(db));
    case "note_delete":
      return describeDeletedNotes(await deleteMatchingNotes(db, request.description));
    case "invalid":
      return request.message;
  }
}

async function replyToBirthday(db: SupabaseClient, request: BirthdayRequest, today: string): Promise<string> {
  switch (request.kind) {
    case "birthday_save":
      await saveBirthday(db, { name: request.name, month: request.month, day: request.day, year: request.year });
      return `Guardado: el cumpleaños de ${request.name} es el ${describeBirthdayDate(request)}. ` +
        "Te avisaré en el resumen de la mañana el día antes y el mismo día.";
    case "birthday_delete": {
      const birthday = matchByName(await listBirthdays(db), request.name);
      if (!birthday) return `No tengo guardado el cumpleaños de ${request.name}.`;
      await deleteBirthday(db, birthday.id);
      return `He borrado el cumpleaños de ${birthday.name}.`;
    }
    case "birthday_list":
      return formatUpcomingBirthdays(await listBirthdays(db), today);
    case "invalid":
      return request.message;
  }
}

async function replyToHabit(db: SupabaseClient, request: HabitRequest, today: string): Promise<string> {
  if (request.kind === "invalid") return request.message;
  if (request.kind === "habit_create") {
    await createHabit(db, request.name);
    return `Empiezo a seguir «${request.name}». Te preguntaré cada día a las ${HABIT_QUESTION_HOUR}:00.`;
  }
  const habits = await listHabits(db);
  if (request.kind === "habit_list") return formatHabitList(habits, await loadChecks(db, today), today);
  const habit = matchByName(habits, request.name);
  if (!habit) return `No sigues ningún hábito «${request.name}». Para empezar, dime «quiero ${request.name} cada día».`;
  if (request.kind === "habit_delete") {
    await deleteHabit(db, habit.id);
    return `Ya no sigo «${habit.name}».`;
  }
  return describeAnswer(habit, request.done, await recordHabit(db, habit, today, request.done));
}

async function describeEvents(db: SupabaseClient, dateFrom: string, dateTo: string): Promise<string> {
  try {
    return formatEvents(await listEvents(db, dateFrom, dateTo));
  } catch (error) {
    // Sin calendario conectado se enseña igualmente lo demás.
    if (!(error instanceof CalendarNotConnectedError)) throw error;
    return error.message;
  }
}

/** "¿Qué tengo hoy?": recordatorios, hábitos, cumpleaños y eventos del calendario de esos días. */
async function replyToAgenda(db: SupabaseClient, dateFrom: string, dateTo: string, today: string): Promise<string> {
  const sections = [formatRemindersBetween(await listRemindersBetween(db, dateFrom, dateTo))];
  const habits = await listHabits(db);
  // De un día se dice si ya está hecho; de varios, qué días toca cada rutina.
  sections.push(
    dateFrom === dateTo
      ? formatHabitsForDay(habits, await loadChecks(db, today), dateFrom, today)
      : formatHabitsForRange(habits, dateFrom, dateTo),
  );
  sections.push(formatBirthdaysBetween(await listBirthdays(db), dateFrom, dateTo));
  sections.push(await describeEvents(db, dateFrom, dateTo));
  return sections.filter(Boolean).join("\n\n");
}

async function replyToCalendar(db: SupabaseClient, request: CalendarRequest, today: string): Promise<string> {
  if (request.kind === "invalid") return request.message;
  if (request.kind === "calendar_list") return replyToAgenda(db, request.dateFrom, request.dateTo, today);
  try {
    await createEvent(db, request);
    return describeCreatedEvent(request);
  } catch (error) {
    // Sin calendario conectado no es un fallo: se explica cómo conectarlo.
    if (error instanceof CalendarNotConnectedError) return error.message;
    throw error;
  }
}

async function replyToWeight(db: SupabaseClient, request: WeightRequest): Promise<string> {
  if (request.kind === "invalid") return request.message;
  if (request.kind === "weight_list") return formatWeightTrend(await listWeights(db));
  await saveWeight(db, request.date, request.kg);
  return describeSavedWeight(await listWeights(db), request.date, request.kg);
}

const SHOPPING_KINDS = new Set(["shopping_add", "shopping_remove", "shopping_list", "shopping_clear"]);
const NOTE_KINDS = new Set(["note_save", "note_ask", "note_list", "note_delete"]);
const BIRTHDAY_KINDS = new Set(["birthday_save", "birthday_delete", "birthday_list"]);
const HABIT_KINDS = new Set(["habit_create", "habit_delete", "habit_log", "habit_list"]);
const CALENDAR_KINDS = new Set(["calendar_list", "calendar_create", "calendar_create_all_day"]);
const WEIGHT_KINDS = new Set(["weight_save", "weight_list"]);
const BUS_KINDS = new Set(["bus_arrivals", "bus_stop_save", "bus_stop_delete", "bus_stop_list"]);
const CONNECTION_KINDS = new Set(["connection_connect", "connection_disconnect"]);
const GMAIL_KINDS = new Set(["gmail_search", "gmail_block", "gmail_unblock", "gmail_filters"]);
const MARKETS_KINDS = new Set(["markets_list", "markets_quote", "markets_follow", "markets_unfollow"]);
const MEALS_KINDS = new Set(["meals_ideas", "meals_menu"]);
const PRICES_KINDS = new Set(["prices_search", "prices_watch", "prices_unwatch", "prices_list"]);

/** Responde a una intención de estas funciones, o devuelve null si no es de ninguna. */
export async function replyToPersonalIntent(
  db: SupabaseClient,
  intent: MessageIntent,
  now: Date,
): Promise<BotReply | null> {
  const today = madridClock(now).localDate;
  if (SHOPPING_KINDS.has(intent.kind)) return replyToShopping(db, intent as ShoppingRequest);
  if (NOTE_KINDS.has(intent.kind)) return { text: await replyToNote(db, intent as NoteRequest) };
  if (BIRTHDAY_KINDS.has(intent.kind)) return { text: await replyToBirthday(db, intent as BirthdayRequest, today) };
  if (HABIT_KINDS.has(intent.kind)) return { text: await replyToHabit(db, intent as HabitRequest, today) };
  if (CALENDAR_KINDS.has(intent.kind)) return { text: await replyToCalendar(db, intent as CalendarRequest, today) };
  if (WEIGHT_KINDS.has(intent.kind)) return { text: await replyToWeight(db, intent as WeightRequest) };
  if (GMAIL_KINDS.has(intent.kind)) return { text: await replyToGmail(db, intent as GmailRequest) };
  if (BUS_KINDS.has(intent.kind)) return { text: await replyToBus(db, intent as BusRequest, now) };
  if (CONNECTION_KINDS.has(intent.kind)) return replyToConnection(db, intent as ConnectionRequest, now);
  if (MARKETS_KINDS.has(intent.kind)) return { text: await replyToMarkets(db, intent as MarketsRequest, now) };
  if (PRICES_KINDS.has(intent.kind)) return { text: await replyToPrices(db, intent as PricesRequest) };
  if (intent.kind === "weather") return { text: await replyToWeather(intent, today) };
  if (MEALS_KINDS.has(intent.kind)) return replyToMeals(db, intent as MealsRequest, today);
  return null;
}

/** Resultado de pulsar un botón: cómo queda el mensaje y el aviso breve que muestra Telegram. */
export interface ButtonResult {
  message: BotReply;
  toast: string;
}

/** Botones de la compra, los hábitos, la memoria y las conexiones. Devuelve null si no es de estas funciones. */
export async function applyPersonalButton(
  db: SupabaseClient,
  data: string,
  now = new Date(),
): Promise<ButtonResult | null> {
  const mealResult = await applyMealButton(db, data, madridClock(now).localDate);
  if (mealResult) return mealResult;
  const shoppingItemId = parseShoppingButton(data);
  if (shoppingItemId !== null) {
    await tickShoppingItem(db, shoppingItemId);
    return { message: shoppingListReply(await listShoppingItems(db)), toast: "Tachado" };
  }
  const habitButton = parseHabitButton(data);
  if (habitButton) {
    const habit = (await listHabits(db)).find((candidate) => candidate.id === habitButton.habitId);
    if (!habit) return { message: { text: "Ya no sigues este hábito." }, toast: "Hábito borrado" };
    const streak = await recordHabit(db, habit, habitButton.date, habitButton.done);
    return { message: { text: describeAnswer(habit, habitButton.done, streak) }, toast: "Apuntado" };
  }
  const memoryButton = parseMemoryButton(data);
  if (memoryButton) return applyMemoryButton(db, memoryButton);
  const connectionButton = parseConnectionButton(data);
  if (connectionButton) return applyConnectionButton(db, connectionButton, now);
  return null;
}

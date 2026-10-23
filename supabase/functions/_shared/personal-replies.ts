// Respuestas de las funciones que no dependen del banco: compra, notas, cumpleaños, hábitos y agenda (calendario y
// recordatorios).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  type BirthdayRequest,
  deleteBirthday,
  describeBirthdayDate,
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
  createHabit,
  deleteHabit,
  describeAnswer,
  formatHabitList,
  HABIT_QUESTION_HOUR,
  type HabitRequest,
  listHabits,
  loadChecks,
  parseHabitButton,
  recordHabit,
} from "./habits.ts";
import { madridClock } from "./madrid-time.ts";
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

/** "¿Qué tengo hoy?": recordatorios y eventos del calendario de esos días. */
async function replyToAgenda(db: SupabaseClient, dateFrom: string, dateTo: string): Promise<string> {
  const reminders = formatRemindersBetween(await listRemindersBetween(db, dateFrom, dateTo));
  let events: string;
  try {
    events = formatEvents(await listEvents(db, dateFrom, dateTo));
  } catch (error) {
    // Sin calendario conectado se enseñan igualmente los recordatorios.
    if (!(error instanceof CalendarNotConnectedError)) throw error;
    events = error.message;
  }
  return `${reminders}\n\n${events}`;
}

async function replyToCalendar(db: SupabaseClient, request: CalendarRequest): Promise<string> {
  if (request.kind === "invalid") return request.message;
  if (request.kind === "calendar_list") return replyToAgenda(db, request.dateFrom, request.dateTo);
  try {
    await createEvent(db, request);
    return describeCreatedEvent(request);
  } catch (error) {
    // Sin calendario conectado no es un fallo: se explica cómo conectarlo.
    if (error instanceof CalendarNotConnectedError) return error.message;
    throw error;
  }
}

const SHOPPING_KINDS = new Set(["shopping_add", "shopping_remove", "shopping_list", "shopping_clear"]);
const NOTE_KINDS = new Set(["note_save", "note_ask", "note_list", "note_delete"]);
const BIRTHDAY_KINDS = new Set(["birthday_save", "birthday_delete", "birthday_list"]);
const HABIT_KINDS = new Set(["habit_create", "habit_delete", "habit_log", "habit_list"]);
const CALENDAR_KINDS = new Set(["calendar_list", "calendar_create", "calendar_create_all_day"]);

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
  if (CALENDAR_KINDS.has(intent.kind)) return { text: await replyToCalendar(db, intent as CalendarRequest) };
  return null;
}

/** Resultado de pulsar un botón: cómo queda el mensaje y el aviso breve que muestra Telegram. */
export interface ButtonResult {
  message: BotReply;
  toast: string;
}

/** Botones de la lista de la compra y de los hábitos. Devuelve null si el botón no es de estas funciones. */
export async function applyPersonalButton(db: SupabaseClient, data: string): Promise<ButtonResult | null> {
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
  return null;
}

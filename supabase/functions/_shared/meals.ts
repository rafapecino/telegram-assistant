// Menú de la semana: el asistente propone platos, tú eliges los que quieras y sus ingredientes, una vez revisados,
// pasan a la lista de la compra. No decide qué comes: solo da ideas.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { UserFacingError } from "./errors.ts";
import { askGroqForJson } from "./groq.ts";
import { addDaysToDate, weekdayOf } from "./madrid-time.ts";
import { loadMemory } from "./memory.ts";
import { addShoppingItems } from "./shopping.ts";
import type { BotReply, TelegramButton } from "./telegram.ts";
import { cleanTextList, comparable } from "./text.ts";

const IDEAS_PER_REQUEST = 8;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_INGREDIENTS = 15;
// Igual que una cosa de la lista de la compra, que admite hasta 100.
const MAX_INGREDIENT_LENGTH = 60;
const MAX_HINT_LENGTH = 200;
// Una semana normal no pasa de unas pocas tandas de ideas; el límite evita llenar la tabla sin querer.
const MAX_DISHES_PER_WEEK = 60;

/** Formato que el modelo debe devolver cuando el mensaje pide ideas de comidas (ver message-intent.ts). */
export const MEALS_INTENT_FORMAT =
  'Ideas de comidas o menú de la semana: {"intent": "meals", "action": "ideas", "hint": "algo rápido con pollo"}. ' +
  'action es "ideas" si pide ideas o propuestas de platos para comer o cenar (hint: lo que pida, como "rápido" o ' +
  '"sin horno"; vacío si no dice nada) y "menu" si quiere ver los platos que ya eligió esta semana.';

export type MealsRequest =
  | { kind: "meals_ideas"; hint: string }
  | { kind: "meals_menu" }
  | { kind: "invalid"; message: string };

export function parseMealsRequest(raw: unknown): MealsRequest {
  const candidate = raw as { action?: unknown; hint?: unknown } | null;
  if (candidate?.action === "menu") return { kind: "meals_menu" };
  if (candidate?.action !== "ideas") return { kind: "invalid", message: "No he entendido qué quieres del menú." };
  return { kind: "meals_ideas", hint: cleanHint(candidate.hint) };
}

function cleanHint(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, MAX_HINT_LENGTH) : "";
}

export interface DishIdea {
  name: string;
  description: string;
  ingredients: string[];
}

export interface PlannedDish extends DishIdea {
  id: number;
  chosen: boolean;
  cooked: boolean;
}

/** Valida las ideas del modelo: sin nombres repetidos, sin platos sin ingredientes y con los textos recortados. */
export function parseDishIdeas(raw: unknown): DishIdea[] {
  const dishes = (raw as { dishes?: unknown } | null)?.dishes;
  if (!Array.isArray(dishes)) return [];
  const seen = new Set<string>();
  const result: DishIdea[] = [];
  for (const dish of dishes) {
    const candidate = dish as { name?: unknown; description?: unknown; ingredients?: unknown } | null;
    if (typeof candidate?.name !== "string") continue;
    const name = candidate.name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
    const ingredients = cleanTextList(candidate.ingredients, MAX_INGREDIENT_LENGTH)
      .map((ingredient) => ingredient.toLowerCase())
      .slice(0, MAX_INGREDIENTS);
    if (!name || ingredients.length === 0 || seen.has(comparable(name))) continue;
    seen.add(comparable(name));
    const description = typeof candidate.description === "string"
      ? candidate.description.trim().replace(/\s+/g, " ").slice(0, MAX_DESCRIPTION_LENGTH)
      : "";
    result.push({ name, description, ingredients });
  }
  return result.slice(0, IDEAS_PER_REQUEST);
}

export function buildIdeasPrompt(memory: string, avoid: string[]): string {
  return [
    "Propones ideas de platos caseros para la semana a una persona que vive en España.",
    `Da ${IDEAS_PER_REQUEST} platos variados (carne, pescado, legumbres, verdura, pasta o arroz; alguno rápido) ` +
    "que se puedan cocinar en casa con ingredientes de un supermercado normal.",
    "No le digas qué debe comer: son opciones para que elija.",
    'Responde solo con JSON: {"dishes": [{"name": "Lentejas con chorizo", "description": "Guiso de cuchara, 40 min", ' +
    '"ingredients": ["lentejas", "chorizo", "zanahoria", "cebolla"]}]}.',
    "name: nombre corto del plato. description: una frase breve con el tipo de plato y el tiempo aproximado.",
    "ingredients: lo que habría que comprar, en minúscula, sin cantidades y sin básicos de despensa " +
    "(sal, aceite, agua, pimienta).",
    avoid.length ? `No repitas estos, que ya los ha visto: ${avoid.join(", ")}.` : "",
    memory
      ? `Lo que sabes de la persona (respeta alergias y lo que no le gusta; lo demás, solo como pista):\n${memory}`
      : "",
  ].filter(Boolean).join("\n");
}

export async function inventDishIdeas(memory: string, avoid: string[], hint: string): Promise<DishIdea[]> {
  const request = hint ? `Ideas de platos para esta semana. Preferencia: ${hint}.` : "Ideas de platos para esta semana.";
  // Temperatura alta: interesa variedad, y cada tanda debe ser distinta.
  const ideas = parseDishIdeas(await askGroqForJson(buildIdeasPrompt(memory, avoid), request, 0.9));
  if (ideas.length === 0) throw new UserFacingError("No he podido pensar platos ahora mismo. Prueba otra vez.");
  return ideas;
}

/** Lunes de la semana de una fecha sin hora (las semanas empiezan en lunes). */
export function weekStartOf(date: string): string {
  return addDaysToDate(date, -((weekdayOf(date) + 6) % 7));
}

interface WeekState {
  skipped: string[];
  resolved: string[];
}

export interface MealWeek extends WeekState {
  weekStart: string;
  dishes: PlannedDish[];
}

export async function loadMealWeek(db: SupabaseClient, weekStart: string): Promise<MealWeek> {
  const { data: dishes, error } = await db.from("meal_plan")
    .select("id, name, description, ingredients, chosen, cooked")
    .eq("week_start", weekStart)
    .order("id");
  if (error) throw new Error(`No se pudo leer el menú: ${error.message}`);
  const { data: state, error: stateError } = await db.from("meal_plan_weeks")
    .select("skipped, resolved")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (stateError) throw new Error(`No se pudo leer el menú: ${stateError.message}`);
  return { weekStart, dishes: dishes ?? [], skipped: state?.skipped ?? [], resolved: state?.resolved ?? [] };
}

async function saveWeekState(db: SupabaseClient, weekStart: string, state: WeekState): Promise<void> {
  const { error } = await db.from("meal_plan_weeks").upsert({ week_start: weekStart, ...state });
  if (error) throw new Error(`No se pudo guardar el menú: ${error.message}`);
}

/**
 * Cambia las ideas sin elegir de la semana por otras nuevas. Los platos ya elegidos se quedan, y las ideas nuevas no
 * repiten ninguno de los que ya ha visto.
 */
export async function proposeDishes(db: SupabaseClient, weekStart: string, hint: string): Promise<MealWeek> {
  const week = await loadMealWeek(db, weekStart);
  if (week.dishes.length >= MAX_DISHES_PER_WEEK) {
    throw new UserFacingError("Ya tienes muchas ideas esta semana. Quita algunas antes de pedir más.");
  }
  const ideas = await inventDishIdeas(await loadMemory(db), week.dishes.map((dish) => dish.name), hint);
  const { error: deleteError } = await db.from("meal_plan").delete().eq("week_start", weekStart).eq("chosen", false);
  if (deleteError) throw new Error(`No se pudieron cambiar las ideas: ${deleteError.message}`);
  const { error } = await db.from("meal_plan").insert(ideas.map((idea) => ({ week_start: weekStart, ...idea })));
  if (error) throw new Error(`No se pudieron guardar las ideas: ${error.message}`);
  return await loadMealWeek(db, weekStart);
}

/** Pasa al menú las ideas elegidas. Solo toca platos de esa semana. */
export async function chooseDishes(db: SupabaseClient, weekStart: string, ids: number[]): Promise<void> {
  if (ids.length === 0) throw new UserFacingError("Elige al menos un plato.");
  const { error } = await db.from("meal_plan").update({ chosen: true }).eq("week_start", weekStart).in("id", ids);
  if (error) throw new Error(`No se pudo guardar el menú: ${error.message}`);
}

export async function setDishChosen(db: SupabaseClient, id: number, chosen: boolean): Promise<void> {
  const { error } = await db.from("meal_plan").update({ chosen }).eq("id", id);
  if (error) throw new Error(`No se pudo guardar el menú: ${error.message}`);
}

export async function setDishCooked(db: SupabaseClient, id: number, cooked: boolean): Promise<void> {
  const { error } = await db.from("meal_plan").update({ cooked }).eq("id", id);
  if (error) throw new Error(`No se pudo guardar el menú: ${error.message}`);
}

export async function removeDish(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("meal_plan").delete().eq("id", id);
  if (error) throw new Error(`No se pudo quitar el plato: ${error.message}`);
}

export interface PendingIngredient {
  key: string;
  text: string;
  skipped: boolean;
}

/** Ingredientes de los platos elegidos que aún no has revisado, sin repetir aunque estén en varios platos. */
export function pendingIngredients(week: Pick<MealWeek, "dishes" | "skipped" | "resolved">): PendingIngredient[] {
  const resolved = new Set(week.resolved);
  const skipped = new Set(week.skipped);
  const pending = new Map<string, PendingIngredient>();
  for (const dish of week.dishes.filter((dish) => dish.chosen)) {
    for (const text of dish.ingredients) {
      const key = comparable(text);
      if (!key || resolved.has(key) || pending.has(key)) continue;
      pending.set(key, { key, text, skipped: skipped.has(key) });
    }
  }
  return [...pending.values()];
}

/**
 * Añade a la lista de la compra los ingredientes pendientes que pidas (por su `key`) y da por revisados todos los
 * pendientes: los que no pidas es porque ya los tienes. Devuelve lo que se ha añadido de verdad.
 */
export async function addIngredientsToShopping(
  db: SupabaseClient,
  weekStart: string,
  keys: string[],
): Promise<string[]> {
  const week = await loadMealWeek(db, weekStart);
  const pending = pendingIngredients(week);
  const wanted = new Set(keys);
  const added = await addShoppingItems(db, pending.filter((item) => wanted.has(item.key)).map((item) => item.text));
  await saveWeekState(db, weekStart, { skipped: [], resolved: [...week.resolved, ...pending.map((item) => item.key)] });
  return added;
}

/** Marca o desmarca un ingrediente como «ya lo tengo» mientras se revisa desde Telegram. */
async function toggleSkipped(db: SupabaseClient, week: MealWeek, key: string): Promise<void> {
  const skipped = week.skipped.includes(key) ? week.skipped.filter((item) => item !== key) : [...week.skipped, key];
  await saveWeekState(db, week.weekStart, { skipped, resolved: week.resolved });
}

// --- Telegram ---------------------------------------------------------------------------------------------------

/** Huella corta de un ingrediente para el botón: Telegram limita los datos de cada botón a 64 bytes. */
export function ingredientToken(key: string): string {
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type MealButton =
  | { action: "pick"; id: number }
  | { action: "more" }
  | { action: "done" }
  | { action: "ingredient"; token: string }
  | { action: "add" };

export function parseMealButton(data: string): MealButton | null {
  const pick = data.match(/^meal:pick:(\d+)$/);
  if (pick) return { action: "pick", id: Number(pick[1]) };
  const ingredient = data.match(/^meal:ing:([0-9a-f]{8})$/);
  if (ingredient) return { action: "ingredient", token: ingredient[1] };
  if (data === "meal:more") return { action: "more" };
  if (data === "meal:done") return { action: "done" };
  if (data === "meal:add") return { action: "add" };
  return null;
}

/** Las ideas con un botón por plato para elegirlo, y otros para pedir más o pasar a los ingredientes. */
export function ideasReply(dishes: PlannedDish[], intro = ""): BotReply {
  if (dishes.length === 0) return { text: "No hay ideas para esta semana. Pídeme «ideas para comer»." };
  const lines = dishes.map((dish, index) =>
    `${index + 1}. ${dish.chosen ? "✅ " : ""}${dish.name}${dish.description ? ` — ${dish.description}` : ""}`
  );
  const buttons: TelegramButton[][] = dishes.map((dish) => [
    { text: `${dish.chosen ? "☑" : "☐"} ${dish.name}`, callback_data: `meal:pick:${dish.id}` },
  ]);
  buttons.push([
    { text: "🔄 Otras ideas", callback_data: "meal:more" },
    { text: "✅ Listo", callback_data: "meal:done" },
  ]);
  return {
    text: `${intro ? `${intro}\n\n` : ""}🍽️ Ideas para esta semana. Toca los platos que te apetezcan y luego ` +
      `«Listo» para revisar los ingredientes.\n\n${lines.join("\n")}`,
    buttons,
  };
}

/** Los ingredientes pendientes: tocar uno lo marca como «ya lo tengo»; el último botón los pasa a la lista. */
export function ingredientsReply(pending: PendingIngredient[]): BotReply {
  if (pending.length === 0) {
    return { text: "🛒 No hay ingredientes nuevos que revisar: ya tienes todo lo de tus platos en la lista." };
  }
  const toBuy = pending.filter((item) => !item.skipped).length;
  const buttons: TelegramButton[][] = pending.map((item) => [{
    text: item.skipped ? `☐ ${item.text} (lo tengo)` : `☑ ${item.text}`,
    callback_data: `meal:ing:${ingredientToken(item.key)}`,
  }]);
  buttons.push([{ text: `🛒 Añadir ${toBuy} a la compra`, callback_data: "meal:add" }]);
  return {
    text: "🛒 Ingredientes de tus platos. Toca lo que ya tengas en casa para quitarlo y luego «Añadir a la compra».",
    buttons,
  };
}

export function menuReply(dishes: PlannedDish[]): string {
  const chosen = dishes.filter((dish) => dish.chosen);
  if (chosen.length === 0) return "Aún no has elegido platos esta semana. Pídeme «ideas para comer» y elige.";
  const lines = chosen.map((dish) => `${dish.cooked ? "✔️" : "•"} ${dish.name}`);
  return `🍽️ Tu menú de esta semana:\n${lines.join("\n")}`;
}

export async function replyToMeals(db: SupabaseClient, request: MealsRequest, today: string): Promise<BotReply> {
  if (request.kind === "invalid") return { text: request.message };
  const weekStart = weekStartOf(today);
  if (request.kind === "meals_menu") return { text: menuReply((await loadMealWeek(db, weekStart)).dishes) };
  const week = await proposeDishes(db, weekStart, request.hint);
  return ideasReply(week.dishes);
}

export interface MealButtonResult {
  message: BotReply;
  toast: string;
}

/** Aplica un botón del menú. Devuelve null si el botón no es del menú. */
export async function applyMealButton(db: SupabaseClient, data: string, today: string): Promise<MealButtonResult | null> {
  const button = parseMealButton(data);
  if (!button) return null;
  const weekStart = weekStartOf(today);
  if (button.action === "more") {
    const week = await proposeDishes(db, weekStart, "");
    return { message: ideasReply(week.dishes), toast: "Ideas nuevas" };
  }
  const week = await loadMealWeek(db, weekStart);
  if (button.action === "pick") {
    const dish = week.dishes.find((candidate) => candidate.id === button.id);
    if (!dish) return { message: ideasReply(week.dishes), toast: "Esa idea ya no está" };
    await setDishChosen(db, dish.id, !dish.chosen);
    const updated = await loadMealWeek(db, weekStart);
    return { message: ideasReply(updated.dishes), toast: dish.chosen ? "Quitado del menú" : "Añadido al menú" };
  }
  if (button.action === "done") {
    if (!week.dishes.some((dish) => dish.chosen)) return { message: ideasReply(week.dishes), toast: "Elige algún plato" };
    return { message: ingredientsReply(pendingIngredients(week)), toast: "Revisa los ingredientes" };
  }
  if (button.action === "ingredient") {
    const item = pendingIngredients(week).find((candidate) => ingredientToken(candidate.key) === button.token);
    if (item) await toggleSkipped(db, week, item.key);
    return { message: ingredientsReply(pendingIngredients(await loadMealWeek(db, weekStart))), toast: "Apuntado" };
  }
  const toBuy = pendingIngredients(week).filter((item) => !item.skipped).map((item) => item.key);
  const added = await addIngredientsToShopping(db, weekStart, toBuy);
  return {
    message: {
      text: added.length
        ? `🛒 Añadido a la lista de la compra: ${added.join(", ")}.\n\n${menuReply(week.dishes)}`
        : `🛒 No he añadido nada nuevo: ya estaba todo en la lista o lo tienes en casa.\n\n${menuReply(week.dishes)}`,
    },
    toast: "Lista actualizada",
  };
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import type { BotReply } from "./telegram.ts";
import { cleanTextList, comparable } from "./text.ts";

const MAX_ITEM_LENGTH = 100;
const MAX_ITEMS_PER_MESSAGE = 30;

/** Formato que el modelo debe devolver cuando el mensaje habla de la lista de la compra (ver message-intent.ts). */
export const SHOPPING_INTENT_FORMAT =
  'Lista de la compra: {"intent": "shopping", "action": "add", "items": ["leche", "pan"]}. action es "add" para ' +
  'añadir, "remove" para quitar, "list" para ver la lista y "clear" para vaciarla. items son las cosas, en ' +
  "minúscula y con la cantidad solo si la dice; vacío en list y clear.";

export type ShoppingRequest =
  | { kind: "shopping_add"; items: string[] }
  | { kind: "shopping_remove"; items: string[] }
  | { kind: "shopping_list" }
  | { kind: "shopping_clear" }
  | { kind: "invalid"; message: string };

export function parseShoppingRequest(raw: unknown): ShoppingRequest {
  const candidate = raw as { action?: unknown; items?: unknown } | null;
  if (candidate?.action === "list") return { kind: "shopping_list" };
  if (candidate?.action === "clear") return { kind: "shopping_clear" };
  const items = cleanTextList(candidate?.items, MAX_ITEM_LENGTH).slice(0, MAX_ITEMS_PER_MESSAGE);
  if (candidate?.action !== "add" && candidate?.action !== "remove") {
    return { kind: "invalid", message: "No he entendido qué hacer con la lista de la compra." };
  }
  if (items.length === 0) return { kind: "invalid", message: "No he entendido qué cosas son." };
  return candidate.action === "add" ? { kind: "shopping_add", items } : { kind: "shopping_remove", items };
}

export interface ShoppingItem {
  id: number;
  text: string;
}

export async function listShoppingItems(db: SupabaseClient): Promise<ShoppingItem[]> {
  const { data, error } = await db.from("shopping_items").select("id, text").order("created_at");
  if (error) throw new Error(`No se pudo leer la lista de la compra: ${error.message}`);
  return data;
}

/** Añade lo que no esté ya en la lista (sin distinguir mayúsculas ni tildes). Devuelve lo añadido. */
export async function addShoppingItems(db: SupabaseClient, items: string[]): Promise<string[]> {
  const existing = new Set((await listShoppingItems(db)).map((item) => comparable(item.text)));
  const added = items.filter((item) => !existing.has(comparable(item)));
  if (added.length === 0) return [];
  const { error } = await db.from("shopping_items").insert(added.map((text) => ({ text })));
  if (error) throw new Error(`No se pudo añadir a la lista de la compra: ${error.message}`);
  return added;
}

/** Quita de la lista lo que coincida (sin distinguir mayúsculas ni tildes). Devuelve lo quitado. */
export async function removeShoppingItems(db: SupabaseClient, items: string[]): Promise<string[]> {
  const wanted = new Set(items.map(comparable));
  const matches = (await listShoppingItems(db)).filter((item) => wanted.has(comparable(item.text)));
  if (matches.length === 0) return [];
  const { error } = await db.from("shopping_items").delete().in("id", matches.map((item) => item.id));
  if (error) throw new Error(`No se pudo quitar de la lista de la compra: ${error.message}`);
  return matches.map((item) => item.text);
}

/** Vacía la lista y devuelve cuántas cosas tenía. */
export async function clearShoppingList(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from("shopping_items").delete().gt("id", 0).select("id");
  if (error) throw new Error(`No se pudo vaciar la lista de la compra: ${error.message}`);
  return data.length;
}

/** Tacha (borra) una cosa de la lista al pulsar su botón. */
export async function tickShoppingItem(db: SupabaseClient, itemId: number): Promise<void> {
  const { error } = await db.from("shopping_items").delete().eq("id", itemId);
  if (error) throw new Error(`No se pudo tachar de la lista de la compra: ${error.message}`);
}

/** La lista con un botón por cosa: al pulsarlo se tacha. `intro` va delante, por ejemplo "Añadido: leche.". */
export function shoppingListReply(items: ShoppingItem[], intro = ""): BotReply {
  const prefix = intro ? `${intro}\n\n` : "";
  if (items.length === 0) return { text: `${prefix}La lista de la compra está vacía.` };
  return {
    text: `${prefix}🛒 Lista de la compra (${items.length}). Toca lo que ya tengas para tacharlo.`,
    buttons: items.map((item) => [{ text: `☐ ${item.text}`, callback_data: `shop:done:${item.id}` }]),
  };
}

/** Lee el botón de una cosa de la lista. Devuelve su id, o null si no es de la lista. */
export function parseShoppingButton(data: string): number | null {
  const match = data.match(/^shop:done:(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function describeAdded(added: string[], requested: string[]): string {
  if (added.length === 0) return "Eso ya estaba en la lista.";
  const repeated = requested.length - added.length;
  return `Añadido: ${added.join(", ")}.${repeated > 0 ? ` (${repeated} ya estaba${repeated > 1 ? "n" : ""})` : ""}`;
}

export function describeRemoved(removed: string[]): string {
  return removed.length === 0 ? "No he encontrado eso en la lista." : `Quitado: ${removed.join(", ")}.`;
}

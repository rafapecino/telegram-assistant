import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  addShoppingItems,
  describeAdded,
  parseShoppingButton,
  parseShoppingRequest,
  removeShoppingItems,
  shoppingListReply,
} from "./shopping.ts";
import { fakeDb } from "./testing.ts";

const LIST = [{ id: 1, text: "leche" }, { id: 2, text: "plátanos" }];

function listDb() {
  return fakeDb((query) => query.some((step) => step.startsWith("select(")) ? { data: LIST } : {});
}

Deno.test("entiende añadir, quitar, ver y vaciar la lista", () => {
  assertEquals(parseShoppingRequest({ action: "add", items: ["pan", "huevos"] }), {
    kind: "shopping_add",
    items: ["pan", "huevos"],
  });
  assertEquals(parseShoppingRequest({ action: "remove", items: ["pan"] }).kind, "shopping_remove");
  assertEquals(parseShoppingRequest({ action: "list", items: [] }), { kind: "shopping_list" });
  assertEquals(parseShoppingRequest({ action: "clear" }), { kind: "shopping_clear" });
  assertEquals(parseShoppingRequest({ action: "add", items: [] }).kind, "invalid");
  assertEquals(parseShoppingRequest({ action: "comprar", items: ["pan"] }).kind, "invalid");
});

Deno.test("no añade lo que ya está en la lista aunque cambien mayúsculas o tildes", async () => {
  const { db, queries } = listDb();
  assertEquals(await addShoppingItems(db, ["Leche", "platanos", "pan"]), ["pan"]);
  assertEquals(queries[1], ['from("shopping_items")', 'insert([{"text":"pan"}])']);
  assertEquals(describeAdded(["pan"], ["Leche", "platanos", "pan"]), "Añadido: pan. (2 ya estaban)");
});

Deno.test("quita lo que coincide aunque cambien mayúsculas o tildes", async () => {
  const { db, queries } = listDb();
  assertEquals(await removeShoppingItems(db, ["Platanos", "yogures"]), ["plátanos"]);
  assertEquals(queries[1], ['from("shopping_items")', "delete()", 'in("id", [2])']);
});

Deno.test("la lista lleva un botón por cosa para tacharla, y vacía no lleva botones", () => {
  const reply = shoppingListReply(LIST, "Añadido: leche.");
  assertEquals(reply.text, "Añadido: leche.\n\n🛒 Lista de la compra (2). Toca lo que ya tengas para tacharlo.");
  assertEquals(reply.buttons, [
    [{ text: "☐ leche", callback_data: "shop:done:1" }],
    [{ text: "☐ plátanos", callback_data: "shop:done:2" }],
  ]);
  assertEquals(shoppingListReply([]), { text: "La lista de la compra está vacía." });
  assertEquals(parseShoppingButton("shop:done:2"), 2);
  assertEquals(parseShoppingButton("habit:yes:2:2026-10-22"), null);
});

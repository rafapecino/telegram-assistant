import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  addIngredientsToShopping,
  applyMealButton,
  buildIdeasPrompt,
  ideasReply,
  ingredientsReply,
  ingredientToken,
  menuReply,
  parseDishIdeas,
  parseMealButton,
  parseMealsRequest,
  pendingIngredients,
  type PlannedDish,
  weekStartOf,
} from "./meals.ts";
import { parseMessageIntent } from "./message-intent.ts";
import { fakeDb } from "./testing.ts";

const NOW = new Date("2026-10-29T10:00:00Z");

function dish(id: number, name: string, ingredients: string[], chosen = false, cooked = false): PlannedDish {
  return { id, name, description: "", ingredients, chosen, cooked };
}

Deno.test("entiende pedir ideas de platos y ver el menú", () => {
  assertEquals(parseMealsRequest({ action: "ideas", hint: "  algo   rápido " }), { kind: "meals_ideas", hint: "algo rápido" });
  assertEquals(parseMealsRequest({ action: "ideas" }), { kind: "meals_ideas", hint: "" });
  assertEquals(parseMealsRequest({ action: "menu" }), { kind: "meals_menu" });
  assertEquals(parseMealsRequest({ action: "cocinar" }).kind, "invalid");
  assertEquals(parseMessageIntent({ intent: "meals", action: "ideas", hint: "" }, NOW).kind, "meals_ideas");
});

Deno.test("valida las ideas del modelo: sin repetidos, sin platos vacíos y con ingredientes en minúscula", () => {
  const ideas = parseDishIdeas({
    dishes: [
      { name: " Lentejas  con chorizo ", description: "Guiso, 40 min", ingredients: ["Lentejas", "chorizo", "lentejas"] },
      { name: "lentejas con chorizo", description: "Repetido", ingredients: ["lentejas"] },
      { name: "Sin ingredientes", ingredients: [] },
      { name: 42, ingredients: ["pan"] },
      { name: "Tortilla", ingredients: ["huevos", "patatas"] },
    ],
  });
  assertEquals(ideas, [
    { name: "Lentejas con chorizo", description: "Guiso, 40 min", ingredients: ["lentejas", "chorizo"] },
    { name: "Tortilla", description: "", ingredients: ["huevos", "patatas"] },
  ]);
  assertEquals(parseDishIdeas({ nada: true }), []);
  assertEquals(parseDishIdeas(null), []);
});

Deno.test("el prompt evita repetir platos y respeta la memoria", () => {
  const prompt = buildIdeasPrompt("No le gusta el pescado.", ["Tortilla"]);
  assertEquals(prompt.includes("No repitas estos, que ya los ha visto: Tortilla."), true);
  assertEquals(prompt.includes("No le gusta el pescado."), true);
  assertEquals(buildIdeasPrompt("", []).includes("No repitas"), false);
});

Deno.test("la semana empieza en lunes", () => {
  assertEquals(weekStartOf("2026-10-29"), "2026-10-26"); // jueves
  assertEquals(weekStartOf("2026-10-26"), "2026-10-26"); // lunes
  assertEquals(weekStartOf("2026-11-01"), "2026-10-26"); // domingo
});

Deno.test("junta los ingredientes de los platos elegidos sin repetir ni volver a pedir los revisados", () => {
  const week = {
    dishes: [
      dish(1, "Tortilla", ["huevos", "patatas", "cebolla"], true),
      dish(2, "Lentejas", ["lentejas", "Cebolla", "zanahoria"], true),
      dish(3, "Paella", ["arroz", "gambas"]),
    ],
    skipped: ["zanahoria"],
    resolved: ["patatas"],
  };
  assertEquals(pendingIngredients(week), [
    { key: "huevos", text: "huevos", skipped: false },
    { key: "cebolla", text: "cebolla", skipped: false },
    { key: "lentejas", text: "lentejas", skipped: false },
    { key: "zanahoria", text: "zanahoria", skipped: true },
  ]);
});

Deno.test("los botones caben en los 64 bytes de Telegram y se leen de vuelta", () => {
  const reply = ideasReply([dish(123456789, "Un plato con un nombre bastante largo de verdad", ["pan"])]);
  const ingredients = ingredientsReply([{ key: "pimiento rojo asado", text: "pimiento rojo asado", skipped: false }]);
  for (const button of [...reply.buttons!, ...ingredients.buttons!].flat()) {
    assertEquals(new TextEncoder().encode(button.callback_data).length <= 64, true);
  }
  assertEquals(parseMealButton("meal:pick:123456789"), { action: "pick", id: 123456789 });
  assertEquals(parseMealButton(`meal:ing:${ingredientToken("pimiento rojo asado")}`), {
    action: "ingredient",
    token: ingredientToken("pimiento rojo asado"),
  });
  assertEquals(parseMealButton("meal:more"), { action: "more" });
  assertEquals(parseMealButton("meal:done"), { action: "done" });
  assertEquals(parseMealButton("meal:add"), { action: "add" });
  assertEquals(parseMealButton("shop:done:1"), null);
  assertEquals(ingredientToken("cebolla") === ingredientToken("cebolleta"), false);
});

Deno.test("el menú enseña solo los platos elegidos y marca los cocinados", () => {
  assertEquals(
    menuReply([dish(1, "Tortilla", ["huevos"], true, true), dish(2, "Lentejas", ["lentejas"], true), dish(3, "Paella", ["arroz"])]),
    "🍽️ Tu menú de esta semana:\n✔️ Tortilla\n• Lentejas",
  );
  assertEquals(menuReply([dish(3, "Paella", ["arroz"])]).startsWith("Aún no has elegido"), true);
});

function weekDb(dishes: PlannedDish[], state = { skipped: [] as string[], resolved: [] as string[] }, shopping: string[] = []) {
  return fakeDb((query) => {
    if (query[0] === 'from("meal_plan")' && query.some((step) => step.startsWith("select("))) return { data: dishes };
    if (query[0] === 'from("meal_plan_weeks")' && query.some((step) => step.startsWith("select("))) {
      return { data: state };
    }
    if (query[0] === 'from("shopping_items")' && query.some((step) => step.startsWith("select("))) {
      return { data: shopping.map((text, index) => ({ id: index + 1, text })) };
    }
    return {};
  });
}

Deno.test("añade a la compra solo lo que pides y da por revisado el resto", async () => {
  const { db, queries } = weekDb([dish(1, "Tortilla", ["huevos", "patatas", "cebolla"], true)], undefined, ["Huevos"]);
  const added = await addIngredientsToShopping(db, "2026-10-26", ["huevos", "patatas"]);
  assertEquals(added, ["patatas"]); // los huevos ya estaban en la lista
  assertEquals(queries.find((query) => query.some((step) => step.startsWith("insert(")))?.at(-1), 'insert([{"text":"patatas"}])');
  assertEquals(
    queries.find((query) => query.some((step) => step.startsWith("upsert(")))?.at(-1),
    'upsert({"week_start":"2026-10-26","skipped":[],"resolved":["huevos","patatas","cebolla"]})',
  );
});

Deno.test("en Telegram, «Listo» sin platos elegidos pide elegir antes", async () => {
  const { db } = weekDb([dish(1, "Tortilla", ["huevos"])]);
  const result = await applyMealButton(db, "meal:done", "2026-10-29");
  assertEquals(result?.toast, "Elige algún plato");
  assertEquals(await applyMealButton(db, "shop:done:1", "2026-10-29"), null);
});

Deno.test("en Telegram, tocar un ingrediente lo marca como «lo tengo»", async () => {
  const { db, queries } = weekDb([dish(1, "Tortilla", ["huevos", "patatas"], true)]);
  await applyMealButton(db, `meal:ing:${ingredientToken("patatas")}`, "2026-10-29");
  assertEquals(
    queries.find((query) => query.some((step) => step.startsWith("upsert(")))?.at(-1),
    'upsert({"week_start":"2026-10-26","skipped":["patatas"],"resolved":[]})',
  );
});

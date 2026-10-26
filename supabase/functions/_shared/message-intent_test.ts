import { assertEquals } from "jsr:@std/assert@1.0.19";
import { parseMessageIntent } from "./message-intent.ts";

const NOW = new Date("2026-10-21T10:00:00Z");

Deno.test("envía cada intención a la validación de su funcionalidad", () => {
  assertEquals(
    parseMessageIntent({ intent: "reminder", text: "llamar", local_datetime: "2026-10-22T17:00" }, NOW).kind,
    "reminder",
  );
  assertEquals(
    parseMessageIntent(
      { intent: "expenses_query", date_from: "2026-10-19", date_to: "2026-10-21", category: null },
      NOW,
    ),
    { kind: "expenses_query", query: { dateFrom: "2026-10-19", dateTo: "2026-10-21", category: null } },
  );
});

Deno.test("una intención desconocida o una respuesta rara no hacen nada", () => {
  assertEquals(parseMessageIntent({ intent: "unknown" }, NOW), { kind: "unknown" });
  assertEquals(parseMessageIntent({ intent: "borrar_todo" }, NOW), { kind: "unknown" });
  assertEquals(parseMessageIntent(null, NOW), { kind: "unknown" });
});

Deno.test("los presupuestos y el balance van a su propia validación", () => {
  assertEquals(
    parseMessageIntent({ intent: "budget", action: "set", category: "Ocio", monthly_limit: 50 }, NOW),
    { kind: "budget_set", category: "Ocio", monthlyLimit: 50 },
  );
  assertEquals(
    parseMessageIntent({ intent: "balance_query", date_from: "2026-10-01", date_to: "2026-10-21" }, NOW),
    { kind: "balance_query", dateFrom: "2026-10-01", dateTo: "2026-10-21" },
  );
});

Deno.test("las funciones personales van a su propia validación", () => {
  assertEquals(parseMessageIntent({ intent: "shopping", action: "add", items: ["pan"] }, NOW), {
    kind: "shopping_add",
    items: ["pan"],
  });
  assertEquals(parseMessageIntent({ intent: "note", action: "list" }, NOW), { kind: "note_list" });
  // El año de nacimiento se valida contra el año en curso en Madrid.
  assertEquals(
    parseMessageIntent({ intent: "birthday", action: "save", name: "Ana", month: 1, day: 2, year: 2027 }, NOW).kind,
    "invalid",
  );
  assertEquals(parseMessageIntent({ intent: "habit", action: "list" }, NOW), { kind: "habit_list" });
  assertEquals(
    parseMessageIntent({ intent: "calendar", action: "list", date_from: "2026-10-22", date_to: "2026-10-22" }, NOW)
      .kind,
    "calendar_list",
  );
});

Deno.test("el correo y el autobús van a su propia validación", () => {
  assertEquals(parseMessageIntent({ intent: "gmail", query: "from:hacienda" }, NOW), {
    kind: "gmail_search",
    query: "from:hacienda",
  });
  assertEquals(parseMessageIntent({ intent: "bus", action: "list" }, NOW), { kind: "bus_stop_list" });
});

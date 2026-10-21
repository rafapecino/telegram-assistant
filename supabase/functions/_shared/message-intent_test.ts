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

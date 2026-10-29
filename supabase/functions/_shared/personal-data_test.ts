import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  DATA_CATEGORIES,
  deletePersonalData,
  exportPersonalData,
  parseCategories,
  summarizePersonalData,
} from "./personal-data.ts";
import { fakeDb } from "./testing.ts";

const NOW = new Date("2026-10-28T10:00:00Z");

Deno.test("solo acepta categorías conocidas y al menos una", () => {
  assertEquals(parseCategories("notes, habits,notes"), ["notes", "habits"]);
  assertThrows(() => parseCategories(""), Error, "Elige qué datos");
  assertThrows(() => parseCategories(null), Error, "Elige qué datos");
  // Ni tablas sueltas ni las conexiones: así no se puede borrar algo que no esté en la lista del panel.
  assertThrows(() => parseCategories("notes,panel_users"), Error, "Elige qué datos");
  assertThrows(() => parseCategories("google_connections"), Error, "Elige qué datos");
});

Deno.test("las conexiones y los datos de control no están en ninguna categoría", () => {
  const tables = Object.values(DATA_CATEGORIES).flatMap((category) => category.tables.map((table) => table.name));
  for (const table of ["google_connections", "bank_sessions", "panel_users", "panel_request_counts"]) {
    assertEquals(tables.includes(table), false, table);
  }
});

Deno.test("borra cada tabla entera y deja que la base de datos borre el historial con su hábito", async () => {
  const { db, queries } = fakeDb(() => ({}));
  assertEquals(await deletePersonalData(db, ["habits", "email_filters"]), [
    "Hábitos y su historial",
    "Filtros del correo",
  ]);
  assertEquals(queries, [
    ['from("habits")', "delete()", 'not("id", "is", null)'],
    ['from("email_filters")', "delete()", 'not("sender", "is", null)'],
  ]);
});

Deno.test("cuenta los registros de cada categoría sin contar dos veces las tablas hijas", async () => {
  const { db, queries } = fakeDb(() => ({ count: 3 }));
  const summary = await summarizePersonalData(db);
  assertEquals(summary.find((category) => category.id === "finances"), {
    id: "finances",
    label: "Gastos, ingresos y presupuestos",
    count: 15,
  });
  assertEquals(queries.some((query) => query[0] === 'from("habit_checks")'), false);
});

Deno.test("la exportación trae todas las filas, página a página", async () => {
  const fullPage = Array.from({ length: 1000 }, (_, id) => ({ id }));
  const { db, queries } = fakeDb((query) => {
    if (query[0] !== 'from("expenses")') return { data: [] };
    return { data: query[2] === "range(0, 999)" ? fullPage : [{ id: 1000 }] };
  });
  const exported = await exportPersonalData(db, NOW) as { exported_at: string; tables: Record<string, unknown[]> };
  assertEquals(exported.exported_at, NOW.toISOString());
  assertEquals(exported.tables.expenses.length, 1001);
  assertEquals(exported.tables.habit_checks, []);
  assertEquals(queries.filter((query) => query[0] === 'from("expenses")').length, 2);
});

import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.19";
import { likePattern, parseMovementFilters, searchEverything, searchMovements } from "./search.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const TODAY = "2026-10-28";
const params = (values: Record<string, string>) => new URLSearchParams(values);

Deno.test("los comodines de ilike se buscan tal cual", () => {
  assertEquals(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
});

Deno.test("valida categoría, fechas y longitud del texto", () => {
  assertEquals(parseMovementFilters(params({ q: " café ", category: "Restaurantes", from: "2026-10-01", to: TODAY })), {
    text: "café",
    category: "Restaurantes",
    from: "2026-10-01",
    to: TODAY,
  });
  assertEquals(parseMovementFilters(params({})), { text: "", category: "", from: null, to: null });
  assertThrows(() => parseMovementFilters(params({ category: "Inventada" })), Error, "Categoría");
  assertThrows(() => parseMovementFilters(params({ from: "28/10/2026" })), Error, "desde");
  assertThrows(() => parseMovementFilters(params({ from: TODAY, to: "2026-10-01" })), Error, "posterior");
  assertThrows(() => parseMovementFilters(params({ from: "2024-01-01", to: TODAY })), Error, "dos años");
  assertThrows(() => parseMovementFilters(params({ q: "x".repeat(101) })), Error, "100");
});

Deno.test("filtra gastos e ingresos en la base de datos y los mezcla por fecha", async () => {
  const { db, queries } = fakeDb((query) =>
    query[0] === 'from("expenses")'
      ? { data: [{ id: 1, booking_date: "2026-10-20", description: "Café", amount: "2.50", category: "Restaurantes" }] }
      : { data: [{ id: 7, booking_date: "2026-10-25", description: "Bizum café", amount: "10" }] }
  );
  const found = await searchMovements(db, { text: "café", category: "", from: "2026-10-01", to: TODAY });
  assertEquals(found.map((movement) => [movement.kind, movement.amount, movement.category]), [
    ["income", 10, "Ingresos"],
    ["expense", 2.5, "Restaurantes"],
  ]);
  assertEquals(queries[0], [
    'from("expenses")',
    'select("id,booking_date,description,amount,category")',
    'ilike("description", "%café%")',
    'gte("booking_date", "2026-10-01")',
    'lte("booking_date", "2026-10-28")',
    'order("booking_date", {"ascending":false})',
    "limit(300)",
  ]);
});

Deno.test("con una categoría de gasto no salen ingresos, y con Ingresos no salen gastos", async () => {
  const { db, queries } = fakeDb(() => ({ data: [] }));
  await searchMovements(db, { text: "", category: "Ocio", from: null, to: null });
  assertEquals(queries.map((query) => query[0]), ['from("expenses")']);
  assertEquals(queries[0].includes('eq("category", "Ocio")'), true);
  const { db: incomesOnly, queries: incomeQueries } = fakeDb(() => ({ data: [] }));
  await searchMovements(incomesOnly, { text: "", category: "Ingresos", from: null, to: null });
  assertEquals(incomeQueries.map((query) => query[0]), ['from("incomes")']);
});

Deno.test("la búsqueda global mira en todo y sin Google conectado no falla", async () => {
  const { db, queries } = fakeDb((query) =>
    query[0] === 'from("google_connections")'
      ? { data: null }
      : { data: query[0] === 'from("shopping_items")' ? [{ id: 1, text: "Leche" }] : [] }
  );
  const results = await searchEverything(db, "lec", TODAY);
  assertEquals(results.shopping, [{ id: 1, text: "Leche" }]);
  assertEquals(results.events, []);
  assertEquals(results.eventsProblem, undefined);
  const tables = queries.map((query) => query[0]);
  for (const table of ["reminders", "habits", "shopping_items", "notes", "expenses", "incomes"]) {
    assertEquals(tables.includes(`from("${table}")`), true, table);
  }
  await assertRejects(() => searchEverything(db, "a", TODAY), Error, "dos letras");
});

Deno.test("si Google falla, enseña lo demás y avisa", async () => {
  const { db } = fakeDb((query) =>
    query[0] === 'from("google_connections")' ? { data: { refresh_token: "r" } } : { data: [] }
  );
  const googleDown = () => new Response("caído", { status: 500 });
  await withFakeFetch({ GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s" }, googleDown, async () => {
    const results = await searchEverything(db, "cena", TODAY);
    assertEquals(results.eventsProblem, "No he podido buscar en Google Calendar ahora mismo.");
    assertEquals(results.reminders, []);
  });
});

Deno.test("los eventos se buscan en Google con el texto", async () => {
  const { db } = fakeDb((query) =>
    query[0] === 'from("google_connections")' ? { data: { refresh_token: "r" } } : { data: [] }
  );
  const google = (request: Request) =>
    request.url.includes("oauth2") ? Response.json({ access_token: "a" }) : Response.json({ items: [] });
  await withFakeFetch({ GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s" }, google, async (requests) => {
    await searchEverything(db, "dentista", TODAY);
    const calendar = new URL(requests.find((request) => request.url.includes("/events"))!.url);
    assertEquals(calendar.searchParams.get("q"), "dentista");
  });
});

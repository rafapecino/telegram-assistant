import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  addWatch,
  checkPriceWatches,
  comparePrices,
  formatOffers,
  MAX_WATCHES,
  parseOffers,
  parsePricesRequest,
  priceAlert,
  type PriceWatch,
} from "./prices.ts";
import { fakeDb, TELEGRAM_ENV, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-28T09:00:00Z");
const ENV = { SERPAPI_API_KEY: "clave-serp", ...TELEGRAM_ENV };
const result = (title: string, price: number, source: string, link = `https://tienda.es/${source}`) => ({
  title,
  price: `${price} €`,
  extracted_price: price,
  source,
  link,
});
const PS5_RESULTS = {
  shopping_results: [
    result("PlayStation 5 Slim", 449, "MediaMarkt"),
    result("Mando DualSense", 59, "Amazon"),
    result("PlayStation 5 Slim Digital", 399, "PcComponentes"),
    result("PlayStation 5 Slim", 459, "MediaMarkt"),
    result("PlayStation 5 Pro", 799, "El Corte Inglés"),
    result("Trampa", 420, "Rara", "javascript:alert(1)"),
  ],
};
const watch = (values: Partial<PriceWatch>): PriceWatch => ({
  id: 1,
  query: "PS5",
  max_price: null,
  best_price: null,
  best_source: null,
  best_title: null,
  best_link: null,
  notified_price: null,
  checked_at: null,
  ...values,
});

Deno.test("ordena de más barato a más caro, una oferta por tienda, sin accesorios ni enlaces raros", () => {
  assertEquals(parseOffers(PS5_RESULTS).map((offer) => [offer.source, offer.price]), [
    ["PcComponentes", 399],
    ["MediaMarkt", 449],
    ["El Corte Inglés", 799],
  ]);
  assertEquals(parseOffers({}), []);
});

Deno.test("busca en Google Shopping de España y antes mira cuántas búsquedas quedan", async () => {
  const serp = (request: Request) =>
    request.url.includes("/account.json") ? Response.json({ total_searches_left: 120 }) : Response.json(PS5_RESULTS);
  await withFakeFetch(ENV, serp, async (requests) => {
    const { offers, left } = await comparePrices(" PS5 ");
    assertEquals([offers[0].source, left], ["PcComponentes", 119]);
    const search = new URL(requests[1].url);
    assertEquals(
      ["engine", "q", "gl", "hl", "google_domain"].map((name) => search.searchParams.get(name)),
      ["google_shopping", "PS5", "es", "es", "google.es"],
    );
  });
});

Deno.test("guarda búsquedas para la vigilancia diaria y explica si falta la clave", async () => {
  await withFakeFetch(ENV, () => Response.json({ total_searches_left: 10 }), async (requests) => {
    await assertRejects(() => comparePrices("PS5"), Error, "Quedan 10 búsquedas");
    assertEquals(requests.length, 1);
  });
  await assertRejects(() => comparePrices("PS5"), Error, "falta la clave de SerpApi");
});

Deno.test("avisa al bajar del precio objetivo, y no repite hasta que baje más", () => {
  const best = parseOffers(PS5_RESULTS)[0];
  assertEquals(priceAlert(watch({ max_price: 400 }), best)?.startsWith("🏷️ «PS5» está a 399,00\u00a0€"), true);
  assertEquals(priceAlert(watch({ max_price: 400, notified_price: 399 }), best), null);
  assertEquals(priceAlert(watch({ max_price: 350 }), best), null);
});

Deno.test("sin precio objetivo, avisa si baja un 5 % o más", () => {
  const best = parseOffers(PS5_RESULTS)[0];
  const alert = priceAlert(watch({ best_price: 449 }), best);
  assertEquals(alert?.includes("ha bajado de 449,00\u00a0€ a 399,00\u00a0€"), true);
  assertEquals(priceAlert(watch({ best_price: 410 }), best), null);
  assertEquals(priceAlert(watch({}), best), null);
});

Deno.test("la revisión diaria avisa por Telegram y guarda el mejor precio", async () => {
  const { db, queries } = fakeDb((query) =>
    query[1].startsWith("select(") ? { data: [watch({ max_price: 400 })] } : {}
  );
  const respond = (request: Request) =>
    request.url.includes("api.telegram.org")
      ? Response.json({ ok: true, result: { message_id: 1 } })
      : Response.json(PS5_RESULTS);
  await withFakeFetch(ENV, respond, async (requests) => {
    assertEquals(await checkPriceWatches(db, NOW), 1);
    assertEquals(requests.filter((request) => request.url.includes("api.telegram.org")).length, 1);
  });
  const update = queries.at(-1)!;
  assertEquals(update[1].includes('"best_price":399') && update[1].includes('"notified_price":399'), true);
});

Deno.test("como mucho vigila cinco productos", async () => {
  const full = Array.from({ length: MAX_WATCHES }, (_, index) => watch({ id: index, query: `Producto ${index}` }));
  const { db } = fakeDb(() => ({ data: full }));
  await assertRejects(() => addWatch(db, "PS5", 400), Error, "Ya vigilo 5 productos");
  await assertRejects(() => addWatch(db, "PS5", "gratis"), Error, "no es válido");
});

Deno.test("entiende buscar, vigilar con o sin precio, dejar de vigilar y ver la lista", () => {
  assertEquals(parsePricesRequest({ action: "search", query: "PS5" }), { kind: "prices_search", query: "PS5" });
  assertEquals(parsePricesRequest({ action: "watch", query: "PS5", max_price: 400 }), {
    kind: "prices_watch",
    query: "PS5",
    maxPrice: 400,
  });
  assertEquals(parsePricesRequest({ action: "watch", query: "PS5", max_price: null }), {
    kind: "prices_watch",
    query: "PS5",
    maxPrice: null,
  });
  assertEquals(parsePricesRequest({ action: "unwatch", query: "PS5" }), { kind: "prices_unwatch", query: "PS5" });
  assertEquals(parsePricesRequest({ action: "list" }), { kind: "prices_list" });
  assertEquals(parsePricesRequest({ action: "search", query: "" }).kind, "invalid");
});

Deno.test("sin resultados lo dice", () => {
  assertEquals(formatOffers("PS7", []), "No he encontrado precios de «PS7» en tiendas españolas.");
});

import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  addWatch,
  checkPriceWatches,
  comparePrices,
  extractOffers,
  formatOffers,
  MAX_WATCHES,
  type Offer,
  parsePricesRequest,
  priceAlert,
  type PriceWatch,
  rankOffers,
  refineQuery,
  selectMatching,
  withoutCheapExtras,
} from "./prices.ts";
import { fakeDb, TELEGRAM_ENV, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-28T09:00:00Z");
const ENV = { SERPAPI_API_KEY: "clave-serp", GROQ_API_KEY: "g", ...TELEGRAM_ENV };
const CONSOLE: Offer = {
  title: "PlayStation 5 Slim Digital",
  price: 399,
  priceText: "399 €",
  source: "PcComponentes",
  url: "https://tienda.es/PcComponentes",
  rating: null,
  delivery: null,
  isSecondHand: false,
};
/** Groq de prueba: la primera llamada precisa la búsqueda y la segunda elige las ofertas. */
const groq = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
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
    result("PS5 como nueva", 300, "Wallapop"),
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

Deno.test("se queda con ofertas con precio y enlace https, y marca las de segunda mano", () => {
  assertEquals(extractOffers(PS5_RESULTS).map((offer) => [offer.title, offer.isSecondHand]), [
    ["PlayStation 5 Slim", false],
    ["Mando DualSense", false],
    ["PlayStation 5 Slim Digital", false],
    ["PlayStation 5 Slim", false],
    ["PlayStation 5 Pro", false],
    ["PS5 como nueva", true],
  ]);
  assertEquals(extractOffers({}), []);
});

Deno.test("ordena de más barato a más caro, una oferta por tienda", () => {
  assertEquals(rankOffers(extractOffers(PS5_RESULTS)).map((offer) => [offer.source, offer.price]), [
    ["Amazon", 59],
    ["Wallapop", 300],
    ["PcComponentes", 399],
    ["MediaMarkt", 449],
    ["El Corte Inglés", 799],
  ]);
});

Deno.test("Groq precisa la búsqueda; si falla, se busca tal cual", async () => {
  await withFakeFetch(ENV, () => groq({ search_query: "consola PlayStation 5" }), async (requests) => {
    assertEquals(await refineQuery("PS5"), "consola PlayStation 5");
    assertEquals((await requests[0].json()).messages[1].content, "PS5");
  });
  await withFakeFetch(ENV, () => new Response("caído", { status: 503 }), async () => {
    assertEquals(await refineQuery("PS5"), "PS5");
  });
});

Deno.test("Groq elige las ofertas que son el producto; si falla, se quitan las muy baratas", async () => {
  const offers = extractOffers(PS5_RESULTS);
  await withFakeFetch(ENV, () => groq({ matches: [0, 2, 99, "x"] }), async (requests) => {
    assertEquals((await selectMatching("PS5", offers)).map((offer) => offer.price), [449, 399]);
    const sent = (await requests[0].json()).messages[1].content as string;
    assertEquals(sent.includes("1. Mando DualSense — 59 € — Amazon"), true);
  });
  await withFakeFetch(ENV, () => new Response("caído", { status: 503 }), async () => {
    assertEquals(
      (await selectMatching("PS5", offers)).map((offer) => offer.price),
      withoutCheapExtras(offers).map((offer) => offer.price),
    );
  });
});

Deno.test("busca en Google Shopping de España con la búsqueda precisada y mira antes cuántas quedan", async () => {
  const groqAnswers = [{ search_query: "consola PlayStation 5" }, { matches: [0, 2, 3, 4] }];
  const respond = (request: Request) => {
    if (request.url.includes("/account.json")) return Response.json({ total_searches_left: 120 });
    if (request.url.includes("groq")) return groq(groqAnswers.shift());
    return Response.json(PS5_RESULTS);
  };
  await withFakeFetch(ENV, respond, async (requests) => {
    const { offers, left, searchQuery } = await comparePrices(" PS5 ");
    assertEquals([offers.map((offer) => offer.source), left, searchQuery], [
      ["PcComponentes", "MediaMarkt", "El Corte Inglés"],
      119,
      "consola PlayStation 5",
    ]);
    const search = new URL(requests.find((request) => request.url.includes("search.json"))!.url);
    assertEquals(
      ["engine", "q", "gl", "hl", "google_domain"].map((name) => search.searchParams.get(name)),
      ["google_shopping", "consola PlayStation 5", "es", "es", "google.es"],
    );
  });
});

Deno.test("avisa al bajar del precio objetivo, y no repite hasta que baje más", () => {
  const best = CONSOLE;
  assertEquals(priceAlert(watch({ max_price: 400 }), best)?.startsWith("🏷️ «PS5» está a 399,00\u00a0€"), true);
  assertEquals(priceAlert(watch({ max_price: 400, notified_price: 399 }), best), null);
  assertEquals(priceAlert(watch({ max_price: 350 }), best), null);
});

Deno.test("sin precio objetivo, avisa si baja un 5 % o más", () => {
  const best = CONSOLE;
  const alert = priceAlert(watch({ best_price: 449 }), best);
  assertEquals(alert?.includes("ha bajado de 449,00\u00a0€ a 399,00\u00a0€"), true);
  assertEquals(priceAlert(watch({ best_price: 410 }), best), null);
  assertEquals(priceAlert(watch({}), best), null);
});

Deno.test("la revisión diaria avisa por Telegram y guarda el mejor precio", async () => {
  const { db, queries } = fakeDb((query) =>
    query[1].startsWith("select(") ? { data: [watch({ max_price: 400 })] } : {}
  );
  const groqAnswers = [{ search_query: "consola PlayStation 5" }, { matches: [2, 4] }];
  const respond = (request: Request) => {
    if (request.url.includes("api.telegram.org")) return Response.json({ ok: true, result: { message_id: 1 } });
    if (request.url.includes("groq")) return groq(groqAnswers.shift());
    return Response.json(PS5_RESULTS);
  };
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

Deno.test("las de segunda mano salen marcadas en la lista y en los avisos", () => {
  const used = { ...CONSOLE, source: "Wallapop", price: 300, isSecondHand: true };
  assertEquals(formatOffers("PS5", [used]).includes("300,00\u00a0€ en Wallapop (2ª mano)"), true);
  assertEquals(priceAlert(watch({ max_price: 350 }), used)?.includes("Wallapop (2ª mano):"), true);
});

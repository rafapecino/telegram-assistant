import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  fetchQuotes,
  findWatched,
  formatQuotes,
  parseMarketsRequest,
  replyToMarkets,
  resolveAsset,
  type WatchedAsset,
} from "./markets.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-28T10:00:00Z");
const APPLE: WatchedAsset = { id: 1, kind: "stock", symbol: "AAPL", label: "Apple" };
const NASDAQ: WatchedAsset = { id: 2, kind: "stock", symbol: "^NDX", label: "Nasdaq-100" };
const BITCOIN: WatchedAsset = { id: 3, kind: "crypto", symbol: "bitcoin", label: "Bitcoin" };
const DOLLAR: WatchedAsset = { id: 4, kind: "currency", symbol: "USD", label: "Dólar estadounidense" };

function sources(options: { isYahooDown?: boolean } = {}) {
  return (request: Request) => {
    const url = new URL(request.url);
    if (url.hostname.includes("yahoo")) {
      if (options.isYahooDown) return new Response("", { status: 429 });
      const price = url.pathname.endsWith("AAPL") ? 347.1 : 25000;
      return Response.json({
        chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: price / 1.02, currency: "USD" } }] },
      });
    }
    if (url.hostname.includes("coingecko")) {
      return Response.json([{ id: "bitcoin", current_price: 73152, price_change_percentage_24h: -1.234 }]);
    }
    return Response.json({ rates: { "2026-10-26": { USD: 1.1188 }, "2026-10-27": { USD: 1.115 } } });
  };
}

Deno.test("trae acciones, criptos y divisas en el orden de la lista, con el cambio del día", async () => {
  await withFakeFetch({}, sources(), async (requests) => {
    const { quotes, problems } = await fetchQuotes([APPLE, NASDAQ, BITCOIN, DOLLAR], NOW);
    assertEquals(problems, []);
    assertEquals(quotes.map((quote) => [quote.symbol, quote.price, quote.currency, quote.changePercent]), [
      ["AAPL", 347.1, "USD", 2],
      ["^NDX", 25000, "USD", 2],
      ["bitcoin", 73152, "EUR", -1.23],
      ["USD", 1.115, "USD", -0.34],
    ]);
    const yahoo = requests.find((request) => request.url.includes("AAPL"))!;
    assertEquals(new URL(yahoo.url).searchParams.get("range"), "1d");
    assertEquals(
      new URL(requests.find((request) => request.url.includes("frankfurter"))!.url).searchParams.get("base"),
      "EUR",
    );
  });
});

Deno.test("si Yahoo falla, se dice qué no se ha podido ver y el resto se enseña", async () => {
  await withFakeFetch({}, sources({ isYahooDown: true }), async () => {
    // Una empresa que no se ha consultado antes: no hay ninguna cotización anterior que enseñar.
    const microsoft: WatchedAsset = { id: 9, kind: "stock", symbol: "MSFT", label: "Microsoft" };
    const overview = await fetchQuotes([microsoft, BITCOIN], NOW);
    assertEquals(overview.quotes.map((quote) => quote.symbol), ["bitcoin"]);
    assertEquals(overview.problems, ["No he podido consultar Microsoft."]);
    assertEquals(formatQuotes(overview), "🪙 Bitcoin: 73.152,00\u00a0€ (−1,23 %)\nNo he podido consultar Microsoft.");
  });
});

Deno.test("resuelve empresas, criptos y divisas por su nombre o código", async () => {
  const respond = (request: Request) => {
    const url = new URL(request.url);
    if (url.hostname.includes("yahoo")) {
      return Response.json({
        quotes: [{ symbol: "SAAPL=F", quoteType: "FUTURE" }, {
          symbol: "AMD",
          quoteType: "EQUITY",
          shortname: "Advanced Micro Devices, Inc.",
        }],
      });
    }
    if (url.hostname.includes("coingecko")) return Response.json({ coins: [{ id: "cardano", name: "Cardano" }] });
    return Response.json({ JPY: "Japanese Yen", EUR: "Euro" });
  };
  await withFakeFetch({}, respond, async () => {
    assertEquals(await resolveAsset("stock", "amd"), {
      kind: "stock",
      symbol: "AMD",
      label: "Advanced Micro Devices, Inc.",
    });
    assertEquals(await resolveAsset("crypto", "cardano"), { kind: "crypto", symbol: "cardano", label: "Cardano" });
    assertEquals(await resolveAsset("currency", "jpy"), { kind: "currency", symbol: "JPY", label: "Japanese Yen" });
    await assertRejects(() => resolveAsset("currency", "EUR"), Error, "tres letras");
    await assertRejects(() => resolveAsset("currency", "yenes"), Error, "tres letras");
  });
});

Deno.test("entiende consultar, seguir, dejar de seguir y ver todo", () => {
  assertEquals(parseMarketsRequest({ action: "list" }), { kind: "markets_list" });
  assertEquals(parseMarketsRequest({ action: "quote", kind: "crypto", query: "bitcoin" }), {
    kind: "markets_quote",
    assetKind: "crypto",
    query: "bitcoin",
  });
  assertEquals(parseMarketsRequest({ action: "follow", kind: null, query: "AMD" }), {
    kind: "markets_follow",
    assetKind: "stock",
    query: "AMD",
  });
  assertEquals(parseMarketsRequest({ action: "unfollow", query: "Tesla" }), {
    kind: "markets_unfollow",
    query: "Tesla",
  });
  assertEquals(parseMarketsRequest({ action: "follow", query: "" }).kind, "invalid");
});

Deno.test("encuentra lo que se sigue por símbolo o por nombre", () => {
  assertEquals(findWatched([APPLE, BITCOIN], "aapl"), APPLE);
  assertEquals(findWatched([APPLE, BITCOIN], "el bitcoin"), BITCOIN);
  assertEquals(findWatched([APPLE, BITCOIN], "tesla"), null);
});

Deno.test("dejar de seguir borra solo lo que coincide", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [APPLE, BITCOIN] } : {});
  assertEquals(
    await replyToMarkets(db, { kind: "markets_unfollow", query: "Apple" }, NOW),
    "Ya no sigo Apple en Mercados.",
  );
  assertEquals(queries.at(-1), ['from("market_watchlist")', "delete()", 'eq("id", 1)']);
  assertEquals(
    await replyToMarkets(db, { kind: "markets_unfollow", query: "Tesla" }, NOW),
    "No sigo nada que se llame «Tesla» en Mercados.",
  );
});

Deno.test("si una fuente falla, enseña lo último que tenía (de menos de una hora) y lo dice", async () => {
  const solana: WatchedAsset = { id: 5, kind: "crypto", symbol: "solana", label: "Solana" };
  const coin = () => Response.json([{ id: "solana", current_price: 150, price_change_percentage_24h: 1 }]);
  await withFakeFetch({}, coin, async () => {
    await fetchQuotes([solana], NOW);
  });
  await withFakeFetch({}, () => new Response("", { status: 429 }), async () => {
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const overview = await fetchQuotes([solana], later);
    assertEquals(overview.quotes.map((quote) => quote.price), [150]);
    assertEquals(overview.problems, ["Las criptomonedas: datos de hace 10 min, ahora no responden."]);
    const muchLater = await fetchQuotes([solana], new Date(NOW.getTime() + 2 * 3_600_000));
    assertEquals([muchLater.quotes.length, muchLater.problems], [0, ["No he podido consultar las criptomonedas."]]);
  });
});

Deno.test("con la clave de CoinGecko, la manda en su cabecera", async () => {
  await withFakeFetch({ COINGECKO_API_KEY: "demo" }, () => Response.json([]), async (requests) => {
    await fetchQuotes([{ id: 6, kind: "crypto", symbol: "dogecoin", label: "Dogecoin" }], NOW);
    assertEquals(requests[0].headers.get("x-cg-demo-api-key"), "demo");
  });
});

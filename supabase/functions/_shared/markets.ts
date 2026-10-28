// Mercados: acciones e índices (Yahoo Finance), criptomonedas (CoinGecko) y divisas (Frankfurter, del BCE). Gratis y
// sin clave. Yahoo no tiene API oficial: si cambia, fallan solo las acciones y el resto se sigue viendo.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { UserFacingError } from "./errors.ts";

export type MarketKind = "stock" | "crypto" | "currency";

export interface WatchedAsset {
  id: number;
  kind: MarketKind;
  symbol: string;
  label: string;
}

export interface Quote {
  id: number;
  kind: MarketKind;
  symbol: string;
  label: string;
  price: number;
  currency: string;
  // Cambio en % frente al cierre anterior (acciones y divisas) o en 24 h (criptomonedas).
  changePercent: number | null;
}

export interface MarketsOverview {
  quotes: Quote[];
  // Fuentes que han fallado, en palabras: lo demás se enseña igual.
  problems: string[];
}

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_SEARCH = "https://query2.finance.yahoo.com/v1/finance/search";
const COINGECKO = "https://api.coingecko.com/api/v3";
const FRANKFURTER = "https://api.frankfurter.dev/v1";
// Yahoo rechaza peticiones sin un navegador de verdad en el User-Agent.
const BROWSER_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; MiAsistente/1.0)" };
const CACHE_MINUTES = 5;
const SYMBOL = /^[A-Za-z0-9.^=-]{1,40}$/;

async function getJson(url: string, source: string): Promise<Record<string, unknown>> {
  // La clave «Demo» de CoinGecko es gratuita y sube su límite; sin ella, la API pública se satura a menudo.
  const coinGeckoKey = Deno.env.get("COINGECKO_API_KEY");
  const headers = coinGeckoKey && source === "CoinGecko"
    ? { ...BROWSER_HEADERS, "x-cg-demo-api-key": coinGeckoKey }
    : BROWSER_HEADERS;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${source} respondió ${response.status}`);
  return await response.json();
}

const percent = (now: number, before: number | null | undefined) =>
  before ? Math.round((now / before - 1) * 10_000) / 100 : null;

async function fetchStock(asset: WatchedAsset): Promise<Quote> {
  // Con range=1d, chartPreviousClose es el cierre del día anterior: así sale el cambio del día.
  const data = await getJson(`${YAHOO_CHART}/${encodeURIComponent(asset.symbol)}?range=1d&interval=1d`, "Yahoo");
  const meta = (data.chart as { result?: { meta?: Record<string, unknown> }[] })?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!meta || !Number.isFinite(price)) throw new Error(`Yahoo no tiene cotización de ${asset.symbol}`);
  return {
    ...asset,
    price,
    currency: String(meta.currency ?? "USD"),
    changePercent: percent(price, Number(meta.chartPreviousClose)),
  };
}

async function fetchCryptos(assets: WatchedAsset[]): Promise<Quote[]> {
  if (!assets.length) return [];
  const ids = assets.map((asset) => asset.symbol).join(",");
  const data = await getJson(`${COINGECKO}/coins/markets?vs_currency=eur&ids=${encodeURIComponent(ids)}`, "CoinGecko");
  const byId = new Map((data as unknown as Record<string, unknown>[]).map((coin) => [coin.id, coin]));
  return assets.flatMap((asset) => {
    const coin = byId.get(asset.symbol);
    if (!coin || !Number.isFinite(Number(coin.current_price))) return [];
    const change = Number(coin.price_change_percentage_24h);
    return [{
      ...asset,
      price: Number(coin.current_price),
      currency: "EUR",
      changePercent: Number.isFinite(change) ? Math.round(change * 100) / 100 : null,
    }];
  });
}

/** Cuánto vale 1 euro en cada divisa, y su cambio frente al día hábil anterior. */
async function fetchCurrencies(assets: WatchedAsset[], now: Date): Promise<Quote[]> {
  if (!assets.length) return [];
  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString().slice(0, 10);
  const symbols = assets.map((asset) => asset.symbol).join(",");
  const data = await getJson(`${FRANKFURTER}/${since}..?base=EUR&symbols=${symbols}`, "Frankfurter");
  const days = Object.entries((data.rates ?? {}) as Record<string, Record<string, number>>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const [latest, previous] = [days.at(-1)?.[1], days.at(-2)?.[1]];
  return assets.flatMap((asset) => {
    const price = latest?.[asset.symbol];
    if (!price) return [];
    return [{ ...asset, price, currency: asset.symbol, changePercent: percent(price, previous?.[asset.symbol]) }];
  });
}

export async function loadWatchlist(db: SupabaseClient): Promise<WatchedAsset[]> {
  const { data, error } = await db.from("market_watchlist").select("id,kind,symbol,label").order("id");
  if (error) throw new Error(`No se pudo leer lo que sigues en Mercados: ${error.message}`);
  return data as WatchedAsset[];
}

let cache: { key: string; overview: MarketsOverview; fetchedAt: number } | null = null;
// Última cotización buena de cada cosa: si su fuente falla, se enseña esa (si tiene menos de una hora) avisando.
const lastGood = new Map<string, { quote: Quote; at: number }>();
const STALE_MINUTES = 60;
const assetKey = (asset: { kind: MarketKind; symbol: string }) => `${asset.kind}:${asset.symbol}`;

/** Cotizaciones de lo que se sigue. Cada fuente va por su lado: si una falla, se dice y se enseña el resto. */
export async function fetchQuotes(assets: WatchedAsset[], now = new Date()): Promise<MarketsOverview> {
  const key = assets.map((asset) => `${asset.kind}:${asset.symbol}`).join(",");
  if (cache && cache.key === key && now.getTime() - cache.fetchedAt < CACHE_MINUTES * 60_000) return cache.overview;
  const cryptos = assets.filter((asset) => asset.kind === "crypto");
  const currencies = assets.filter((asset) => asset.kind === "currency");
  const jobs: { name: string; assets: WatchedAsset[]; job: Promise<Quote[]> }[] = [
    ...assets.filter((asset) => asset.kind === "stock")
      .map((asset) => ({ name: asset.label, assets: [asset], job: fetchStock(asset).then((quote) => [quote]) })),
    { name: "las criptomonedas", assets: cryptos, job: fetchCryptos(cryptos) },
    { name: "las divisas", assets: currencies, job: fetchCurrencies(currencies, now) },
  ];
  const results = await Promise.allSettled(jobs.map(({ job }) => job));
  const quotes: Quote[] = [], problems: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      for (const quote of result.value) lastGood.set(assetKey(quote), { quote, at: now.getTime() });
      quotes.push(...result.value);
      return;
    }
    const { name, assets: failed } = jobs[index];
    console.error(`Mercados: no se pudo consultar ${name}:`, result.reason);
    const stale = failed.map((asset) => lastGood.get(assetKey(asset)))
      .filter((saved) => saved && now.getTime() - saved.at < STALE_MINUTES * 60_000) as { quote: Quote; at: number }[];
    if (!stale.length) {
      problems.push(`No he podido consultar ${name}.`);
      return;
    }
    const minutes = Math.max(1, Math.round((now.getTime() - Math.min(...stale.map((saved) => saved.at))) / 60_000));
    quotes.push(
      ...stale.map((saved) => ({
        ...saved.quote,
        id: failed.find((asset) => assetKey(asset) === assetKey(saved.quote))!.id,
      })),
    );
    problems.push(`${name.charAt(0).toUpperCase()}${name.slice(1)}: datos de hace ${minutes} min, ahora no responden.`);
  });
  const order = new Map(assets.map((asset, index) => [asset.id, index]));
  quotes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const overview = { quotes, problems };
  if (!problems.length) cache = { key, overview, fetchedAt: now.getTime() };
  return overview;
}

/** De «Apple» o «AMD» a su símbolo; de «solana» a su id de CoinGecko; de «yen» o «JPY» a su código. */
export async function resolveAsset(kind: MarketKind, query: string): Promise<Omit<WatchedAsset, "id">> {
  const text = query.trim();
  if (!text || text.length > 60) throw new UserFacingError("Dime qué quieres seguir, por ejemplo «Apple» o «bitcoin».");
  if (kind === "currency") {
    const code = text.toUpperCase();
    const names = await getJson(`${FRANKFURTER}/currencies`, "Frankfurter") as Record<string, string>;
    if (!/^[A-Z]{3}$/.test(code) || code === "EUR" || !names[code]) {
      throw new UserFacingError("Dime la divisa con su código de tres letras, por ejemplo JPY o MXN.");
    }
    return { kind, symbol: code, label: names[code] };
  }
  if (kind === "crypto") {
    const data = await getJson(`${COINGECKO}/search?query=${encodeURIComponent(text)}`, "CoinGecko");
    const coin = (data.coins as { id: string; name: string }[] | undefined)?.[0];
    if (!coin || !SYMBOL.test(coin.id)) throw new UserFacingError(`No encuentro la criptomoneda «${text}».`);
    return { kind, symbol: coin.id, label: coin.name };
  }
  const data = await getJson(`${YAHOO_SEARCH}?q=${encodeURIComponent(text)}&quotesCount=5&newsCount=0`, "Yahoo");
  const quote =
    (data.quotes as { symbol?: string; quoteType?: string; shortname?: string; longname?: string }[] | undefined)
      ?.find((candidate) =>
        (candidate.quoteType === "EQUITY" || candidate.quoteType === "INDEX" || candidate.quoteType === "ETF") &&
        candidate.symbol && SYMBOL.test(candidate.symbol)
      );
  if (!quote?.symbol) throw new UserFacingError(`No encuentro la empresa o el índice «${text}».`);
  return { kind, symbol: quote.symbol, label: (quote.shortname ?? quote.longname ?? quote.symbol).slice(0, 80) };
}

export async function followAsset(db: SupabaseClient, kind: MarketKind, query: string): Promise<WatchedAsset> {
  const asset = await resolveAsset(kind, query);
  const { data, error } = await db.from("market_watchlist").upsert(asset, { onConflict: "kind,symbol" })
    .select("id,kind,symbol,label").single();
  if (error) throw new Error(`No se pudo guardar en Mercados: ${error.message}`);
  cache = null;
  return data as WatchedAsset;
}

export async function unfollowAsset(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("market_watchlist").delete().eq("id", id);
  if (error) throw new Error(`No se pudo quitar de Mercados: ${error.message}`);
  cache = null;
}

const KIND_ICON: Record<MarketKind, string> = { stock: "📈", crypto: "🪙", currency: "💱" };

export function formatPrice(quote: Quote): string {
  if (quote.kind === "currency") {
    return `1 € = ${quote.price.toLocaleString("es-ES", { maximumFractionDigits: 4 })} ${quote.currency}`;
  }
  const isIndex = quote.symbol.startsWith("^");
  return isIndex
    ? quote.price.toLocaleString("es-ES", { maximumFractionDigits: 2 })
    : new Intl.NumberFormat("es-ES", { style: "currency", currency: quote.currency }).format(quote.price);
}

export function formatChange(changePercent: number | null): string {
  if (changePercent === null) return "";
  const sign = changePercent > 0 ? "+" : changePercent < 0 ? "−" : "";
  return ` (${sign}${
    Math.abs(changePercent).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } %)`;
}

export function formatQuotes(overview: MarketsOverview): string {
  const lines = overview.quotes.map((quote) =>
    `${KIND_ICON[quote.kind]} ${quote.label}: ${formatPrice(quote)}${formatChange(quote.changePercent)}`
  );
  return [...lines, ...overview.problems].join("\n") || "No sigues nada en Mercados.";
}

/** Formato que el modelo debe devolver para Mercados (ver message-intent.ts). */
export const MARKETS_INTENT_FORMAT =
  'Mercados (acciones, índices, criptomonedas y divisas): {"intent": "markets", "action": "quote", "follow", ' +
  '"unfollow" o "list", "kind": "stock", "crypto", "currency" o null, "query": texto o null}. quote: «¿cómo va el ' +
  "bitcoin?», «¿a cuánto está Apple?»; list: «¿cómo van los mercados?»; follow: «sigue AMD», «añade Cardano»; " +
  "unfollow: «deja de seguir Tesla». kind es stock para empresas e índices, crypto para criptomonedas y currency " +
  "para " +
  "divisas (entonces query es su código de tres letras, como JPY). query es la empresa, cripto o divisa que nombra.";

export type MarketsRequest =
  | { kind: "markets_list" }
  | { kind: "markets_quote"; assetKind: MarketKind | null; query: string }
  | { kind: "markets_follow"; assetKind: MarketKind; query: string }
  | { kind: "markets_unfollow"; query: string }
  | { kind: "invalid"; message: string };

const ASSET_KINDS = new Set(["stock", "crypto", "currency"]);

export function parseMarketsRequest(raw: unknown): MarketsRequest {
  const candidate = raw as { action?: unknown; kind?: unknown; query?: unknown } | null;
  const query = typeof candidate?.query === "string" ? candidate.query.trim().slice(0, 60) : "";
  const assetKind = ASSET_KINDS.has(candidate?.kind as string) ? candidate!.kind as MarketKind : null;
  if (candidate?.action === "list" || (candidate?.action === "quote" && !query)) return { kind: "markets_list" };
  if (!query) return { kind: "invalid", message: "¿Qué empresa, criptomoneda o divisa?" };
  if (candidate?.action === "quote") return { kind: "markets_quote", assetKind, query };
  if (candidate?.action === "follow") return { kind: "markets_follow", assetKind: assetKind ?? "stock", query };
  if (candidate?.action === "unfollow") return { kind: "markets_unfollow", query };
  return { kind: "invalid", message: "No he entendido qué quieres hacer en Mercados." };
}

/** Lo que se sigue y coincide con lo que dice: por nombre o por símbolo. */
export function findWatched(assets: WatchedAsset[], query: string): WatchedAsset | null {
  const wanted = query.trim().toLowerCase();
  return assets.find((asset) => asset.symbol.toLowerCase() === wanted) ??
    assets.find((asset) => asset.label.toLowerCase() === wanted) ??
    assets.find((asset) => asset.label.toLowerCase().includes(wanted) || wanted.includes(asset.label.toLowerCase())) ??
    null;
}

export async function replyToMarkets(db: SupabaseClient, request: MarketsRequest, now: Date): Promise<string> {
  switch (request.kind) {
    case "markets_list":
      return formatQuotes(await fetchQuotes(await loadWatchlist(db), now));
    case "markets_quote": {
      const watched = findWatched(await loadWatchlist(db), request.query);
      const asset = watched ?? { id: 0, ...await resolveAsset(request.assetKind ?? "stock", request.query) };
      const text = formatQuotes(await fetchQuotes([asset], now));
      return watched ? text : `${text}\nNo lo sigues en Mercados: dime «sigue ${request.query}» para tenerlo siempre.`;
    }
    case "markets_follow": {
      const asset = await followAsset(db, request.assetKind, request.query);
      return `Ahora sigo ${asset.label} (${asset.symbol}) en Mercados.`;
    }
    case "markets_unfollow": {
      const asset = findWatched(await loadWatchlist(db), request.query);
      if (!asset) return `No sigo nada que se llame «${request.query}» en Mercados.`;
      await unfollowAsset(db, asset.id);
      return `Ya no sigo ${asset.label} en Mercados.`;
    }
    case "invalid":
      return request.message;
  }
}

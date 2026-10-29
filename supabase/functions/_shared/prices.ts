// Comparar y vigilar precios en tiendas españolas con Google Shopping, a través de SerpApi (su plan gratis da 250
// búsquedas al mes). Las tiendas bloquean que se lean sus webs directamente, así que no hay alternativa gratuita.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { requireEnv } from "./env.ts";
import { askGroqForJson } from "./groq.ts";
import { UserFacingError } from "./errors.ts";
import { sendTelegramMessage } from "./telegram.ts";

const SERPAPI = "https://serpapi.com";
// Cada producto vigilado gasta una búsqueda al día: con 5, unas 150 de las 250 del mes.
export const MAX_WATCHES = 5;
// Búsquedas que se dejan siempre para la vigilancia diaria: las de a mano se paran antes.
const RESERVED_FOR_WATCHES = MAX_WATCHES * 3;
const MAX_OFFERS = 10;
export const PRICE_CHECK_HOUR = 10;
// Sin precio objetivo, se avisa cuando el mejor baja al menos esto respecto al anterior.
const MEANINGFUL_DROP = 0.95;

export interface Offer {
  title: string;
  price: number;
  priceText: string;
  source: string;
  url: string;
  rating: number | null;
  delivery: string | null;
  // Wallapop, Vinted, usados o reacondicionados: se enseñan, pero marcados.
  isSecondHand: boolean;
}

export interface PriceWatch {
  id: number;
  query: string;
  max_price: number | null;
  best_price: number | null;
  best_source: string | null;
  best_title: string | null;
  best_link: string | null;
  notified_price: number | null;
  checked_at: string | null;
}

function validQuery(raw: unknown): string {
  const query = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (query.length < 2 || query.length > 100) throw new UserFacingError("Dime qué producto buscar, por ejemplo «PS5».");
  return query;
}

function httpsUrl(raw: unknown): string | null {
  try {
    const url = new URL(String(raw));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Mercados de segunda mano y productos usados o reacondicionados: entran en la comparación, marcados como «2ª mano».
const SECOND_HAND =
  /wallapop|vinted|milanuncios|segunda mano|reacondicionad|usad[oa]s?\b|seminuev|refurbish|back ?market/i;
// Las que se mandan a Groq para elegir: más no mejoran el resultado y alargan la respuesta.
const MAX_CANDIDATES = 40;

/** Las ofertas con precio y enlace https, marcando las de segunda mano. Aún sin filtrar por si son el producto. */
export function extractOffers(raw: unknown): Offer[] {
  const results = (raw as { shopping_results?: Record<string, unknown>[] } | null)?.shopping_results ?? [];
  return results.flatMap((result): Offer[] => {
    const price = Number(result.extracted_price), url = httpsUrl(result.link ?? result.product_link);
    if (!Number.isFinite(price) || price <= 0 || !url || typeof result.title !== "string") return [];
    const source = typeof result.source === "string" ? result.source.slice(0, 80) : "Tienda";
    return [{
      title: result.title.slice(0, 200),
      price,
      priceText: typeof result.price === "string" ? result.price : `${price} €`,
      source,
      url,
      rating: Number.isFinite(Number(result.rating)) ? Number(result.rating) : null,
      delivery: typeof result.delivery === "string" ? result.delivery.slice(0, 80) : null,
      isSecondHand: SECOND_HAND.test(source) || SECOND_HAND.test(result.title),
    }];
  }).slice(0, MAX_CANDIDATES);
}

/**
 * Plan B si Groq falla: quita lo que cuesta menos del 40 % de la mediana. Sirve cuando casi todo es el producto, pero
 * no cuando la mayoría son juegos o accesorios (al buscar «PS5»): por eso la primera opción es Groq.
 */
export function withoutCheapExtras(offers: Offer[]): Offer[] {
  const sorted = offers.map((offer) => offer.price).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return offers.filter((offer) => offer.price >= median * 0.4);
}

/** De más barata a más cara, una por tienda. */
export function rankOffers(offers: Offer[]): Offer[] {
  const seen = new Set<string>();
  return [...offers].sort((a, b) => a.price - b.price).filter((offer) => {
    const shop = offer.source.toLowerCase();
    if (seen.has(shop)) return false;
    seen.add(shop);
    return true;
  }).slice(0, MAX_OFFERS);
}

/** «PS5» → «consola PlayStation 5»: Google Shopping entiende mejor el producto y salen menos juegos y accesorios. */
export async function refineQuery(query: string): Promise<string> {
  try {
    const raw = await askGroqForJson(
      [
        "Conviertes lo que alguien quiere comprar en una búsqueda precisa para Google Shopping España.",
        "Nombra el producto en sí (no accesorios, juegos ni recambios) con su tipo, marca y modelo.",
        "Ejemplos: «PS5» → «consola PlayStation 5»; «airpods pro» → «auriculares Apple AirPods Pro».",
        "No inventes un modelo, versión o capacidad que no diga. Si ya es preciso, déjalo igual.",
        'Responde solo con JSON {"search_query": "..."}.',
      ].join("\n"),
      query,
    );
    const refined = (raw as { search_query?: unknown } | null)?.search_query;
    return typeof refined === "string" && refined.trim().length >= 2 && refined.length <= 100 ? refined.trim() : query;
  } catch (error) {
    console.error("Precios: Groq no pudo precisar la búsqueda, se usa tal cual:", error);
    return query;
  }
}

/**
 * Las ofertas que son el producto que se quiere comprar, según Groq: fuera juegos, accesorios, recambios y modelos
 * distintos. Si Groq falla, el plan B por precio.
 */
export async function selectMatching(query: string, offers: Offer[]): Promise<Offer[]> {
  if (!offers.length) return [];
  try {
    const list = offers.map((offer, index) => `${index}. ${offer.title} — ${offer.price} € — ${offer.source}`);
    const raw = await askGroqForJson(
      [
        "Decides qué ofertas de tiendas son el producto que alguien quiere comprar.",
        "Quédate solo con el producto en sí, nuevo o de segunda mano. Descarta accesorios, juegos, fundas,",
        "mandos sueltos, recambios,",
        "piezas, productos de otra marca o de otro modelo, y cosas que solo lo mencionan («para PS5»).",
        "Los packs del producto con algo de regalo sí valen. Si el nombre es genérico («PS5»), cualquier versión",
        "del producto principal vale (Slim, Digital, Pro).",
        'Responde solo con JSON {"matches": [números de las ofertas que valen]}; lista vacía si no vale ninguna.',
      ].join(" "),
      `Quiere comprar: ${query}\nOfertas:\n${list.join("\n")}`,
    );
    const matches = (raw as { matches?: unknown } | null)?.matches;
    if (!Array.isArray(matches)) throw new Error("Groq no devolvió la lista de ofertas");
    const chosen = new Set(matches.filter((index) => Number.isInteger(index) && index >= 0 && index < offers.length));
    return offers.filter((_, index) => chosen.has(index));
  } catch (error) {
    console.error("Precios: Groq no pudo elegir las ofertas, se filtra por precio:", error);
    return withoutCheapExtras(offers);
  }
}

/** Búsquedas que quedan este mes. La consulta de la cuenta es gratis: no gasta ninguna. */
export async function searchesLeft(): Promise<number> {
  const url = `${SERPAPI}/account.json?api_key=${encodeURIComponent(requireEnv("SERPAPI_API_KEY"))}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`SerpApi respondió ${response.status} al consultar la cuenta`);
  const account = await response.json();
  return Number(account.total_searches_left ?? account.plan_searches_left ?? 0);
}

/** Busca con la búsqueda precisada y se queda con las ofertas que son el producto, ordenadas. */
async function fetchOffers(query: string): Promise<{ searchQuery: string; offers: Offer[] }> {
  const searchQuery = await refineQuery(query);
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: searchQuery,
    gl: "es",
    hl: "es",
    google_domain: "google.es",
    api_key: requireEnv("SERPAPI_API_KEY"),
  });
  // La clave va en la URL porque SerpApi no admite otra forma: por eso no se incluye en los mensajes de error.
  const response = await fetch(`${SERPAPI}/search.json?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`SerpApi respondió ${response.status} al buscar «${query}»`);
  const data = await response.json();
  if (data.error && !/hasn't returned any results/i.test(String(data.error))) {
    throw new Error(`SerpApi: ${String(data.error).slice(0, 200)}`);
  }
  return { searchQuery, offers: rankOffers(await selectMatching(query, extractOffers(data))) };
}

/** Búsqueda a mano: se para antes de gastar las búsquedas que necesita la vigilancia diaria. */
export async function comparePrices(
  rawQuery: unknown,
): Promise<{ query: string; searchQuery: string; offers: Offer[]; left: number }> {
  const query = validQuery(rawQuery);
  if (!Deno.env.get("SERPAPI_API_KEY")) {
    throw new UserFacingError("El comparador aún no está configurado: falta la clave de SerpApi en Supabase.");
  }
  const left = await searchesLeft();
  if (left <= RESERVED_FOR_WATCHES) {
    throw new UserFacingError(
      `Quedan ${left} búsquedas este mes y las guardo para los productos que vigilas. Se renuevan el mes que viene.`,
    );
  }
  return { query, ...await fetchOffers(query), left: left - 1 };
}

export async function listWatches(db: SupabaseClient): Promise<PriceWatch[]> {
  const { data, error } = await db.from("price_watches").select("*").order("id");
  if (error) throw new Error(`No se pudieron leer los productos vigilados: ${error.message}`);
  return (data as PriceWatch[]).map((watch) => ({
    ...watch,
    max_price: watch.max_price === null ? null : Number(watch.max_price),
    best_price: watch.best_price === null ? null : Number(watch.best_price),
    notified_price: watch.notified_price === null ? null : Number(watch.notified_price),
  }));
}

export async function addWatch(db: SupabaseClient, rawQuery: unknown, rawMaxPrice: unknown): Promise<PriceWatch> {
  const query = validQuery(rawQuery);
  const maxPrice = rawMaxPrice === null || rawMaxPrice === undefined || rawMaxPrice === ""
    ? null
    : Number(String(rawMaxPrice).replace(",", "."));
  if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 100_000)) {
    throw new UserFacingError("El precio para avisarte no es válido.");
  }
  const watches = await listWatches(db);
  const existing = watches.find((watch) => watch.query.toLowerCase() === query.toLowerCase());
  if (!existing && watches.length >= MAX_WATCHES) {
    throw new UserFacingError(`Ya vigilo ${MAX_WATCHES} productos, el máximo para no pasarme de búsquedas. Quita uno.`);
  }
  const row = { query: existing?.query ?? query, max_price: maxPrice, notified_price: null };
  const { data, error } = await db.from("price_watches").upsert(row, { onConflict: "query" }).select("*").single();
  if (error) throw new Error(`No se pudo guardar el producto: ${error.message}`);
  return data as PriceWatch;
}

export async function removeWatch(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("price_watches").delete().eq("id", id);
  if (error) throw new Error(`No se pudo dejar de vigilar: ${error.message}`);
}

const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

/** Si toca avisar con este mejor precio, el texto del aviso; si no, null. */
const secondHandLabel = (offer: Offer) => offer.isSecondHand ? " (2ª mano)" : "";

/** Si toca avisar con este mejor precio, el texto del aviso; si no, null. */
export function priceAlert(watch: PriceWatch, best: Offer): string | null {
  const shop = `${best.source}${secondHandLabel(best)}: ${best.title}\n${best.url}`;
  if (watch.max_price !== null) {
    const isUnderTarget = best.price <= watch.max_price;
    const isNewLow = watch.notified_price === null || best.price < watch.notified_price;
    return isUnderTarget && isNewLow
      ? `🏷️ «${watch.query}» está a ${euros.format(best.price)}, por debajo de ${
        euros.format(watch.max_price)
      }.\n${shop}`
      : null;
  }
  if (watch.best_price !== null && best.price <= watch.best_price * MEANINGFUL_DROP) {
    return `🏷️ «${watch.query}» ha bajado de ${euros.format(watch.best_price)} a ${euros.format(best.price)}.\n${shop}`;
  }
  return null;
}

/** Revisa cada producto vigilado y avisa por Telegram si ha bajado. Devuelve cuántos avisos ha mandado. */
export async function checkPriceWatches(db: SupabaseClient, now: Date): Promise<number> {
  let alerts = 0;
  for (const watch of await listWatches(db)) {
    const best = (await fetchOffers(watch.query)).offers[0];
    if (!best) continue;
    if (watch.best_price !== null && best.price < watch.best_price) {
      const { error } = await db.from("price_drops").insert({ watch_id: watch.id, query: watch.query, old_price: watch.best_price, new_price: best.price, observed_at: now.toISOString() });
      if (error) throw error;
    }
    const alert = priceAlert(watch, best);
    if (alert) {
      await sendTelegramMessage(alert);
      alerts++;
    }
    const { error } = await db.from("price_watches").update({
      best_price: best.price,
      best_source: best.source,
      best_title: best.title,
      best_link: best.url,
      checked_at: now.toISOString(),
      ...(alert ? { notified_price: best.price } : {}),
    }).eq("id", watch.id);
    if (error) throw new Error(`No se pudo guardar el precio de «${watch.query}»: ${error.message}`);
  }
  return alerts;
}

export function formatOffers(query: string, offers: Offer[]): string {
  if (!offers.length) return `No he encontrado precios de «${query}» en tiendas españolas.`;
  const lines = offers.slice(0, 5).map((offer) =>
    `• ${euros.format(offer.price)} en ${offer.source}${secondHandLabel(offer)}: ${offer.title}\n  ${offer.url}`
  );
  return [`🏷️ «${query}», de más barato a más caro:`, ...lines].join("\n");
}

/** Formato que el modelo debe devolver para comparar o vigilar precios (ver message-intent.ts). */
export const PRICES_INTENT_FORMAT =
  'Comparar o vigilar precios de un producto en tiendas: {"intent": "prices", "action": "search", "watch", ' +
  '"unwatch" o "list", "query": el producto o null, "max_price": euros o null}. search: «¿dónde está más barata la ' +
  "PS5?», «compara precios de unos AirPods»; watch: «avísame si la PS5 baja de 400 €» (max_price 400) o «vigila el " +
  "precio de la PS5» (max_price null); unwatch: «deja de vigilar la PS5»; list: «¿qué productos vigilas?».";

export type PricesRequest =
  | { kind: "prices_search"; query: string }
  | { kind: "prices_watch"; query: string; maxPrice: number | null }
  | { kind: "prices_unwatch"; query: string }
  | { kind: "prices_list" }
  | { kind: "invalid"; message: string };

export function parsePricesRequest(raw: unknown): PricesRequest {
  const candidate = raw as { action?: unknown; query?: unknown; max_price?: unknown } | null;
  if (candidate?.action === "list") return { kind: "prices_list" };
  const query = typeof candidate?.query === "string" ? candidate.query.trim().slice(0, 100) : "";
  if (query.length < 2) return { kind: "invalid", message: "¿De qué producto?" };
  if (candidate?.action === "search") return { kind: "prices_search", query };
  if (candidate?.action === "unwatch") return { kind: "prices_unwatch", query };
  if (candidate?.action === "watch") {
    const maxPrice = Number(candidate.max_price);
    return { kind: "prices_watch", query, maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null };
  }
  return { kind: "invalid", message: "No he entendido qué quieres hacer con los precios." };
}

function describeWatch(watch: PriceWatch): string {
  const target = watch.max_price === null
    ? "aviso si baja un 5 %"
    : `aviso por debajo de ${euros.format(watch.max_price)}`;
  const best = watch.best_price === null
    ? "aún sin revisar"
    : `mejor precio ${euros.format(watch.best_price)} en ${watch.best_source}`;
  return `• ${watch.query}: ${best} (${target})`;
}

export async function replyToPrices(db: SupabaseClient, request: PricesRequest): Promise<string> {
  switch (request.kind) {
    case "prices_search": {
      const { query, offers } = await comparePrices(request.query);
      return formatOffers(query, offers);
    }
    case "prices_watch": {
      const watch = await addWatch(db, request.query, request.maxPrice);
      const target = watch.max_price === null
        ? "Te aviso si baja un 5 % o más."
        : `Te aviso cuando baje de ${euros.format(Number(watch.max_price))}.`;
      return `Vigilo «${watch.query}» cada día a las ${PRICE_CHECK_HOUR}:00. ${target}`;
    }
    case "prices_unwatch": {
      const wanted = request.query.toLowerCase();
      const watch = (await listWatches(db)).find((candidate) =>
        candidate.query.toLowerCase().includes(wanted) || wanted.includes(candidate.query.toLowerCase())
      );
      if (!watch) return `No vigilo nada parecido a «${request.query}».`;
      await removeWatch(db, watch.id);
      return `Ya no vigilo «${watch.query}».`;
    }
    case "prices_list": {
      const watches = await listWatches(db);
      return watches.length
        ? ["🏷️ Productos que vigilo:", ...watches.map(describeWatch)].join("\n")
        : "No vigilo ningún producto. Dime, por ejemplo, «avísame si la PS5 baja de 400 €».";
    }
    case "invalid":
      return request.message;
  }
}

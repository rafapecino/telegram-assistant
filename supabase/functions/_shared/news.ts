// Titulares de periódicos por tema, desde sus RSS públicos: sin clave, sin coste y sin límites prácticos.
import { XMLParser } from "npm:fast-xml-parser@4.5.0";

interface Feed {
  source: string;
  url: string;
}

const ELPAIS = "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com";
const elPais = (section: string): Feed => ({ source: "El País", url: `${ELPAIS}/section/${section}/portada` });

export const NEWS_TOPICS: Record<string, { label: string; feeds: Feed[] }> = {
  destacadas: {
    label: "Destacadas",
    feeds: [
      { source: "El País", url: `${ELPAIS}/portada` },
      { source: "elDiario.es", url: "https://www.eldiario.es/rss/" },
      { source: "20minutos", url: "https://www.20minutos.es/rss/" },
    ],
  },
  espana: {
    label: "España",
    feeds: [elPais("espana"), { source: "La Vanguardia", url: "https://www.lavanguardia.com/rss/home.xml" }],
  },
  mundo: {
    label: "Mundo",
    feeds: [elPais("internacional"), { source: "BBC Mundo", url: "https://feeds.bbci.co.uk/mundo/rss.xml" }],
  },
  madrid: { label: "Madrid", feeds: [{ source: "Telemadrid", url: "https://www.telemadrid.es/rss/" }] },
  economia: {
    label: "Economía",
    feeds: [elPais("economia"), { source: "Expansión", url: "https://e00-expansion.uecdn.es/rss/portada.xml" }],
  },
  tecnologia: {
    label: "Tecnología",
    feeds: [elPais("tecnologia"), { source: "Xataka", url: "https://www.xataka.com/feedburner.xml" }],
  },
  ciencia: { label: "Ciencia", feeds: [elPais("ciencia")] },
  salud: { label: "Salud", feeds: [elPais("salud-y-bienestar")] },
  clima: { label: "Clima y medio ambiente", feeds: [elPais("clima-y-medio-ambiente")] },
  deportes: { label: "Deportes", feeds: [elPais("deportes")] },
  cultura: { label: "Cultura", feeds: [elPais("cultura")] },
  gastronomia: { label: "Gastronomía", feeds: [elPais("gastronomia")] },
};

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  summary: string;
}

const MAX_SUMMARY = 220;
// Algunos RSS dejan noticias de hace años (RTVE llegó a tener las de 2022): más viejas que esto no se enseñan. Una
// semana deja contenido en las secciones que publican poco, como Ciencia.
const MAX_AGE_DAYS = 7;
const CACHE_MINUTES = 15;
const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });

// Las que usan los RSS en español; el resto suele venir como &#número;.
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", iexcl: "¡", iquest: "¿", euro: "€",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
};

/** Texto plano de un campo del RSS: sin etiquetas HTML ni entidades, y en una sola línea. */
export function plainText(raw: unknown): string {
  // Un campo repetido llega como lista: Telemadrid pone el titular y, con el mismo nombre, el pie de la foto.
  const value = Array.isArray(raw) ? raw[0] : raw;
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  const decode = (value: string) =>
    value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#")) {
        const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
      }
      return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? entity;
    });
  // Se decodifica antes y después de quitar etiquetas: hay RSS con el HTML escapado (&lt;p&gt;).
  return decode(decode(text).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function shorten(text: string): string {
  if (text.length <= MAX_SUMMARY) return text;
  return `${text.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, "")}…`;
}

/** Solo enlaces web: un `javascript:` en un RSS manipulado se ejecutaría al pulsarlo en el panel. */
function safeUrl(raw: unknown): string | null {
  const text = plainText(raw);
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function parseFeed(xml: string, source: string, now: Date): NewsItem[] {
  const channel = xmlParser.parse(xml)?.rss?.channel;
  const rawItems = channel?.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];
  const oldest = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const items: NewsItem[] = [];
  for (const raw of rawItems as Record<string, unknown>[]) {
    const title = plainText(raw.title), url = safeUrl(raw.link);
    if (!title || !url) continue;
    const published = raw.pubDate ? new Date(plainText(raw.pubDate)) : null;
    const publishedAt = published && !Number.isNaN(published.getTime()) ? published : null;
    if (publishedAt && publishedAt.getTime() < oldest) continue;
    items.push({
      title,
      url,
      source,
      publishedAt: publishedAt?.toISOString() ?? null,
      summary: shorten(plainText(raw.description)),
    });
  }
  return items;
}

async function fetchFeed(feed: Feed, now: Date): Promise<NewsItem[]> {
  const response = await fetch(feed.url, {
    headers: { "User-Agent": "MiAsistente/1.0 (panel personal)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`${feed.source} respondió ${response.status}`);
  return parseFeed(await response.text(), feed.source, now);
}

/** Las más recientes primero, mezclando medios y sin repetir enlace ni titular. */
export function mergeNews(lists: NewsItem[][], limit: number): NewsItem[] {
  const seen = new Set<string>();
  return lists.flat()
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (seen.has(item.url) || seen.has(key)) return false;
      seen.add(item.url).add(key);
      return true;
    })
    .slice(0, limit);
}

const cache = new Map<string, { items: NewsItem[]; fetchedAt: number }>();

/**
 * Titulares de un tema. Se guardan unos minutos en memoria para no pedir los RSS en cada visita. Si un medio falla,
 * se enseñan los demás; si fallan todos, es un error.
 */
export async function loadNews(topic: string, limit: number, now = new Date()): Promise<NewsItem[]> {
  const cached = cache.get(topic);
  if (cached && now.getTime() - cached.fetchedAt < CACHE_MINUTES * 60_000) return cached.items.slice(0, limit);
  const feeds = NEWS_TOPICS[topic].feeds;
  const results = await Promise.allSettled(feeds.map((feed) => fetchFeed(feed, now)));
  const failures = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
  for (const failure of failures) console.error(`No se pudieron leer las noticias de ${topic}:`, failure.reason);
  if (failures.length === feeds.length) throw new Error(`No se pudieron leer las noticias de ${topic}.`);
  const items = mergeNews(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []), 30);
  cache.set(topic, { items, fetchedAt: now.getTime() });
  return items.slice(0, limit);
}

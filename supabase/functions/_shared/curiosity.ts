// La curiosidad del día: algo que pasó un día como hoy, de la Wikipedia en español.
const ON_THIS_DAY = "https://api.wikimedia.org/feed/v1/wikipedia/es/onthisday/events";
// Wikimedia pide identificarse con un User-Agent que diga quién llama.
const USER_AGENT = "MiAsistente/1.0 (https://github.com/rafapecino/telegram-assistant)";

export interface Curiosity {
  year: number;
  text: string;
  url: string | null;
}

/** Elige siempre el mismo suceso para la misma fecha: así el panel y Telegram dicen lo mismo todo el día. */
export function pickForDate<T>(items: T[], date: string): T | null {
  if (!items.length) return null;
  let hash = 0;
  for (const character of date) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return items[hash % items.length];
}

export function parseEvents(raw: unknown): Curiosity[] {
  const events = (raw as { events?: unknown[] } | null)?.events ?? [];
  return events.flatMap((event) => {
    const { text, year, pages } = event as {
      text?: unknown;
      year?: unknown;
      pages?: { content_urls?: { desktop?: { page?: string } } }[];
    };
    // Los textos muy cortos no se entienden y los muy largos no caben en el resumen de la mañana.
    if (typeof text !== "string" || text.length < 40 || text.length > 300 || !Number.isInteger(year)) return [];
    const page = pages?.[0]?.content_urls?.desktop?.page;
    const clean = text.trim().replace(/\s+/g, " ");
    return [{
      year: year as number,
      text: clean.charAt(0).toUpperCase() + clean.slice(1),
      url: typeof page === "string" && page.startsWith("https://") ? page : null,
    }];
  });
}

const cache = new Map<string, Curiosity>();

/** `date` en formato YYYY-MM-DD (hora de Madrid). */
export async function fetchCuriosity(date: string): Promise<Curiosity> {
  const cached = cache.get(date);
  if (cached) return cached;
  const [, month, day] = date.split("-");
  const response = await fetch(`${ON_THIS_DAY}/${month}/${day}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Wikipedia respondió ${response.status}`);
  const curiosity = pickForDate(parseEvents(await response.json()), date);
  if (!curiosity) throw new Error("Wikipedia no tiene sucesos para hoy.");
  cache.set(date, curiosity);
  return curiosity;
}

export function formatCuriosity(curiosity: Curiosity): string {
  return `🧠 Un día como hoy, en ${curiosity.year}: ${curiosity.text}`;
}

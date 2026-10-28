import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { loadNews, mergeNews, NEWS_TOPICS, parseFeed, plainText } from "./news.ts";
import { withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-28T10:00:00Z");

function rss(items: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join("")}</channel></rss>`;
}
const item = (title: string, link: string, date = "Wed, 28 Oct 2026 08:00:00 GMT", description = "") =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate>` +
  `<description><![CDATA[${description}]]></description></item>`;

Deno.test("quita el HTML, también el escapado, y deja el texto en una línea", () => {
  assertEquals(plainText('<p><img src="x.jpg">Hola&nbsp;<b>mundo</b></p>\n'), "Hola mundo");
  assertEquals(plainText("&lt;li&gt;Se&amp;ntilde;al&lt;/li&gt;"), "Señal");
  assertEquals(plainText("Precio &#8364; 5 &#x2014; ya"), "Precio € 5 — ya");
  assertEquals(plainText(["Titular", "Pie de foto"]), "Titular");
});

Deno.test("lee titular, enlace, fecha y resumen; descarta enlaces que no son web y noticias viejas", () => {
  const xml = rss([
    item("Buena", "https://elpais.com/a.html", undefined, "<p>Resumen <b>corto</b></p>"),
    item("Trampa", "javascript:alert(1)"),
    item("Vieja", "https://elpais.com/v.html", "Fri, 10 Jun 2022 01:05:00 +0200"),
    item("", "https://elpais.com/sin-titulo.html"),
  ]);
  assertEquals(parseFeed(xml, "El País", NOW), [{
    title: "Buena",
    url: "https://elpais.com/a.html",
    source: "El País",
    publishedAt: "2026-10-28T08:00:00.000Z",
    summary: "Resumen corto",
  }]);
  assertEquals(parseFeed(rss([item("Una sola", "https://x.es/1")]), "X", NOW).length, 1);
  assertEquals(parseFeed("<html>no es un rss</html>", "X", NOW), []);
});

Deno.test("los resúmenes largos se cortan en una palabra", () => {
  const summary = parseFeed(rss([item("T", "https://x.es/1", undefined, "palabra ".repeat(60))]), "X", NOW)[0].summary;
  assertEquals(summary.length <= 221 && summary.endsWith("palabra…"), true);
});

Deno.test("mezcla medios por fecha y no repite la misma noticia", () => {
  const news = (title: string, url: string, publishedAt: string) => ({
    title,
    url,
    source: "X",
    publishedAt,
    summary: "",
  });
  const merged = mergeNews([
    [news("A", "https://a/1", "2026-10-28T08:00:00Z"), news("B", "https://a/2", "2026-10-28T06:00:00Z")],
    [news("C", "https://b/1", "2026-10-28T09:00:00Z"), news("a", "https://b/9", "2026-10-28T07:00:00Z")],
  ], 10);
  assertEquals(merged.map((item) => item.title), ["C", "A", "B"]);
});

Deno.test("si un medio falla se enseñan los demás; si fallan todos, es un error", async () => {
  const [first, second] = NEWS_TOPICS.economia.feeds;
  const oneDown = (request: Request) =>
    request.url === first.url
      ? new Response("caído", { status: 503 })
      : new Response(rss([item("Bolsa", "https://e.es/1")]));
  await withFakeFetch({}, oneDown, async () => {
    const items = await loadNews("economia", 5, NOW);
    assertEquals(items.map((news) => [news.title, news.source]), [["Bolsa", second.source]]);
  });
  await withFakeFetch({}, () => new Response("caído", { status: 503 }), async () => {
    await assertRejects(() => loadNews("deportes", 5, NOW), Error, "deportes");
  });
});

Deno.test("guarda los titulares unos minutos para no pedir los RSS en cada visita", async () => {
  await withFakeFetch({}, () => new Response(rss([item("Gol", "https://d.es/1")])), async (requests) => {
    await loadNews("cultura", 1, NOW);
    await loadNews("cultura", 1, new Date(NOW.getTime() + 5 * 60_000));
    assertEquals(requests.length, 1);
    await loadNews("cultura", 1, new Date(NOW.getTime() + 20 * 60_000));
    assertEquals(requests.length, 2);
  });
});

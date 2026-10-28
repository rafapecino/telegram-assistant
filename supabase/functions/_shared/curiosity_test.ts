import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { fetchCuriosity, formatCuriosity, parseEvents, pickForDate } from "./curiosity.ts";
import { withFakeFetch } from "./testing.ts";

const event = (year: number, text: string) => ({
  year,
  text,
  pages: [{ content_urls: { desktop: { page: `https://es.wikipedia.org/wiki/${year}` } } }],
});

Deno.test("se queda con sucesos de longitud razonable y empieza en mayúscula", () => {
  assertEquals(
    parseEvents({
      events: [
        event(1886, "se inaugura la Estatua de la Libertad en Nueva York, regalo de Francia."),
        event(2000, "corto"),
        { text: "x".repeat(60) },
      ],
    }),
    [{
      year: 1886,
      text: "Se inaugura la Estatua de la Libertad en Nueva York, regalo de Francia.",
      url: "https://es.wikipedia.org/wiki/1886",
    }],
  );
  assertEquals(parseEvents(null), []);
});

Deno.test("el mismo día elige siempre el mismo suceso", () => {
  const items = ["a", "b", "c", "d", "e"];
  assertEquals(pickForDate(items, "2026-10-28"), pickForDate(items, "2026-10-28"));
  assertEquals(pickForDate([], "2026-10-28"), null);
});

Deno.test("pide los sucesos del día con un User-Agent propio y los guarda", async () => {
  const body = { events: [event(1886, "Se inaugura la Estatua de la Libertad en Nueva York, regalo de Francia.")] };
  await withFakeFetch({}, () => Response.json(body), async (requests) => {
    const curiosity = await fetchCuriosity("2026-10-28");
    assertEquals(formatCuriosity(curiosity).startsWith("🧠 Un día como hoy, en 1886: Se inaugura"), true);
    assertEquals(new URL(requests[0].url).pathname.endsWith("/onthisday/events/10/28"), true);
    assertEquals(requests[0].headers.get("User-Agent")?.startsWith("MiAsistente/1.0"), true);
    await fetchCuriosity("2026-10-28");
    assertEquals(requests.length, 1);
  });
  await withFakeFetch({}, () => new Response("", { status: 429 }), async () => {
    await assertRejects(() => fetchCuriosity("2026-10-29"), Error, "429");
  });
});

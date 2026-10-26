import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  describeAlert,
  extractXmlDocuments,
  fetchWeatherAlerts,
  morningAlertLines,
  notifyNewWeatherAlerts,
  parseCapAlert,
  type WeatherAlert,
} from "./aemet.ts";
import { fakeDb, TELEGRAM_ENV, withFakeFetch } from "./testing.ts";

// 12:00 en Madrid.
const NOW = new Date("2026-10-26T11:00:00Z");
const DATA_URL = "https://opendata.aemet.es/opendata/sh/datos-avisos";

/** Un aviso CAP 1.2 como los de AEMET: una parte en español y otra en inglés. */
function capXml(options: { id: string; level: string; onset: string; expires: string; msgType?: string }): string {
  const info = (language: string, event: string) => `
  <info>
    <language>${language}</language>
    <category>Met</category>
    <event>${event}</event>
    <onset>${options.onset}</onset>
    <expires>${options.expires}</expires>
    <headline>${event}. Metropolitana y Henares</headline>
    <parameter><valueName>AEMET-Meteoalerta nivel</valueName><value>${options.level}</value></parameter>
    <parameter><valueName>AEMET-Meteoalerta probabilidad</valueName><value>40%-70%</value></parameter>
    <area>
      <areaDesc>Metropolitana y Henares</areaDesc>
      <geocode><valueName>AEMET-Meteoalerta zona</valueName><value>722802</value></geocode>
    </area>
  </info>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${options.id}</identifier>
  <sender>http://www.aemet.es</sender>
  <sent>2026-10-26T10:00:00+01:00</sent>
  <status>Actual</status>
  <msgType>${options.msgType ?? "Alert"}</msgType>
  <scope>Public</scope>
  ${info("es-ES", `Aviso de lluvias de nivel ${options.level}`)}
  ${info("en-GB", `${options.level} warning for rain`)}
</alert>`;
}

const RAIN = capXml({
  id: "aviso-lluvia",
  level: "amarillo",
  onset: "2026-10-26T14:00:00+01:00",
  expires: "2026-10-26T23:59:00+01:00",
});
const GREEN = capXml({
  id: "verde",
  level: "verde",
  onset: "2026-10-26T14:00:00+01:00",
  expires: "2026-10-26T23:59:00+01:00",
});
const OVER = capXml({
  id: "pasado",
  level: "naranja",
  onset: "2026-10-26T00:00:00+01:00",
  expires: "2026-10-26T06:00:00+01:00",
});

/** Un .tar mínimo: cabecera de 512 bytes con nombre y tamaño en octal, y el contenido rellenado hasta 512. */
function buildTar(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [name, text] of Object.entries(files)) {
    const content = encoder.encode(text);
    const header = new Uint8Array(512);
    header.set(encoder.encode(name), 0);
    header.set(encoder.encode(content.length.toString(8).padStart(11, "0") + "\0"), 124);
    blocks.push(header, content, new Uint8Array((512 - content.length % 512) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const tar = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }
  return tar;
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** AEMET de prueba: primero da la URL de los datos y luego el fichero. */
function aemet(file: Uint8Array) {
  return (request: Request) =>
    request.url === DATA_URL
      ? new Response(file.slice())
      : Response.json({ descripcion: "exito", estado: 200, datos: DATA_URL, metadatos: "https://x" });
}

const ENV = { AEMET_API_KEY: "clave-aemet", ...TELEGRAM_ENV };

Deno.test("lee la parte en español del aviso; descarta los verdes y los cancelados", () => {
  assertEquals(parseCapAlert(RAIN), {
    id: "aviso-lluvia",
    level: "amarillo",
    event: "Aviso de lluvias de nivel amarillo",
    zone: "Metropolitana y Henares",
    onset: new Date("2026-10-26T13:00:00Z"),
    expires: new Date("2026-10-26T22:59:00Z"),
  });
  assertEquals(parseCapAlert(GREEN), null);
  assertEquals(parseCapAlert(RAIN.replace("<msgType>Alert", "<msgType>Cancel")), null);
  assertEquals(parseCapAlert("<html>error</html>"), null);
});

Deno.test("saca los XML del .tar, comprimido o no, y acepta un XML suelto", async () => {
  const tar = buildTar({ "a.xml": RAIN, "b.xml": GREEN, "leeme.txt": "x" });
  assertEquals(await extractXmlDocuments(tar), [RAIN, GREEN]);
  assertEquals(await extractXmlDocuments(await gzip(tar)), [RAIN, GREEN]);
  assertEquals(await extractXmlDocuments(new TextEncoder().encode(RAIN)), [RAIN]);
});

Deno.test("pide los avisos de la Comunidad de Madrid con la clave y descarga el fichero", async () => {
  await withFakeFetch(ENV, aemet(buildTar({ "a.xml": RAIN, "b.xml": GREEN })), async (requests) => {
    const alerts = await fetchWeatherAlerts([]);
    assertEquals(alerts.map((alert) => alert.id), ["aviso-lluvia"]);
    assertEquals(requests[0].url, "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/72");
    assertEquals(requests[0].headers.get("api_key"), "clave-aemet");
  });
});

Deno.test("sin avisos AEMET responde 404 y no es un error; con la clave mal, sí", async () => {
  const noData = () => Response.json({ descripcion: "No hay datos que satisfagan esos criterios", estado: 404 });
  await withFakeFetch(ENV, noData, async () => assertEquals(await fetchWeatherAlerts([]), []));
  const badKey = () => Response.json({ descripcion: "API key invalido", estado: 401 }, { status: 401 });
  await withFakeFetch(ENV, badKey, async () => {
    await assertRejects(() => fetchWeatherAlerts([]), Error, "API key invalido");
  });
});

Deno.test("reintenta cuando AEMET está saturada", async () => {
  let calls = 0;
  const flaky = (request: Request) =>
    calls++ === 0 ? new Response("", { status: 429 }) : aemet(buildTar({ "a.xml": RAIN }))(request);
  await withFakeFetch(ENV, flaky, async () => {
    assertEquals((await fetchWeatherAlerts([0])).length, 1);
  });
});

Deno.test("el resumen de la mañana solo enseña los avisos de hoy que no han terminado", () => {
  const rain = parseCapAlert(RAIN)!;
  const over = parseCapAlert(OVER)!;
  const tomorrow: WeatherAlert = { ...rain, id: "mañana", onset: new Date("2026-10-27T08:00:00Z") };
  assertEquals(morningAlertLines([rain, over, tomorrow], NOW), [
    "⚠️ Avisos de AEMET para hoy:",
    describeAlert(rain),
  ]);
  assertEquals(morningAlertLines([over], NOW), []);
});

Deno.test("cada aviso se manda una sola vez", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [{ id: "aviso-lluvia" }] } : {});
  const tar = buildTar({ "a.xml": RAIN, "c.xml": OVER });
  await withFakeFetch(ENV, aemet(tar), async (requests) => {
    // El de lluvia ya se mandó y el naranja ya ha terminado: no se manda nada.
    assertEquals(await notifyNewWeatherAlerts(db, NOW), 0);
    assertEquals(requests.some((request) => request.url.includes("api.telegram.org")), false);
  });
  assertEquals(queries.some((query) => query[1].startsWith("insert(")), false);
});

Deno.test("un aviso nuevo se manda por Telegram y se apunta", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [] } : {});
  const respond = (request: Request) =>
    request.url.includes("api.telegram.org")
      ? Response.json({ ok: true })
      : aemet(buildTar({ "a.xml": RAIN }))(request);
  await withFakeFetch(ENV, respond, async (requests) => {
    assertEquals(await notifyNewWeatherAlerts(db, NOW), 1);
    const sent = await requests.find((request) => request.url.includes("api.telegram.org"))!.json();
    assertEquals(sent.text, `⚠️ Nuevo aviso de AEMET:\n${describeAlert(parseCapAlert(RAIN)!)}`);
  });
  assertEquals(queries.at(-1), ['from("weather_alerts_sent")', 'insert([{"id":"aviso-lluvia"}])']);
});

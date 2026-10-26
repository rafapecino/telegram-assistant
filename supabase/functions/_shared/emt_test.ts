import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { fetchArrivals, formatArrivals, parseBusRequest, replyToBus, resolveStop } from "./emt.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const EMT_ENV = { EMT_EMAIL: "rafa@x.com", EMT_PASSWORD: "clave" };
const NOW = new Date("2026-10-22T10:00:00Z");
const STOPS = [{ id: 1, name: "Casa", stop_id: "62" }];

// Respuestas con la forma de los ejemplos de la documentación oficial (apidocs.emtmadrid.es).
const LOGIN = { code: "00", description: "Register user", data: [{ accessToken: "token-emt" }] };
const ARRIVALS = {
  code: "00",
  description: "Data recovered OK",
  data: [{
    Arrive: [
      { line: "45", stop: "62", destination: "REINA VICTORIA", estimateArrive: 71, DistanceBus: 363 },
      { line: "5", stop: "62", destination: "CHAMARTIN", estimateArrive: 30, DistanceBus: 50 },
      { line: "45", stop: "62", destination: "REINA VICTORIA", estimateArrive: 999999, DistanceBus: 9000 },
      { line: "45", stop: "62", destination: "REINA VICTORIA", estimateArrive: 640, DistanceBus: 2000 },
    ],
  }],
};

function emt(arrivals: unknown = ARRIVALS) {
  return (request: Request) => Response.json(request.url.includes("/user/login/") ? LOGIN : arrivals);
}

Deno.test("entiende consultar, guardar, olvidar y listar paradas", () => {
  assertEquals(parseBusRequest({ action: "arrivals", stop: "casa", line: "27" }), {
    kind: "bus_arrivals",
    stop: "casa",
    line: "27",
  });
  assertEquals(parseBusRequest({ action: "save", name: "casa", stop_id: 1234 }), {
    kind: "bus_stop_save",
    name: "Casa",
    stopId: "1234",
  });
  assertEquals(parseBusRequest({ action: "save", name: "casa", stop_id: "calle mayor" }).kind, "invalid");
  assertEquals(parseBusRequest({ action: "delete", name: "casa" }), { kind: "bus_stop_delete", name: "Casa" });
  assertEquals(parseBusRequest({ action: "list" }), { kind: "bus_stop_list" });
  assertEquals(parseBusRequest({ action: "arrivals", stop: "" }).kind, "invalid");
});

Deno.test("la parada se busca por número o por el nombre guardado", () => {
  assertEquals(resolveStop(STOPS, "62"), { stopId: "62", label: "Casa (62)" });
  assertEquals(resolveStop(STOPS, "1234"), { stopId: "1234", label: "Parada 1234" });
  assertEquals(resolveStop(STOPS, "la parada de casa"), { stopId: "62", label: "Casa (62)" });
  assertEquals(resolveStop(STOPS, "trabajo"), null);
});

Deno.test("inicia sesión con el correo y pide las llegadas de la parada", async () => {
  await withFakeFetch(EMT_ENV, emt(), async (requests) => {
    const arrivals = await fetchArrivals("62", NOW);
    assertEquals(arrivals.length, 4);
    assertEquals(requests[0].headers.get("email"), "rafa@x.com");
    assertEquals(requests[1].url, "https://openapi.emtmadrid.es/v2/transport/busemtmad/stops/62/arrives/");
    assertEquals(requests[1].headers.get("accessToken"), "token-emt");
    const body = await requests[1].json();
    assertEquals(body.Text_EstimationsRequired_YN, "Y");
    assertEquals(body.DateTime_Referenced_Incidencies_YYYYMMDD, "20261022");
  });
});

Deno.test("agrupa por línea y destino, en orden, y filtra por línea si se pide", () => {
  const arrivals = ARRIVALS.data[0].Arrive.map((arrival) => ({
    line: arrival.line,
    destination: arrival.destination,
    seconds: arrival.estimateArrive,
  }));
  assertEquals(
    formatArrivals("Casa (62)", arrivals, null),
    "🚌 Casa (62):\n• 5 → CHAMARTIN: llegando\n• 45 → REINA VICTORIA: 1 min, 11 min, más de 45 min",
  );
  assertEquals(formatArrivals("Casa (62)", arrivals, "5"), "🚌 Casa (62):\n• 5 → CHAMARTIN: llegando");
  assertEquals(formatArrivals("Casa (62)", arrivals, "27"), "🚌 Casa (62): ahora no hay llegadas previstas del 27.");
  assertEquals(formatArrivals("Parada 1", [], null), "🚌 Parada 1: ahora no hay buses previstos.");
});

Deno.test("una parada sin guardar no llama a la EMT; un error de la EMT se explica", async () => {
  const { db } = fakeDb(() => ({ data: STOPS }));
  await withFakeFetch(EMT_ENV, emt(), async (requests) => {
    assertStringIncludes(
      await replyToBus(db, { kind: "bus_arrivals", stop: "trabajo", line: null }, NOW),
      "No tengo guardada la parada «trabajo»",
    );
    assertEquals(requests.length, 0);
  });
  await withFakeFetch(EMT_ENV, emt({ code: "90", description: "Stop not found" }), async () => {
    await assertRejects(() => fetchArrivals("99999", NOW), Error, "Stop not found");
  });
});

Deno.test("si la EMT no deja iniciar sesión, lo dice", async () => {
  const badLogin = () => Response.json({ code: "89", description: "Wrong user or password", data: [] });
  await withFakeFetch(EMT_ENV, badLogin, async () => {
    await assertRejects(() => fetchArrivals("62", NOW), Error, "Wrong user or password");
  });
});

Deno.test("guardar una parada sustituye a la que tuviera el mismo nombre", async () => {
  const { db, queries } = fakeDb(() => ({}));
  assertStringIncludes(await replyToBus(db, { kind: "bus_stop_save", name: "Casa", stopId: "62" }, NOW), "es la 62");
  assertEquals(queries[0], [
    'from("bus_stops")',
    'upsert({"name":"Casa","stop_id":"62"}, {"onConflict":"name"})',
  ]);
});

import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { type BusStop, fetchArrivals, formatArrivals, parseBusRequest, replyToBus, resolveStop } from "./emt.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const EMT_ENV = { EMT_EMAIL: "rafa@x.com", EMT_PASSWORD: "clave" };
const NOW = new Date("2026-10-22T10:00:00Z");
const STOPS: BusStop[] = [{ id: 1, name: "Casa", stop_id: "62", network: "emt" }];

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
    network: null,
  });
  assertEquals(parseBusRequest({ action: "save", name: "casa", stop_id: 1234 }), {
    kind: "bus_stop_save",
    name: "Casa",
    stopId: "1234",
    network: "emt",
  });
  assertEquals(parseBusRequest({ action: "save", name: "casa", stop_id: "calle mayor" }).kind, "invalid");
  assertEquals(parseBusRequest({ action: "delete", name: "casa" }), { kind: "bus_stop_delete", name: "Casa" });
  assertEquals(parseBusRequest({ action: "list" }), { kind: "bus_stop_list" });
  assertEquals(parseBusRequest({ action: "arrivals", stop: "" }).kind, "invalid");
});

Deno.test("la parada se busca por número o por el nombre guardado", () => {
  assertEquals(resolveStop(STOPS, "62"), { stopIds: ["62"], label: "Casa (62)", network: "emt" });
  assertEquals(resolveStop(STOPS, "1234"), { stopIds: ["1234"], label: "Parada 1234", network: "emt" });
  assertEquals(resolveStop(STOPS, "la parada de casa"), { stopIds: ["62"], label: "Casa (62)", network: "emt" });
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
      await replyToBus(db, { kind: "bus_arrivals", stop: "trabajo", line: null, network: null }, NOW),
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
  assertStringIncludes(
    await replyToBus(db, { kind: "bus_stop_save", name: "Casa", stopId: "62", network: "emt" }, NOW),
    "es la 62",
  );
  assertEquals(queries[0], [
    'from("bus_stops")',
    'upsert({"name":"Casa","stop_id":"62","network":"emt"}, {"onConflict":"name"})',
  ]);
});

Deno.test("entiende interurbanos y los busca por código o por el nombre de la marquesina", () => {
  assertEquals(parseBusRequest({ action: "arrivals", stop: "Universidad", line: "627", network: "interurbano" }), {
    kind: "bus_arrivals",
    stop: "Universidad",
    line: "627",
    network: "interurbano",
  });
  assertEquals(parseBusRequest({ action: "save", name: "trabajo", stop_id: "10590", network: "interurbano" }), {
    kind: "bus_stop_save",
    name: "Trabajo",
    stopId: "10590",
    network: "interurbano",
  });
  assertEquals(resolveStop(STOPS, "10590", "interurbano"), {
    stopIds: ["10590"],
    label: "CASTILLO ANTEQUERA-UNIVERSIDAD (10590)",
    network: "interurbano",
  });
  // Por nombre salen las dos marquesinas, una por sentido.
  assertEquals(resolveStop(STOPS, "Antequera-Universidad", "interurbano"), {
    stopIds: ["10589", "10590"],
    label: "CASTILLO ANTEQUERA-UNIVERSIDAD (10589 y 10590)",
    network: "interurbano",
  });
  const work: BusStop = { id: 2, name: "Trabajo", stop_id: "10590", network: "interurbano" };
  assertEquals(resolveStop([work], "trabajo"), {
    stopIds: ["10590"],
    label: "Trabajo (10590)",
    network: "interurbano",
  });
});

Deno.test("sin parada, enseña las interurbanas guardadas; una guardada puede juntar varios códigos", async () => {
  assertEquals(parseBusRequest({ action: "arrivals", stop: null, line: "627", network: "interurbano" }), {
    kind: "bus_arrivals",
    stop: "",
    line: "627",
    network: "interurbano",
  });
  const saved: BusStop[] = [
    { id: 1, name: "Casa", stop_id: "62", network: "emt" },
    { id: 2, name: "Moncloa", stop_id: "06002,2419", network: "interurbano" },
    { id: 3, name: "Villanueva", stop_id: "11162", network: "interurbano" },
  ];
  const { db } = fakeDb(() => ({ data: saved }));
  await withFakeFetch({}, () => Response.json({}), async () => {
    const reply = await replyToBus(db, { kind: "bus_arrivals", stop: "", line: "627", network: "interurbano" }, NOW);
    assertStringIncludes(reply, "🚌 Moncloa (06002 y 2419):\n• 627 → ");
    assertStringIncludes(reply, "🚌 Villanueva (11162):\n• 627 → INTERCAMBIADOR MONCLOA");
    assertEquals(reply.split("Datos: CRTM").length, 2);
    assertEquals(reply.includes("Casa"), false);
  });
});

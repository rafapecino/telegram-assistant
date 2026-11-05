import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  dayTimetable,
  formatInterurbanDepartures,
  formatLastOfDay,
  interurbanDepartures,
  isLineOrigin,
  parseStopTimes,
  scheduledDepartures,
  weekTimetables,
} from "./crtm.ts";
import { withFakeFetch } from "./testing.ts";

// Jueves 5 de noviembre de 2026, 10:00 en Madrid.
const NOW = new Date("2026-11-05T09:00:00Z");
const UNIVERSIDAD = "10590";
const time = (line: string, at: string) => ({
  line: { codLine: `8__${line}___`, shortDescription: line },
  destination: "MADRID (Interc.Moncloa)-VILLANUEVA DE LA CAÑADA/BRUNETE",
  destinationStop: { codStop: "8_11160", name: "ERAS-CEMENTERIO" },
  time: at,
});

Deno.test("lee los pasos del CRTM, aunque solo venga uno y no en lista", () => {
  const one = { stopTimes: { times: { Time: time("627", "2026-11-05T10:36:01+01:00") } } };
  assertEquals(parseStopTimes(one), [{
    line: "627",
    destination: "ERAS-CEMENTERIO",
    at: new Date("2026-11-05T09:36:01Z"),
    isScheduled: false,
  }]);
  assertEquals(parseStopTimes({ stopTimes: { times: {} } }), []);
  assertEquals(parseStopTimes(null), []);
});

Deno.test("del horario saca las próximas salidas; el N907 de madrugada cuenta como noche anterior", () => {
  const n907 = scheduledDepartures(UNIVERSIDAD, "N907", NOW);
  assertEquals(n907.length > 0, true);
  assertEquals(n907.every((departure) => departure.line === "N907" && departure.isScheduled), true);
  assertEquals(n907[0].at > NOW, true);
  const day627 = scheduledDepartures(UNIVERSIDAD, "627", NOW);
  assertEquals(day627[0].at > NOW && day627[0].at.getTime() - NOW.getTime() < 3 * 3600_000, true);
});

Deno.test("usa el tiempo real; si el CRTM falla o no trae la línea, el horario", async () => {
  const realtime = {
    stopTimes: {
      times: { Time: [time("626", "2026-11-05T10:16:03+01:00"), time("627", "2026-11-05T10:36:01+01:00")] },
    },
  };
  await withFakeFetch({}, () => Response.json(realtime), async (requests) => {
    const [first] = await interurbanDepartures(["10588"], "627", NOW);
    assertEquals(first.isScheduled, false);
    assertEquals(new URL(requests[0].url).searchParams.get("codStop"), "8_10588");
    const night = await interurbanDepartures(["10588"], "N907", NOW);
    assertEquals(night.every((departure) => departure.isScheduled), true);
  });
  await withFakeFetch({}, () => new Response("", { status: 503 }), async () => {
    const departures = await interurbanDepartures([UNIVERSIDAD], "627", new Date("2026-11-05T09:30:00Z"));
    assertEquals(departures.length > 0 && departures.every((departure) => departure.isScheduled), true);
  });
});

Deno.test("la respuesta da hora, espera y si es según horario, con la atribución del CRTM", () => {
  const text = formatInterurbanDepartures(
    "Trabajo (10590)",
    [
      { line: "627", destination: "MADRID", at: new Date("2026-11-05T09:36:00Z"), isScheduled: false },
      { line: "N907", destination: "MONCLOA", at: new Date("2026-11-06T00:15:00Z"), isScheduled: true },
    ],
    null,
    NOW,
  );
  assertEquals(
    text,
    "🚌 Trabajo (10590):\n• 627 → MADRID: 10:36 (en 36 min)\n• N907 → MONCLOA: 01:15 de mañana, horario\nDatos: CRTM",
  );
  assertStringIncludes(formatInterurbanDepartures("Parada 1", [], "627", NOW), "no encuentro próximos pasos del 627");
});

Deno.test("en la cabecera de Moncloa usa directamente el horario de salida, sin preguntar al CRTM", async () => {
  assertEquals(isLineOrigin("06002"), true);
  assertEquals(isLineOrigin(UNIVERSIDAD), false);
  await withFakeFetch({}, () => Response.json({}), async (requests) => {
    const departures = await interurbanDepartures(["06002"], "627", NOW);
    assertEquals(departures.length, 3);
    assertEquals(departures.every((departure) => departure.isScheduled && departure.at > NOW), true);
    assertEquals(requests.length, 0);
  });
});

Deno.test("el horario del día sale ordenado y con los nocturnos de madrugada al final", () => {
  const thursday = dayTimetable(["06002", "2419"], "2026-11-05");
  assertEquals(thursday.filter((entry) => entry.line === "627").length, 92);
  // Los de madrugada de ese día; sin el viaje repetido de las 05:30.
  const night = thursday.filter((entry) => entry.line === "N907");
  assertEquals(night.map((entry) => entry.time), ["00:30", "02:30", "03:00", "05:30"]);
  // Los fines de semana hay menos: los viajes «lv» no salen.
  assertEquals(dayTimetable(["06002", "2419"], "2026-11-07").filter((entry) => entry.line === "627").length, 57);
  const week = weekTimetables(["06002", "2419"], NOW);
  assertEquals(week.map((day) => [day.label, day.date]), [
    ["Laborables", "2026-11-05"],
    ["Sábados", "2026-11-07"],
    ["Domingos", "2026-11-08"],
  ]);
});

Deno.test("el último de hoy: el 627 por defecto y, después, los nocturnos de esta noche", () => {
  const text = formatLastOfDay("Moncloa (06002 y 2419)", ["06002", "2419"], null, NOW);
  assertStringIncludes(text, "el último 627 de hoy sale a las 23:");
  assertStringIncludes(text, "Después, el N907 esta noche a las 00:30");
  assertStringIncludes(formatLastOfDay("Moncloa", ["06002", "2419"], "N907", NOW), "tienes el N907 esta noche");
});

Deno.test("sin línea pedida, del tiempo real solo enseña el 627 y el N907", async () => {
  const realtime = {
    stopTimes: {
      times: { Time: [time("629", "2026-11-05T10:20:00+01:00"), time("627", "2026-11-05T10:36:01+01:00")] },
    },
  };
  await withFakeFetch({}, () => Response.json(realtime), async () => {
    const departures = await interurbanDepartures(["10586"], null, NOW);
    assertEquals(departures.map((departure) => departure.line), ["627"]);
  });
});

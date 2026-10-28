import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  describeWeather,
  describeWeatherCode,
  fetchForecast,
  fetchTodayWeather,
  findPlace,
  mainPlace,
  parseWeatherRequest,
  replyToWeather,
  STRATESYS,
  VILLANUEVA_DE_LA_CANADA,
} from "./weather.ts";
import { withFakeFetch } from "./testing.ts";

function openMeteo(geocoding: unknown, forecast: unknown) {
  return (request: Request) =>
    Response.json(new URL(request.url).hostname.startsWith("geocoding") ? geocoding : forecast);
}

const MADRID = { results: [{ name: "Madrid", latitude: 40.4, longitude: -3.7 }] };

Deno.test("traduce los códigos del tiempo a palabras", () => {
  assertEquals(describeWeatherCode(0), "despejado");
  assertEquals(describeWeatherCode(63), "lluvia");
  assertEquals(describeWeatherCode(96), "tormenta");
  assertEquals(describeWeatherCode(200), "tormenta");
  assertEquals(describeWeatherCode(4), "tiempo variable");
});

Deno.test("describe el día con temperaturas redondeadas y la lluvia si se sabe", () => {
  const weather = { city: "Madrid", min: 9.6, max: 21.2, rainProbability: 10, code: 1 };
  assertEquals(describeWeather(weather), "🌤️ Madrid: algunas nubes, entre 10 y 21 °C, 10 % de probabilidad de lluvia.");
  assertEquals(describeWeather({ ...weather, rainProbability: null }), "🌤️ Madrid: algunas nubes, entre 10 y 21 °C.");
});

Deno.test("por defecto el tiempo es el de la oficina de Stratesys, sin buscar ninguna ciudad", async () => {
  await withFakeFetch({}, () => new Response("no debería llamarse", { status: 500 }), async (requests) => {
    assertEquals(await mainPlace(), STRATESYS);
    assertEquals(requests.length, 0);
  });
  await withFakeFetch({ WEATHER_CITY: "Madrid" }, openMeteo(MADRID, {}), async () => {
    assertEquals((await mainPlace([])).name, "Madrid");
  });
});

Deno.test("pide la previsión de hoy del sitio en hora de Madrid", async () => {
  const forecast = {
    daily: {
      time: ["2026-10-26"],
      weather_code: [61],
      temperature_2m_max: [18],
      temperature_2m_min: [11],
      precipitation_probability_max: [80],
    },
  };
  await withFakeFetch({}, openMeteo(MADRID, forecast), async (requests) => {
    assertEquals(await fetchTodayWeather(STRATESYS), {
      city: "Stratesys",
      min: 11,
      max: 18,
      code: 61,
      rainProbability: 80,
    });
    const forecastUrl = new URL(requests[0].url);
    assertEquals(forecastUrl.searchParams.get("latitude"), "40.44689");
    assertEquals(forecastUrl.searchParams.get("timezone"), "Europe/Madrid");
  });
});

Deno.test("si la ciudad no existe o falta la previsión, falla con un mensaje claro", async () => {
  await withFakeFetch({}, openMeteo({}, {}), async () => {
    await assertRejects(() => findPlace("Villaninguna"), Error, 'no conoce la ciudad "Villaninguna"');
  });
  await withFakeFetch({}, openMeteo(MADRID, { daily: {} }), async () => {
    await assertRejects(() => fetchTodayWeather(STRATESYS), Error, "no ha devuelto la previsión");
  });
  await withFakeFetch({}, () => new Response("caído", { status: 503 }), async (requests) => {
    await assertRejects(() => fetchTodayWeather(STRATESYS, [0, 0]), Error, "Open-Meteo respondió 503");
    assertEquals(requests.length, 3);
  });
});

Deno.test("un 503 pasajero se reintenta y el tiempo llega igual", async () => {
  let calls = 0;
  const forecast = {
    daily: {
      time: ["2026-10-26"],
      weather_code: [0],
      temperature_2m_max: [20],
      temperature_2m_min: [10],
      precipitation_probability_max: [0],
    },
  };
  const flaky = (request: Request) =>
    calls++ === 0 ? new Response("saturado", { status: 503 }) : openMeteo(MADRID, forecast)(request);
  await withFakeFetch({}, flaky, async () => {
    assertEquals((await fetchTodayWeather(STRATESYS, [0])).max, 20);
  });
});

Deno.test("la previsión de la semana trae un día por fecha, con las coordenadas del sitio", async () => {
  const forecast = {
    daily: {
      time: ["2026-10-26", "2026-10-27"],
      weather_code: [61, 0],
      temperature_2m_max: [18, 22],
      temperature_2m_min: [11, 9],
      precipitation_probability_max: [80, null],
    },
  };
  await withFakeFetch({}, () => Response.json(forecast), async (requests) => {
    assertEquals(await fetchForecast(VILLANUEVA_DE_LA_CANADA, 7, []), [
      { date: "2026-10-26", min: 11, max: 18, code: 61, rainProbability: 80 },
      { date: "2026-10-27", min: 9, max: 22, code: 0, rainProbability: null },
    ]);
    const url = new URL(requests[0].url);
    assertEquals(url.searchParams.get("latitude"), "40.44689");
    assertEquals(url.searchParams.get("forecast_days"), "7");
  });
});

Deno.test("la pregunta del tiempo vale para hoy y los 6 días siguientes; sin día, hoy", () => {
  const today = "2026-10-28";
  assertEquals(parseWeatherRequest({ date: "2026-10-29", city: " Sevilla " }, today), {
    kind: "weather",
    date: "2026-10-29",
    city: "Sevilla",
  });
  assertEquals(parseWeatherRequest({ date: null, city: null }, today), { kind: "weather", date: today, city: null });
  assertEquals(parseWeatherRequest({ date: "2026-11-04" }, today).kind, "invalid");
  assertEquals(parseWeatherRequest({ date: "2026-10-27" }, today).kind, "invalid");
});

const TWO_DAYS = {
  daily: {
    time: ["2026-10-28", "2026-10-29"],
    temperature_2m_min: [10, 8.4],
    temperature_2m_max: [22, 15.6],
    weather_code: [0, 61],
    precipitation_probability_max: [0, 80],
  },
};

Deno.test("responde el tiempo de mañana en el sitio principal", async () => {
  await withFakeFetch({}, openMeteo({}, TWO_DAYS), async () => {
    assertEquals(
      await replyToWeather({ kind: "weather", date: "2026-10-29", city: null }, "2026-10-28", []),
      "🌤️ Stratesys, mañana: lluvia, entre 8 y 16 °C, 80 % de probabilidad de lluvia.",
    );
  });
});

Deno.test("responde el tiempo de otra ciudad y avisa si no la encuentra", async () => {
  await withFakeFetch({}, openMeteo(MADRID, TWO_DAYS), async () => {
    assertEquals(
      await replyToWeather({ kind: "weather", date: "2026-10-28", city: "Madrid" }, "2026-10-28", []),
      "🌤️ Madrid, hoy: despejado, entre 10 y 22 °C, 0 % de probabilidad de lluvia.",
    );
  });
  await withFakeFetch({}, openMeteo({}, TWO_DAYS), async () => {
    assertEquals(
      await replyToWeather({ kind: "weather", date: "2026-10-28", city: "Villaninguna" }, "2026-10-28", []),
      "No encuentro «Villaninguna». Prueba con el nombre de la ciudad.",
    );
  });
});

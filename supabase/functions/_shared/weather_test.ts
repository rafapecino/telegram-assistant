import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  describeWeather,
  describeWeatherCode,
  fetchForecast,
  fetchTodayWeather,
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

Deno.test("busca la ciudad y pide la previsión de hoy en hora de Madrid", async () => {
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
    assertEquals(await fetchTodayWeather("Madrid"), {
      city: "Madrid",
      min: 11,
      max: 18,
      code: 61,
      rainProbability: 80,
    });
    const forecastUrl = new URL(requests[1].url);
    assertEquals(forecastUrl.searchParams.get("latitude"), "40.4");
    assertEquals(forecastUrl.searchParams.get("timezone"), "Europe/Madrid");
  });
});

Deno.test("si la ciudad no existe o falta la previsión, falla con un mensaje claro", async () => {
  await withFakeFetch({}, openMeteo({}, {}), async () => {
    await assertRejects(() => fetchTodayWeather("Villaninguna"), Error, 'no conoce la ciudad "Villaninguna"');
  });
  await withFakeFetch({}, openMeteo(MADRID, { daily: {} }), async () => {
    await assertRejects(() => fetchTodayWeather("Madrid"), Error, "no ha devuelto la previsión");
  });
  await withFakeFetch({}, () => new Response("caído", { status: 503 }), async (requests) => {
    await assertRejects(() => fetchTodayWeather("Madrid", [0, 0]), Error, "Open-Meteo respondió 503");
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
    assertEquals((await fetchTodayWeather("Madrid", [0])).max, 20);
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

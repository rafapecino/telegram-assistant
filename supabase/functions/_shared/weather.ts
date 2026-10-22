// Tiempo del día con Open-Meteo: gratis, sin clave y sin registrar nada.

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const DEFAULT_CITY = "Madrid";

export interface DayWeather {
  city: string;
  min: number;
  max: number;
  rainProbability: number | null;
  code: number;
}

/** Códigos WMO que usa Open-Meteo, agrupados en descripciones cortas. */
export function describeWeatherCode(code: number): string {
  if (code === 0) return "despejado";
  if (code <= 2) return "algunas nubes";
  if (code === 3) return "nublado";
  if (code === 45 || code === 48) return "niebla";
  if (code >= 51 && code <= 57) return "llovizna";
  if (code >= 61 && code <= 67) return "lluvia";
  if (code >= 71 && code <= 77) return "nieve";
  if (code >= 80 && code <= 82) return "chubascos";
  if (code === 85 || code === 86) return "chubascos de nieve";
  if (code >= 95) return "tormenta";
  return "tiempo variable";
}

export function describeWeather(weather: DayWeather): string {
  const rain = weather.rainProbability === null ? "" : `, ${weather.rainProbability} % de probabilidad de lluvia`;
  return `🌤️ ${weather.city}: ${describeWeatherCode(weather.code)}, entre ${Math.round(weather.min)} y ${
    Math.round(weather.max)
  } °C${rain}.`;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
  return response.json();
}

export async function fetchTodayWeather(city: string): Promise<DayWeather> {
  const geocoding = await getJson(
    `${GEOCODING_URL}?${new URLSearchParams({ name: city, count: "1", language: "es" })}`,
  );
  const place = (geocoding.results as { name: string; latitude: number; longitude: number }[] | undefined)?.[0];
  if (!place) throw new Error(`Open-Meteo no conoce la ciudad "${city}"`);
  const forecast = await getJson(
    `${FORECAST_URL}?${new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Europe/Madrid",
      forecast_days: "1",
    })}`,
  );
  const daily = forecast.daily as Record<string, (number | null)[]> | undefined;
  const max = daily?.temperature_2m_max?.[0];
  const min = daily?.temperature_2m_min?.[0];
  const code = daily?.weather_code?.[0];
  if (typeof max !== "number" || typeof min !== "number" || typeof code !== "number") {
    throw new Error("Open-Meteo no ha devuelto la previsión de hoy");
  }
  const rain = daily?.precipitation_probability_max?.[0];
  return { city: place.name, min, max, code, rainProbability: typeof rain === "number" ? rain : null };
}

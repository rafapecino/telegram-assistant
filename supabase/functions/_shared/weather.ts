// Previsión del tiempo con Open-Meteo: gratis, sin clave y sin registrar nada.

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const DEFAULT_CITY = "Madrid";
// A las horas en punto Open-Meteo se satura y a veces responde 503 (pasó a las 8:00 del resumen): se reintenta.
export const RETRY_DELAYS_MS = [2_000, 5_000];

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

/** Los errores 5xx son pasajeros: se reintenta tras cada espera de `retryDelaysMs` antes de rendirse. */
async function getJson(url: string, retryDelaysMs: number[]): Promise<Record<string, unknown>> {
  for (const delay of [...retryDelaysMs, null]) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    await response.body?.cancel();
    if (response.status < 500 || delay === null) throw new Error(`Open-Meteo respondió ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Open-Meteo no respondió");
}

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * El panel también enseña Villanueva de la Cañada. La avenida de la Paz no está en OpenStreetMap, así que se usa el
 * municipio: la previsión trabaja con cuadrículas de 1-2 km y el pueblo cabe en una o dos.
 */
export const VILLANUEVA_DE_LA_CANADA: Place = {
  name: "Villanueva de la Cañada",
  latitude: 40.44689,
  longitude: -4.00428,
};
export const FORECAST_DAYS = 7;

export interface DayForecast {
  date: string;
  min: number;
  max: number;
  code: number;
  rainProbability: number | null;
}

export async function findPlace(city: string, retryDelaysMs = RETRY_DELAYS_MS): Promise<Place> {
  const geocoding = await getJson(
    `${GEOCODING_URL}?${new URLSearchParams({ name: city, count: "1", language: "es" })}`,
    retryDelaysMs,
  );
  const place = (geocoding.results as Place[] | undefined)?.[0];
  if (!place) throw new Error(`Open-Meteo no conoce la ciudad "${city}"`);
  return { name: place.name, latitude: place.latitude, longitude: place.longitude };
}

/** Previsión de los próximos `days` días, empezando hoy, en hora de Madrid. */
export async function fetchForecast(
  place: Place,
  days: number,
  retryDelaysMs = RETRY_DELAYS_MS,
): Promise<DayForecast[]> {
  const forecast = await getJson(
    `${FORECAST_URL}?${new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Europe/Madrid",
      forecast_days: String(days),
    })}`,
    retryDelaysMs,
  );
  const daily = forecast.daily as Record<string, (number | string | null)[]> | undefined;
  const result = (daily?.time ?? []).map((date, index) => ({
    date: String(date),
    min: daily?.temperature_2m_min?.[index],
    max: daily?.temperature_2m_max?.[index],
    code: daily?.weather_code?.[index],
    rain: daily?.precipitation_probability_max?.[index],
  }));
  if (result.length === 0 || result.some((day) => [day.min, day.max, day.code].some((v) => typeof v !== "number"))) {
    throw new Error("Open-Meteo no ha devuelto la previsión de hoy");
  }
  return result.map(({ date, min, max, code, rain }) => ({
    date,
    min: min as number,
    max: max as number,
    code: code as number,
    rainProbability: typeof rain === "number" ? rain : null,
  }));
}

export async function fetchTodayWeather(city: string, retryDelaysMs = RETRY_DELAYS_MS): Promise<DayWeather> {
  const place = await findPlace(city, retryDelaysMs);
  const [today] = await fetchForecast(place, 1, retryDelaysMs);
  return { city: place.name, min: today.min, max: today.max, code: today.code, rainProbability: today.rainProbability };
}

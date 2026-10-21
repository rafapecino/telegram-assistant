// Cliente de la API de FastAPI. Los tipos reflejan los modelos de api/models.py.

export interface Expense {
  booking_date: string;
  amount: number;
  description: string;
  category: string;
}

export interface ExpenseSummary {
  days: number;
  total: number;
  count: number;
  /** Ordenado de mayor a menor importe. */
  by_category: Record<string, number>;
  largest: Expense[];
}

export interface Reminder {
  id: number;
  text: string;
  remind_at: string;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    // Errores de validación de FastAPI: lista de {loc, msg, ...}.
    if (Array.isArray(body.detail)) return body.detail.map((item: { msg: string }) => item.msg).join(". ");
  } catch {
    // La respuesta no era JSON: se usa el mensaje genérico.
  }
  // El proxy de Vite responde 500/502/504 sin JSON cuando la API está parada.
  if ([500, 502, 504].includes(response.status)) return API_DOWN_MESSAGE;
  return `La API respondió ${response.status}`;
}

const API_DOWN_MESSAGE = "No se pudo conectar con la API. Arráncala con: uvicorn api.main:app --port 8000";

// --- Token del panel (PANEL_TOKEN) ---
// Se guarda en sessionStorage: se borra al cerrar la pestaña y no viaja solo en cada petición como una cookie.

const TOKEN_KEY = "panel-token";
/** Evento que avisa a App de que el token falta o es incorrecto, para volver a pedirlo. */
export const AUTH_REQUIRED_EVENT = "panel-auth-required";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Sin almacenamiento (modo privado estricto): habrá que volver a escribirlo al recargar.
  }
  memoryToken = token;
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nada que borrar.
  }
  memoryToken = null;
}

let memoryToken: string | null = getToken();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (memoryToken) headers.set("Authorization", `Bearer ${memoryToken}`);
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new Error(API_DOWN_MESSAGE);
  }
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    throw new Error("El token del panel no es correcto.");
  }
  if (!response.ok) throw new Error(await errorDetail(response));
  return response.json() as Promise<T>;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getExpenseSummary(days: number): Promise<ExpenseSummary> {
  return request(`/expenses/summary?days=${days}`);
}

export function getPendingReminders(): Promise<Reminder[]> {
  return request("/reminders/pending");
}

export function createReminder(text: string, remindAt: string): Promise<Reminder> {
  return request("/reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, remind_at: remindAt }),
  });
}

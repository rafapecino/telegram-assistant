// Cliente de la API de FastAPI. Los tipos reflejan los modelos de api/models.py.

export interface Expense {
  id: number;
  booking_date: string;
  amount: number;
  description: string;
  category: string;
}

export interface DailyTotal {
  /** Fecha sin hora, "2026-10-20". */
  date: string;
  amount: number;
}

export interface ExpenseSummary {
  days: number;
  total: number;
  /** Total de los `days` días inmediatamente anteriores. */
  previous_total: number;
  count: number;
  /** Ordenado de mayor a menor importe. */
  by_category: Record<string, number>;
  /** Un elemento por día del periodo, en orden y con 0 los días sin gastos. */
  by_day: DailyTotal[];
  largest: Expense[];
  /** Categorías a las que se puede mover un gasto. */
  categories: string[];
}

export interface ExpenseQueryResult {
  date_from: string;
  date_to: string;
  category: string | null;
  search: string | null;
  total: number;
  count: number;
  /** Ordenado de mayor a menor importe. */
  by_category: Record<string, number>;
  /** Los primeros gastos en el orden pedido (fecha o importe). */
  expenses: Expense[];
  /** Gastos que cuentan en el total pero no vienen en `expenses`. */
  unlisted_count: number;
}

export interface ExpenseAnswer {
  text: string;
  /** null si la pregunta no era sobre gastos o no se entendió: entonces `text` lo explica. */
  result: ExpenseQueryResult | null;
}

export interface BalanceMonth {
  /** "2026-10" */
  month: string;
  /** null en los meses anteriores al primer ingreso registrado: no hay datos para calcular el ahorro. */
  incomes: number | null;
  expenses: number;
  savings: number | null;
}

export interface BalanceSummary {
  /** Del más antiguo al más reciente; el último es el mes en curso. */
  months: BalanceMonth[];
  /** Fecha sin hora del primer ingreso guardado, o null si aún no hay ninguno. */
  incomes_since: string | null;
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
  // 204: la acción ha ido bien y no hay cuerpo que leer.
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getExpenseSummary(days: number): Promise<ExpenseSummary> {
  return request(`/expenses/summary?days=${days}`);
}

export function updateExpenseCategory(expenseId: number, category: string): Promise<void> {
  return request(`/expenses/${expenseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });
}

export function askAboutExpenses(question: string, previousQuestions: string[]): Promise<ExpenseAnswer> {
  return request("/expenses/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, previous_questions: previousQuestions }),
  });
}

export function getBalance(months: number): Promise<BalanceSummary> {
  return request(`/balance?months=${months}`);
}

export function completeReminder(reminderId: number): Promise<void> {
  return request(`/reminders/${reminderId}/complete`, { method: "POST" });
}

export function deleteReminder(reminderId: number): Promise<void> {
  return request(`/reminders/${reminderId}`, { method: "DELETE" });
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

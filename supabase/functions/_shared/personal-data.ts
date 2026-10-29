// Exportar y borrar los datos personales desde Ajustes. Las conexiones con Google y el banco no entran: se quitan
// desconectándolas, para que también se retire el permiso en Google o en el banco.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { UserFacingError } from "./errors.ts";

interface DataCategory {
  label: string;
  // Las tablas hijas que se borran solas (historial de hábitos, avisos de presupuesto) no hace falta listarlas
  // para borrar, pero sí para exportar.
  tables: { name: string; key: string; isDeletedWithParent?: boolean }[];
}

export const DATA_CATEGORIES: Record<string, DataCategory> = {
  tasks: {label:"Tareas sin hora", tables:[{name:"tasks",key:"id"}]},
  debts: {label:"Deudas y conciliaciones", tables:[{name:"debts",key:"id"}]},
  goals: {label:"Objetivos de consumo", tables:[{name:"consumption_goals",key:"item"}]},
  reviews: {label:"Historial de repasos y bajadas de precio", tables:[{name:"review_deliveries",key:"key"},{name:"price_drops",key:"id"}]},
  finances: {
    label: "Gastos, ingresos y presupuestos",
    tables: [
      { name: "expenses", key: "id" },
      { name: "incomes", key: "id" },
      { name: "budgets", key: "id" },
      { name: "budget_alerts", key: "budget_id", isDeletedWithParent: true },
    ],
  },
  reminders: { label: "Recordatorios", tables: [{ name: "reminders", key: "id" }] },
  shopping: { label: "Lista de la compra", tables: [{ name: "shopping_items", key: "id" }] },
  notes: { label: "Notas", tables: [{ name: "notes", key: "id" }] },
  birthdays: { label: "Cumpleaños", tables: [{ name: "birthdays", key: "id" }] },
  habits: {
    label: "Hábitos y su historial",
    tables: [{ name: "habits", key: "id" }, { name: "habit_checks", key: "habit_id", isDeletedWithParent: true }],
  },
  weight: { label: "Peso", tables: [{ name: "weight_entries", key: "id" }] },
  memory: {
    label: "Memoria del asistente",
    tables: [{ name: "memory", key: "id" }, { name: "memory_suggestions", key: "id" }],
  },
  chat: { label: "Conversación del chat del panel", tables: [{ name: "chat_messages", key: "id" }] },
  bus_stops: { label: "Paradas de autobús guardadas", tables: [{ name: "bus_stops", key: "id" }] },
  email_filters: { label: "Filtros del correo", tables: [{ name: "email_filters", key: "sender" }] },
};

// Supabase devuelve como mucho 1000 filas por consulta.
const PAGE_SIZE = 1000;

/** Cuántos registros hay en cada categoría, para que se vea qué se va a borrar. */
export async function summarizePersonalData(
  db: SupabaseClient,
): Promise<{ id: string; label: string; count: number }[]> {
  return await Promise.all(Object.entries(DATA_CATEGORIES).map(async ([id, category]) => {
    let count = 0;
    for (const table of category.tables.filter((table) => !table.isDeletedWithParent)) {
      const { count: rows, error } = await db.from(table.name).select("*", { count: "exact", head: true });
      if (error) throw new Error(`No se pudieron contar los datos de ${table.name}: ${error.message}`);
      count += rows ?? 0;
    }
    return { id, label: category.label, count };
  }));
}

async function loadWholeTable(db: SupabaseClient, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`No se pudo exportar ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

/** Todos los datos personales, tabla a tabla, tal como están guardados. */
export async function exportPersonalData(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const tables: Record<string, unknown[]> = {};
  for (const category of Object.values(DATA_CATEGORIES)) {
    for (const table of category.tables) tables[table.name] = await loadWholeTable(db, table.name);
  }
  return { exported_at: now.toISOString(), tables };
}

export function parseCategories(raw: string | null): string[] {
  const ids = [...new Set((raw ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.some((id) => !Object.hasOwn(DATA_CATEGORIES, id))) {
    throw new UserFacingError("Elige qué datos quieres borrar.");
  }
  return ids;
}

/** Borra todas las filas de las categorías elegidas. Devuelve los nombres de lo borrado, para confirmarlo. */
export async function deletePersonalData(db: SupabaseClient, categoryIds: string[]): Promise<string[]> {
  for (const id of categoryIds) {
    for (const table of DATA_CATEGORIES[id].tables.filter((table) => !table.isDeletedWithParent)) {
      // Supabase no deja borrar sin filtro: la clave nunca es nula, así que este abarca todas las filas.
      const { error } = await db.from(table.name).delete().not(table.key, "is", null);
      if (error) throw new Error(`No se pudo borrar ${table.name}: ${error.message}`);
    }
  }
  console.info(`Datos personales borrados desde el panel: ${categoryIds.join(", ")}`);
  return categoryIds.map((id) => DATA_CATEGORIES[id].label);
}

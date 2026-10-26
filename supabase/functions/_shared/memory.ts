// Memoria: lo que el asistente sabe de Rafa (trabajo, tesis, manías…). Es un solo documento que se edita en el panel.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { askGroqForJson } from "./groq.ts";

export const MAX_MEMORY_LENGTH = 4000;
// Alta para que cada frase salga distinta aunque la memoria sea la misma.
const FUNNY_LINE_TEMPERATURE = 1;

/** Motes cariñosos para vacilar a Rafa. Nunca «Rafita»: no le gusta. */
export const NICKNAMES = [
  "Petzi",
  "máquina",
  "fiera",
  "crack",
  "figura",
  "campeón",
  "artista",
  "jefe",
  "maestro",
  "tronco",
  "chaval",
  "colega",
  "pájaro",
  "elemento",
  "fenómeno",
  "bribón",
  "golfo",
  "sinvergüenza",
  "canalla",
  "truhán",
  "mamón",
  "cabrón",
  "pringao",
  "melón",
  "cenutrio",
  "zoquete",
  "mendrugo",
  "gañán",
  "listillo",
  "zángano",
  "piltrafilla",
  "tolai",
  "ceporro",
  "cansino",
  "petardo",
  "mastodonte",
  "señor ingeniero",
  "doctorando",
  "becario de lujo",
  "tigre",
  "bestia",
];
const NICKNAMES_PER_MESSAGE = 4;

/** Unos cuantos motes al azar: así el modelo no repite siempre los mismos aunque responda sin aleatoriedad. */
export function pickNicknames(count = NICKNAMES_PER_MESSAGE, random = Math.random): string[] {
  const shuffled = [...NICKNAMES].sort(() => random() - 0.5);
  return shuffled.slice(0, count);
}

/** Cómo llamarle, para los prompts. */
export function nicknameGuide(): string {
  return `Le llamas Rafa o Petzi (nunca Rafita) y, de vez en cuando y en plan cariñoso, con motes como: ${
    pickNicknames().join(", ")
  }. Varía; no uses siempre el mismo.`;
}

export async function loadMemory(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.from("memory").select("content").eq("id", 1).maybeSingle();
  if (error) throw new Error(`No se pudo leer la memoria: ${error.message}`);
  return data?.content ?? "";
}

export async function saveMemory(db: SupabaseClient, content: unknown): Promise<void> {
  if (typeof content !== "string" || content.length > MAX_MEMORY_LENGTH) {
    throw new Error(`La memoria puede tener como mucho ${MAX_MEMORY_LENGTH} caracteres.`);
  }
  const { error } = await db.from("memory").upsert({
    id: 1,
    content: content.trim(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`No se pudo guardar la memoria: ${error.message}`);
}

/** Para el prompt del chat: lo que sabe de Rafa, o nada si la memoria está vacía. */
export function memoryContext(memory: string): string {
  return memory
    ? `Lo que sabes de Rafa (úsalo para vacilarle cuando venga a cuento, sin repetirlo todo):\n${memory}`
    : "";
}

export function parseFunnyLine(raw: unknown): string {
  const line = (raw as { line?: unknown } | null)?.line;
  if (typeof line !== "string" || !line.trim()) throw new Error("Groq no devolvió ninguna frase.");
  return line.trim();
}

/** Una frase corta con guasa sobre Rafa, inventada por Groq a partir de la memoria. */
export async function inventFunnyLine(db: SupabaseClient): Promise<string> {
  const memory = await loadMemory(db);
  const raw = await askGroqForJson(
    [
      "Eres el asistente personal de Rafa, un colega pícaro y vacilón.",
      nicknameGuide(),
      "Escribe UNA frase corta (máximo 25 palabras) en español de España para saludarle con gracia, metiéndote con " +
      "algo concreto de lo que sabes de él. Sorpréndele: cada vez un tema distinto. Nada ofensivo de verdad.",
      'Responde solo con JSON {"line": "<la frase>"}.',
    ].join("\n"),
    memory ? `Lo que sabes de Rafa:\n${memory}` : "Aún no sabes nada de Rafa: vacílale por no contarte nada.",
    FUNNY_LINE_TEMPERATURE,
  );
  return parseFunnyLine(raw);
}

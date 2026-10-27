// Memoria: lo que el asistente sabe de Rafa (trabajo, tesis, manías…). Es un solo documento que se edita en el panel.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { UserFacingError } from "./errors.ts";
import { askGroqForJson } from "./groq.ts";
import type { ButtonResult } from "./personal-replies.ts";
import type { BotReply } from "./telegram.ts";
import { comparable } from "./text.ts";

export const MAX_MEMORY_LENGTH = 4000;
const MAX_SUGGESTION_LENGTH = 300;
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
    throw new UserFacingError(`La memoria puede tener como mucho ${MAX_MEMORY_LENGTH} caracteres.`);
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

/** El dato nuevo que el modelo propone apuntar, o null si no hay ninguno o ya está en la memoria. */
export function parseMemorySuggestion(raw: unknown, memory: string): string | null {
  const remember = (raw as { remember?: unknown } | null)?.remember;
  if (typeof remember !== "string") return null;
  const text = remember.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  if (!text || text.length > MAX_SUGGESTION_LENGTH) return null;
  // El modelo a veces propone lo que ya sabe: si está tal cual en la memoria, no se pregunta.
  return comparable(memory).includes(comparable(text)) ? null : text;
}

/** Guarda la propuesta y añade a la respuesta la pregunta con sus botones. */
export async function suggestMemory(db: SupabaseClient, answer: string, text: string): Promise<BotReply> {
  const { data, error } = await db.from("memory_suggestions").insert({ text, answer }).select("id").single();
  if (error) throw new Error(`No se pudo guardar la propuesta para la memoria: ${error.message}`);
  return {
    text: `${answer}\n\n🧠 ¿Lo apunto en tu memoria? «${text}»`,
    buttons: [[
      { text: "🧠 Guárdalo", callback_data: `memory:yes:${data.id}` },
      { text: "No", callback_data: `memory:no:${data.id}` },
    ]],
  };
}

export function parseMemoryButton(data: string): { suggestionId: number; accept: boolean } | null {
  const match = data.match(/^memory:(yes|no):(\d+)$/);
  return match ? { suggestionId: Number(match[2]), accept: match[1] === "yes" } : null;
}

/** El dato va como una línea más al final. Devuelve null si ya no cabe. */
export function appendToMemory(memory: string, text: string): string | null {
  const updated = memory.trim() ? `${memory.trim()}\n- ${text}` : `- ${text}`;
  return updated.length <= MAX_MEMORY_LENGTH ? updated : null;
}

interface MemorySuggestion {
  text: string;
  answer: string;
}

async function acceptSuggestion(db: SupabaseClient, suggestion: MemorySuggestion): Promise<ButtonResult> {
  const updated = appendToMemory(await loadMemory(db), suggestion.text);
  if (!updated) {
    return {
      message: {
        text: `${suggestion.answer}\n\n🧠 No cabe en la memoria (máximo ${MAX_MEMORY_LENGTH} caracteres). ` +
          `Haz hueco en el panel y añádelo a mano: «${suggestion.text}»`,
      },
      toast: "Memoria llena",
    };
  }
  await saveMemory(db, updated);
  return {
    message: { text: `${suggestion.answer}\n\n🧠 Apuntado en tu memoria: «${suggestion.text}»` },
    toast: "Guardado",
  };
}

/** «Guárdalo» o «No»: en los dos casos la propuesta se borra y el mensaje se queda con la respuesta. */
export async function applyMemoryButton(
  db: SupabaseClient,
  button: { suggestionId: number; accept: boolean },
): Promise<ButtonResult> {
  const { data: suggestion, error } = await db.from("memory_suggestions").select("text,answer")
    .eq("id", button.suggestionId).maybeSingle();
  if (error) throw new Error(`No se pudo leer la propuesta para la memoria: ${error.message}`);
  if (!suggestion) return { message: { text: "Esta propuesta ya está respondida." }, toast: "Ya respondida" };
  const result = button.accept
    ? await acceptSuggestion(db, suggestion)
    : { message: { text: suggestion.answer }, toast: "Vale, no lo apunto" };
  const { error: deleteError } = await db.from("memory_suggestions").delete().eq("id", button.suggestionId);
  if (deleteError) throw new Error(`No se pudo borrar la propuesta para la memoria: ${deleteError.message}`);
  return result;
}

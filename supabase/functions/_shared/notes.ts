import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { askGroqForJson } from "./groq.ts";

const MAX_NOTE_LENGTH = 1000;
// Las notas van enteras al modelo para responder: con más de esto conviene buscar antes de preguntar.
const MAX_NOTES_SENT = 300;
const NOTES_LISTED = 20;
// 20 notas recortadas caben en un mensaje de Telegram (máximo 4096 caracteres); enteras pueden llegar a 1000 cada una.
const LISTED_NOTE_LENGTH = 150;

/** Formato que el modelo debe devolver cuando el mensaje habla de notas (ver message-intent.ts). */
export const NOTE_INTENT_FORMAT =
  'Notas, datos sin fecha que quiere guardar o consultar ("apunta que la talla de Marta es la 38", "¿qué talla usa ' +
  'Marta?"): {"intent": "note", "action": "save", "text": "<la nota o la pregunta>"}. action es "save" para guardar ' +
  'un dato, "ask" para preguntar por algo apuntado, "list" para ver las notas y "delete" para borrar la que describe ' +
  "text. Si pide que se le avise en una fecha u hora, es un recordatorio, no una nota.";

export type NoteRequest =
  | { kind: "note_save"; text: string }
  | { kind: "note_ask"; question: string }
  | { kind: "note_list" }
  | { kind: "note_delete"; description: string }
  | { kind: "invalid"; message: string };

export function parseNoteRequest(raw: unknown): NoteRequest {
  const candidate = raw as { action?: unknown; text?: unknown } | null;
  if (candidate?.action === "list") return { kind: "note_list" };
  const text = typeof candidate?.text === "string" ? candidate.text.trim().slice(0, MAX_NOTE_LENGTH) : "";
  if (!text) return { kind: "invalid", message: "No he entendido qué quieres apuntar o buscar." };
  if (candidate?.action === "save") return { kind: "note_save", text };
  if (candidate?.action === "ask") return { kind: "note_ask", question: text };
  if (candidate?.action === "delete") return { kind: "note_delete", description: text };
  return { kind: "invalid", message: "No he entendido qué hacer con las notas." };
}

export interface Note {
  id: number;
  text: string;
  created_at: string;
}

export async function saveNote(db: SupabaseClient, text: string): Promise<void> {
  const { error } = await db.from("notes").insert({ text });
  if (error) throw new Error(`No se pudo guardar la nota: ${error.message}`);
}

/** Las más recientes primero. */
export async function listNotes(db: SupabaseClient, limit = MAX_NOTES_SENT): Promise<Note[]> {
  const { data, error } = await db.from("notes").select("id, text, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`No se pudieron leer las notas: ${error.message}`);
  return data;
}

function notesForModel(notes: Note[]): string {
  return JSON.stringify(notes.map((note) => ({ id: note.id, fecha: note.created_at.slice(0, 10), nota: note.text })));
}

/** Valida la respuesta del modelo a una pregunta sobre las notas. */
export function parseNoteAnswer(raw: unknown): string {
  const answer = (raw as { answer?: unknown } | null)?.answer;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Groq no devolvió una respuesta sobre las notas.");
  return answer.trim();
}

export async function answerFromNotes(question: string, notes: Note[]): Promise<string> {
  if (notes.length === 0) return "Aún no tienes nada apuntado. Prueba con «apunta que…».";
  const raw = await askGroqForJson(
    [
      "Respondes en español preguntas sobre las notas personales de una persona.",
      "Usa solo la información de las notas. Si no está, di que no lo tiene apuntado.",
      'Si dos notas se contradicen, vale la más reciente. Responde solo con JSON {"answer": "<respuesta breve>"}.',
    ].join("\n"),
    `Notas: ${notesForModel(notes)}\n\nPregunta: ${question}`,
  );
  return parseNoteAnswer(raw);
}

/** Valida los ids que propone el modelo: solo cuentan los de notas que existen. */
export function parseNoteIds(raw: unknown, notes: Note[]): number[] {
  const ids = (raw as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids)) return [];
  const existing = new Set(notes.map((note) => note.id));
  return [...new Set(ids.map(Number))].filter((id) => existing.has(id));
}

/** Borra las notas que encajan con la descripción y devuelve su texto. */
export async function deleteMatchingNotes(db: SupabaseClient, description: string): Promise<string[]> {
  const notes = await listNotes(db);
  if (notes.length === 0) return [];
  const raw = await askGroqForJson(
    'Elige qué notas describe el mensaje. Responde solo con JSON {"ids": [...]}, vacío si ninguna encaja.',
    `Notas: ${notesForModel(notes)}\n\nMensaje: ${description}`,
  );
  const ids = parseNoteIds(raw, notes);
  if (ids.length === 0) return [];
  const { error } = await db.from("notes").delete().in("id", ids);
  if (error) throw new Error(`No se pudieron borrar las notas: ${error.message}`);
  return notes.filter((note) => ids.includes(note.id)).map((note) => note.text);
}

export function formatNoteList(notes: Note[]): string {
  if (notes.length === 0) return "No tienes notas. Guarda una con «apunta que…».";
  const shown = notes.slice(0, NOTES_LISTED).map((note) =>
    `• ${note.text.length > LISTED_NOTE_LENGTH ? `${note.text.slice(0, LISTED_NOTE_LENGTH)}…` : note.text}`
  );
  const more = notes.length > NOTES_LISTED ? [`… y ${notes.length - NOTES_LISTED} más.`] : [];
  return ["Tus notas, de la más reciente a la más antigua:", ...shown, ...more].join("\n");
}

export function describeDeletedNotes(deleted: string[]): string {
  if (deleted.length === 0) return "No he encontrado ninguna nota así.";
  return ["He borrado:", ...deleted.map((text) => `• ${text}`)].join("\n");
}

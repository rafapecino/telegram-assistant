import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  answerFromNotes,
  deleteMatchingNotes,
  formatNoteList,
  parseNoteAnswer,
  parseNoteIds,
  parseNoteRequest,
} from "./notes.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const NOTES = [
  { id: 5, text: "La talla de zapato de Marta es la 38", created_at: "2026-10-20T10:00:00Z" },
  { id: 3, text: "El wifi de casa de mis padres es Rosa1950", created_at: "2026-09-01T10:00:00Z" },
];

function groqAnswering(content: unknown) {
  return () => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

Deno.test("entiende guardar, preguntar, listar y borrar notas", () => {
  assertEquals(parseNoteRequest({ action: "save", text: " La talla de Marta es la 38 " }), {
    kind: "note_save",
    text: "La talla de Marta es la 38",
  });
  assertEquals(parseNoteRequest({ action: "ask", text: "¿talla de Marta?" }).kind, "note_ask");
  assertEquals(parseNoteRequest({ action: "list" }), { kind: "note_list" });
  assertEquals(parseNoteRequest({ action: "delete", text: "la del wifi" }).kind, "note_delete");
  assertEquals(parseNoteRequest({ action: "save", text: "  " }).kind, "invalid");
});

Deno.test("valida la respuesta de la IA y los ids de notas que propone borrar", () => {
  assertEquals(parseNoteAnswer({ answer: " La 38. " }), "La 38.");
  assertThrows(() => parseNoteAnswer({ respuesta: "La 38" }));
  // 99 no existe: nunca se borra una nota que no está en la lista.
  assertEquals(parseNoteIds({ ids: [3, "5", 99, 3] }, NOTES), [3, 5]);
  assertEquals(parseNoteIds({ ids: "3" }, NOTES), []);
});

Deno.test("sin notas no pregunta a la IA y explica cómo apuntar", async () => {
  assertEquals(await answerFromNotes("¿talla de Marta?", []), "Aún no tienes nada apuntado. Prueba con «apunta que…».");
});

Deno.test("responde con lo que diga la IA a partir de las notas", async () => {
  await withFakeFetch({ GROQ_API_KEY: "g" }, groqAnswering({ answer: "Marta usa la 38." }), async (requests) => {
    assertEquals(await answerFromNotes("¿qué talla usa Marta?", NOTES), "Marta usa la 38.");
    const body = await requests[0].json();
    assertEquals(body.messages[1].content.includes("Rosa1950"), true);
  });
});

Deno.test("borra solo las notas que la IA identifica y que existen", async () => {
  const { db, queries } = fakeDb((query) => query.some((step) => step.startsWith("select(")) ? { data: NOTES } : {});
  await withFakeFetch({ GROQ_API_KEY: "g" }, groqAnswering({ ids: [3, 42] }), async () => {
    assertEquals(await deleteMatchingNotes(db, "la nota del wifi"), ["El wifi de casa de mis padres es Rosa1950"]);
  });
  assertEquals(queries[1], ['from("notes")', "delete()", 'in("id", [3])']);
});

Deno.test("si la IA no devuelve una respuesta válida, falla con un mensaje claro", async () => {
  await withFakeFetch({ GROQ_API_KEY: "g" }, groqAnswering({ nada: true }), async () => {
    await assertRejects(() => answerFromNotes("¿talla?", NOTES), Error, "Groq no devolvió una respuesta");
  });
});

Deno.test("la lista de notas enseña las 20 más recientes y cuántas quedan", () => {
  const many = Array.from({ length: 23 }, (_, index) => ({ id: index, text: `nota ${index}`, created_at: "" }));
  const lines = formatNoteList(many).split("\n");
  assertEquals(lines.length, 22);
  assertEquals(lines.at(-1), "… y 3 más.");
  assertEquals(formatNoteList([]), "No tienes notas. Guarda una con «apunta que…».");
  const long = formatNoteList([{ id: 1, text: "a".repeat(1000), created_at: "" }]).split("\n")[1];
  assertEquals(long, `• ${"a".repeat(150)}…`);
});

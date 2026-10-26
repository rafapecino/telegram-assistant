import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  appendToMemory,
  applyMemoryButton,
  inventFunnyLine,
  memoryContext,
  NICKNAMES,
  parseMemoryButton,
  parseMemorySuggestion,
  pickNicknames,
  saveMemory,
} from "./memory.ts";
import { morningGreeting } from "./morning.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const groqLine = (line: string) => () =>
  Response.json({ choices: [{ message: { content: JSON.stringify({ line }) } }] });

Deno.test("la frase graciosa se inventa con lo que hay en la memoria", async () => {
  const { db } = fakeDb(() => ({ data: { content: "Es ingeniero y está con la tesis." } }));
  await withFakeFetch({ GROQ_API_KEY: "g" }, groqLine("¿Qué tal la tesis, Petzi?"), async (requests) => {
    assertEquals(await inventFunnyLine(db), "¿Qué tal la tesis, Petzi?");
    const body = JSON.parse(await requests[0].text());
    assertStringIncludes(body.messages[1].content, "está con la tesis");
    assertEquals(body.temperature, 1);
  });
});

Deno.test("los días de sorpresa el saludo de la mañana lo inventa Groq", async () => {
  const { db } = fakeDb(() => ({ data: { content: "Fuma." } }));
  await withFakeFetch({ GROQ_API_KEY: "g" }, groqLine("Arriba, Rafa, que el tabaco no se compra solo."), async () => {
    // El 22 de octubre de 2026 es día de sorpresa; el 23 no.
    assertEquals(
      await morningGreeting(db, "2026-10-22"),
      "☀️ Arriba, Rafa, que el tabaco no se compra solo. Hoy es jueves, 22 de octubre.",
    );
    assertStringIncludes(await morningGreeting(db, "2026-10-23"), "Hoy es viernes, 23 de octubre.");
  });
});

Deno.test("la memoria vacía no añade nada al chat y una demasiado larga no se guarda", async () => {
  assertEquals(memoryContext(""), "");
  const { db } = fakeDb(() => ({ error: null }));
  await assertRejects(() => saveMemory(db, "x".repeat(4001)), Error, "4000 caracteres");
});

Deno.test("los motes salen variados y nunca Rafita", () => {
  assertEquals(NICKNAMES.some((nickname) => /rafita/i.test(nickname)), false);
  const picked = pickNicknames(4);
  assertEquals(new Set(picked).size, 4);
  assertEquals(picked.every((nickname) => NICKNAMES.includes(nickname)), true);
});

Deno.test("solo se propone un dato nuevo, corto y que no esté ya en la memoria", () => {
  assertEquals(parseMemorySuggestion({ remember: " Le encanta  el sushi. " }, ""), "Le encanta el sushi");
  assertEquals(parseMemorySuggestion({ remember: "Le encanta el sushi" }, "- le encanta el SUSHI"), null);
  assertEquals(parseMemorySuggestion({ remember: null }, ""), null);
  assertEquals(parseMemorySuggestion({ remember: "   " }, ""), null);
  assertEquals(parseMemorySuggestion({ remember: "x".repeat(301) }, ""), null);
  assertEquals(parseMemorySuggestion({ answer: "hola" }, ""), null);
});

Deno.test("el dato se añade como una línea más, y si no cabe no se toca la memoria", () => {
  assertEquals(appendToMemory("", "Le encanta el sushi"), "- Le encanta el sushi");
  assertEquals(appendToMemory("Es ingeniero.\n", "Le encanta el sushi"), "Es ingeniero.\n- Le encanta el sushi");
  assertEquals(appendToMemory("x".repeat(3990), "Le encanta el sushi"), null);
});

Deno.test("los botones de la memoria se reconocen y los demás no", () => {
  assertEquals(parseMemoryButton("memory:yes:7"), { suggestionId: 7, accept: true });
  assertEquals(parseMemoryButton("memory:no:7"), { suggestionId: 7, accept: false });
  assertEquals(parseMemoryButton("shop:done:7"), null);
});

const SUGGESTION = { text: "Le encanta el sushi", answer: "¡Qué buen gusto, Petzi!" };

Deno.test("«Guárdalo» apunta el dato en la memoria y borra la propuesta", async () => {
  const { db, queries } = fakeDb((query) => {
    if (query[0] === 'from("memory_suggestions")' && query[1].startsWith("select(")) return { data: SUGGESTION };
    if (query[0] === 'from("memory")' && query[1].startsWith("select(")) return { data: { content: "Es ingeniero." } };
    return { error: null };
  });
  assertEquals(await applyMemoryButton(db, { suggestionId: 7, accept: true }), {
    message: { text: "¡Qué buen gusto, Petzi!\n\n🧠 Apuntado en tu memoria: «Le encanta el sushi»" },
    toast: "Guardado",
  });
  const saved = queries.find((query) => query[0] === 'from("memory")' && query[1].startsWith("upsert("));
  assertStringIncludes(saved![1], "Es ingeniero.\\n- Le encanta el sushi");
  assertEquals(queries.at(-1), ['from("memory_suggestions")', "delete()", 'eq("id", 7)']);
});

Deno.test("«No» deja la respuesta sin la pregunta y no toca la memoria", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: SUGGESTION } : { error: null });
  assertEquals(await applyMemoryButton(db, { suggestionId: 7, accept: false }), {
    message: { text: "¡Qué buen gusto, Petzi!" },
    toast: "Vale, no lo apunto",
  });
  assertEquals(queries.some((query) => query[0] === 'from("memory")'), false);
});

Deno.test("si la memoria está llena lo dice y da el dato para añadirlo a mano", async () => {
  const { db, queries } = fakeDb((query) => {
    if (query[0] === 'from("memory_suggestions")' && query[1].startsWith("select(")) return { data: SUGGESTION };
    if (query[0] === 'from("memory")') return { data: { content: "x".repeat(3995) } };
    return { error: null };
  });
  const result = await applyMemoryButton(db, { suggestionId: 7, accept: true });
  assertEquals(result.toast, "Memoria llena");
  assertStringIncludes(result.message.text, "añádelo a mano: «Le encanta el sushi»");
  assertEquals(queries.some((query) => query[1].startsWith("upsert(")), false);
});

Deno.test("un botón de una propuesta ya respondida no hace nada", async () => {
  const { db, queries } = fakeDb(() => ({ data: null }));
  assertEquals((await applyMemoryButton(db, { suggestionId: 7, accept: true })).toast, "Ya respondida");
  assertEquals(queries.length, 1);
});

import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { inventFunnyLine, memoryContext, saveMemory } from "./memory.ts";
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

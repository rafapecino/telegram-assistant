import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { replyToText } from "./assistant.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const NOW = new Date("2026-10-22T10:00:00Z");

/** Groq de prueba: cada llamada responde con el siguiente JSON de la lista. */
function groqAnswering(...contents: unknown[]) {
  let call = 0;
  return () => Response.json({ choices: [{ message: { content: JSON.stringify(contents[call++]) } }] });
}

Deno.test("lo que no es ninguna funcionalidad se contesta como pregunta general", async () => {
  const { db, queries } = fakeDb(() => ({}));
  await withFakeFetch(
    { GROQ_API_KEY: "g" },
    groqAnswering({ intent: "unknown" }, { answer: "Lo pintó Picasso en 1937." }),
    async (requests) => {
      assertEquals(await replyToText(db, "¿Quién pintó el Guernica?", NOW), "Lo pintó Picasso en 1937.");
      assertEquals(requests.length, 2);
    },
  );
  // Solo lee la memoria, para hablarle con lo que sabe de él.
  assertEquals(queries.map((query) => query[0]), ['from("memory")']);
});

Deno.test("lo que es una funcionalidad la ejecuta sobre los datos", async () => {
  const { db, queries } = fakeDb((query) => query[1].startsWith("select(") ? { data: [{ id: 1, text: "leche" }] } : {});
  await withFakeFetch(
    { GROQ_API_KEY: "g" },
    groqAnswering({ intent: "shopping", action: "add", items: ["pan"] }),
    async () => {
      const reply = await replyToText(db, "añade pan a la compra", NOW);
      assertEquals(typeof reply === "object" && reply.buttons?.length, 1);
    },
  );
  assertEquals(queries[1], ['from("shopping_items")', 'insert([{"text":"pan"}])']);
});

Deno.test("el historial llega al modelo para entender las continuaciones", async () => {
  const { db } = fakeDb(() => ({ data: [] }));
  const history = [
    { role: "user" as const, text: "¿Cuánto gasté ayer?" },
    { role: "assistant" as const, text: "No tienes gastos del 21 de octubre." },
  ];
  await withFakeFetch(
    { GROQ_API_KEY: "g" },
    groqAnswering({ intent: "expenses_query", date_from: "2026-09-01", date_to: "2026-09-30", category: null }),
    async (requests) => {
      await replyToText(db, "¿y el mes pasado?", NOW, history);
      const sent = (await requests[0].json()).messages[1].content as string;
      assertEquals(sent.includes("Persona: ¿Cuánto gasté ayer?"), true);
      assertEquals(sent.endsWith("Mensaje actual: ¿y el mes pasado?"), true);
    },
  );
});

Deno.test("sin historial el mensaje va tal cual, como en Telegram", async () => {
  const { db } = fakeDb(() => ({}));
  await withFakeFetch(
    { GROQ_API_KEY: "g" },
    groqAnswering({ intent: "unknown" }, { answer: "Hola." }),
    async (requests) => {
      await replyToText(db, "hola", NOW);
      assertEquals((await requests[0].json()).messages[1].content, "hola");
    },
  );
});

Deno.test("si el modelo no da una respuesta válida, falla con un mensaje claro", async () => {
  const { db } = fakeDb(() => ({}));
  await withFakeFetch({ GROQ_API_KEY: "g" }, groqAnswering({ intent: "unknown" }, { nada: true }), async () => {
    await assertRejects(() => replyToText(db, "hola", NOW), Error, "Groq no devolvió una respuesta");
  });
});

Deno.test("si cuenta algo nuevo de sí mismo, la respuesta pregunta si apuntarlo en la memoria", async () => {
  const { db, queries } = fakeDb((query) =>
    query[0] === 'from("memory_suggestions")' ? { data: { id: 3 } } : { data: { content: "Es ingeniero." } }
  );
  await withFakeFetch(
    { GROQ_API_KEY: "g" },
    groqAnswering({ intent: "unknown" }, { answer: "¡Buen plan, Petzi!", remember: "Corre una maratón en abril" }),
    async () => {
      assertEquals(await replyToText(db, "en abril corro la maratón de Madrid", NOW), {
        text: "¡Buen plan, Petzi!\n\n🧠 ¿Lo apunto en tu memoria? «Corre una maratón en abril»",
        buttons: [[
          { text: "🧠 Guárdalo", callback_data: "memory:yes:3" },
          { text: "No", callback_data: "memory:no:3" },
        ]],
      });
    },
  );
  assertEquals(queries[1].slice(0, 2), [
    'from("memory_suggestions")',
    'insert({"text":"Corre una maratón en abril","answer":"¡Buen plan, Petzi!"})',
  ]);
});

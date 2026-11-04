import { assertEquals } from "jsr:@std/assert@1.0.19";
import { factsOf, parseTonedReply, withPersonalTone } from "./personal-tone.ts";
import { withFakeFetch } from "./testing.ts";

const groq = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
const REPLY = 'Te recordaré "grabar las clases" el jueves, 5 de noviembre, 09:30 y después de lunes a viernes.';

Deno.test("los datos que no pueden cambiar: comillas, números, días y meses", () => {
  assertEquals(factsOf(REPLY), ["grabar las clases", "jueves", "5", "noviembre", "09:30", "lunes", "viernes"]);
});

Deno.test("acepta la reescritura si conserva los datos y la descarta si cambia alguno", () => {
  const good =
    "Hecho, crack: el jueves 5 de noviembre a las 09:30 te recuerdo «grabar las clases», de lunes a viernes.";
  assertEquals(parseTonedReply({ text: good }, REPLY), good);
  assertEquals(parseTonedReply({ text: good.replace("09:30", "10:30") }, REPLY), null);
  assertEquals(parseTonedReply({ text: good.replace("jueves", "viernes") }, REPLY), null);
  assertEquals(parseTonedReply({ answer: good }, REPLY), null);
});

Deno.test("reescribe las confirmaciones cortas; si Groq falla, manda la original", async () => {
  const toned = "Apuntado, fiera: «leche».";
  await withFakeFetch({ GROQ_API_KEY: "g" }, () => groq({ text: toned }), async () => {
    assertEquals(await withPersonalTone("Apuntado: «leche»."), toned);
  });
  await withFakeFetch({ GROQ_API_KEY: "g" }, () => new Response("", { status: 500 }), async () => {
    assertEquals(await withPersonalTone("Apuntado: «leche»."), "Apuntado: «leche».");
  });
});

Deno.test("los informes con varias líneas no se tocan ni llaman a Groq", async () => {
  await withFakeFetch({ GROQ_API_KEY: "g" }, () => groq({ text: "otra cosa" }), async (requests) => {
    assertEquals(await withPersonalTone("Gastos:\n• 10 €"), "Gastos:\n• 10 €");
    assertEquals(requests.length, 0);
  });
});

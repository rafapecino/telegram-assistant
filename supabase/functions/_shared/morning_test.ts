import { assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import {
  birthdayLines,
  buildMorningSummary,
  composeSummary,
  eventLines,
  greetingLine,
  reminderLines,
} from "./morning.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const TODAY = "2026-10-22";
// 8:00 en Madrid.
const NOW = new Date("2026-10-22T06:00:00Z");

Deno.test("los cumpleaños avisan el mismo día y el día antes", () => {
  const birthdays = [
    { id: 1, name: "Mamá", month: 10, day: 22, year: 1966 },
    { id: 2, name: "Luis", month: 10, day: 23, year: null },
    { id: 3, name: "Ana", month: 12, day: 1, year: null },
  ];
  assertEquals(birthdayLines(birthdays, TODAY), [
    "🎂 Hoy es el cumpleaños de Mamá (60).",
    "🎁 Mañana es el cumpleaños de Luis.",
  ]);
});

Deno.test("recordatorios y eventos van en hora de Madrid", () => {
  assertEquals(reminderLines([{ text: "Llamar al médico", remind_at: "2026-10-22T08:30:00Z" }]), [
    "⏰ Recordatorios de hoy:",
    "• 10:30 Llamar al médico",
  ]);
  assertEquals(reminderLines([]), []);
  assertEquals(eventLines([{ title: "Viaje", start: null, date: TODAY }]), [
    "📅 Hoy en tu calendario:",
    "• Todo el día Viaje",
  ]);
});

Deno.test("el saludo cambia de un día al siguiente y siempre dice la fecha", () => {
  assertNotEquals(greetingLine("2026-10-22"), greetingLine("2026-10-23"));
  assertStringIncludes(greetingLine("2026-10-23"), "Hoy es viernes, 23 de octubre.");
});

Deno.test("el resumen junta solo las partes que tienen algo", () => {
  assertEquals(composeSummary([["a"], [], ["b", "c"]]), "a\n\nb\nc");
});

Deno.test("si el tiempo falla, el resumen lo dice y sigue; sin avisos ni Google no habla de ellos", async () => {
  const { db } = fakeDb((query) => {
    if (query[0] === 'from("reminders")') return { data: [{ text: "Llamar", remind_at: "2026-10-22T16:00:00Z" }] };
    if (query[0] === 'from("google_connections")') return { data: null };
    if (query[0] === 'from("birthdays")') return { data: [] };
    return { data: [{ id: 1, text: "leche" }] };
  });
  // AEMET contesta así cuando no hay avisos.
  const respond = (request: Request) =>
    request.url.includes("aemet")
      ? Response.json({ descripcion: "No hay datos que satisfagan esos criterios", estado: 404 }, { status: 404 })
      : new Response("", { status: 404 });
  await withFakeFetch({ AEMET_API_KEY: "a" }, respond, async () => {
    assertEquals(
      await buildMorningSummary(db, NOW),
      [
        "☀️ Buenos días, Petzi. Hoy es jueves, 22 de octubre.",
        "(No he podido consultar el tiempo: Open-Meteo respondió 404)",
        "⏰ Recordatorios de hoy:\n• 18:00 Llamar",
        "🛒 Tienes 1 cosa en la lista de la compra.",
      ].join("\n\n"),
    );
  });
});

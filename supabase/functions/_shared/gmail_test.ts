import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { formatEmails, morningEmailLines, parseGmailRequest, replyToGmail, senderName } from "./gmail.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const GOOGLE_ENV = { GOOGLE_CLIENT_ID: "cliente", GOOGLE_CLIENT_SECRET: "secreto" };

function dbWithConnection(refreshToken: string | null) {
  return fakeDb(() => ({ data: refreshToken ? { refresh_token: refreshToken } : null }));
}

const MESSAGE = {
  payload: {
    headers: [
      { name: "From", value: '"Agencia Tributaria" <notificaciones@agenciatributaria.es>' },
      { name: "Subject", value: "Nueva notificación" },
      { name: "Date", value: "Thu, 22 Oct 2026 09:15:00 +0200" },
    ],
  },
};

/** Google de prueba: token de acceso, una lista con los ids y los metadatos de cada correo. */
function gmail(ids: string[], resultSizeEstimate = ids.length) {
  return (request: Request) => {
    const url = new URL(request.url);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "acceso" });
    if (url.pathname.endsWith("/messages")) {
      return Response.json({ messages: ids.map((id) => ({ id })), resultSizeEstimate });
    }
    return Response.json(MESSAGE);
  };
}

Deno.test("la búsqueda la decide el modelo; sin búsqueda, los no leídos de la bandeja", () => {
  assertEquals(parseGmailRequest({ query: " from:hacienda " }), { kind: "gmail_search", query: "from:hacienda" });
  assertEquals(parseGmailRequest({ query: null }), { kind: "gmail_search", query: "is:unread in:inbox" });
  assertEquals(parseGmailRequest({ query: "x".repeat(201) }).kind, "invalid");
});

Deno.test("del remitente se queda el nombre, o la dirección si no lo hay", () => {
  assertEquals(senderName('"Juan Pérez" <juan@x.com>'), "Juan Pérez");
  assertEquals(senderName("<juan@x.com>"), "juan@x.com");
  assertEquals(senderName(""), "(sin remitente)");
});

Deno.test("busca con la consulta y lee solo remitente, asunto y fecha de cada correo", async () => {
  const { db } = dbWithConnection("refresco");
  await withFakeFetch(GOOGLE_ENV, gmail(["a1"]), async (requests) => {
    assertEquals(
      await replyToGmail(db, { kind: "gmail_search", query: "from:hacienda" }),
      "📧 1 correo:\n• Agencia Tributaria: Nueva notificación (jueves, 22 de octubre, 09:15)",
    );
    const list = new URL(requests[1].url);
    assertEquals(list.searchParams.get("q"), "from:hacienda");
    const detail = new URL(requests[2].url);
    assertEquals(detail.searchParams.get("format"), "metadata");
    assertEquals(detail.searchParams.getAll("metadataHeaders"), ["From", "Subject", "Date"]);
  });
});

Deno.test("si hay más de los que enseña, lo dice", () => {
  const email = { from: "Ana", subject: "Hola", date: null };
  assertEquals(formatEmails([email], 5), "📧 1 correo:\n• Ana: Hola\n…y unos 4 más.");
  assertEquals(formatEmails([], 0), "No he encontrado ningún correo así.");
});

Deno.test("sin Google conectado o sin permiso de Gmail, explica cómo arreglarlo", async () => {
  const { db: disconnected } = dbWithConnection(null);
  assertStringIncludes(
    await replyToGmail(disconnected, { kind: "gmail_search", query: "is:unread" }),
    "No tienes Google conectado",
  );
  const { db } = dbWithConnection("refresco");
  const insufficientScope = (request: Request) =>
    new URL(request.url).hostname === "oauth2.googleapis.com"
      ? Response.json({ access_token: "acceso" })
      : Response.json({
        error: {
          code: 403,
          message: "Request had insufficient authentication scopes.",
          status: "PERMISSION_DENIED",
          details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
        },
      }, { status: 403 });
  await withFakeFetch(GOOGLE_ENV, insufficientScope, async () => {
    assertStringIncludes(
      await replyToGmail(db, { kind: "gmail_search", query: "is:unread" }),
      "Vuelve a conectar Google con /conectar_calendario",
    );
  });
});

Deno.test("el resumen de la mañana solo habla del correo si hay importantes sin leer", () => {
  assertEquals(morningEmailLines([], 0), []);
  assertEquals(morningEmailLines([{ from: "Ana", subject: "Cena", date: null }], 1), [
    "📧 1 correo importante sin leer:",
    "• Ana: Cena",
  ]);
});

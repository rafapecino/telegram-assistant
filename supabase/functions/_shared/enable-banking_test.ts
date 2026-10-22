import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.19";
import { createEnableBankingJwt, deleteBankSession, EnableBankingError, pemToPkcs8Bytes } from "./enable-banking.ts";
import { describeRequests, generateTestKeyPair, withEnableBanking } from "./testing.ts";

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), (c) => c.charCodeAt(0));
}

Deno.test("el JWT lleva la cabecera y los campos que pide Enable Banking y su firma es válida", async () => {
  const { pem, publicKey } = await generateTestKeyPair();
  const jwt = await createEnableBankingJwt("app-id", pem, new Date("2026-10-21T10:00:00Z"));
  const [header, payload, signature] = jwt.split(".");

  assertEquals(JSON.parse(new TextDecoder().decode(base64UrlDecode(header))), {
    typ: "JWT",
    alg: "RS256",
    kid: "app-id",
  });
  assertEquals(JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))), {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: 1792576800,
    exp: 1792580400,
  });
  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    base64UrlDecode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  assertEquals(isValid, true);
});

Deno.test("acepta el .pem pegado con saltos de línea escritos como \\n", async () => {
  const { pem } = await generateTestKeyPair();
  assertEquals(pemToPkcs8Bytes(pem.replaceAll("\n", "\\n")), pemToPkcs8Bytes(pem));
});

Deno.test("rechaza claves PKCS#1 con un mensaje claro", () => {
  assertThrows(
    () => pemToPkcs8Bytes("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"),
    Error,
    "PKCS#8",
  );
});

Deno.test("cerrar la sesión hace DELETE /sessions/{id} firmado con el JWT de la aplicación", async () => {
  await withEnableBanking(() => new Response("{}"), async (requests) => {
    await deleteBankSession("sesion-1");
    assertEquals(describeRequests(requests), ["DELETE /sessions/sesion-1"]);
    assertEquals(requests[0].headers.get("authorization")?.startsWith("Bearer "), true);
  });
});

Deno.test("si Enable Banking ya no tiene la sesión (404), se da por cerrada", async () => {
  await withEnableBanking(() => Response.json({ error: "NOT_FOUND" }, { status: 404 }), async () => {
    await deleteBankSession("sesion-1");
  });
});

Deno.test("cualquier otro error al cerrar la sesión se propaga con su código", async () => {
  await withEnableBanking(() => Response.json({ error: "ERROR", message: "caído" }, { status: 500 }), async () => {
    const error = await assertRejects(() => deleteBankSession("sesion-1"), EnableBankingError);
    assertEquals(error.status, 500);
  });
});

import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { createEnableBankingJwt, pemToPkcs8Bytes } from "./enable-banking.ts";

async function generateTestKeyPair(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const base64 = btoa(String.fromCharCode(...pkcs8)).match(/.{1,64}/g)!.join("\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`, publicKey: keyPair.publicKey };
}

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

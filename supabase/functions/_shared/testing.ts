// Ayudas para las pruebas: un cliente de Supabase y una API de Enable Banking de mentira.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

/**
 * Imita el cliente de Supabase. Cada consulta apunta sus pasos (por ejemplo `from("bank_sessions")`, `delete()`) y,
 * al esperarla, devuelve lo que diga `respond` para esos pasos.
 */
export function fakeDb(respond: (query: string[]) => unknown): { db: SupabaseClient; queries: string[][] } {
  const queries: string[][] = [];
  const db = {
    from(table: string) {
      const query = [`from(${JSON.stringify(table)})`];
      queries.push(query);
      const builder: unknown = new Proxy({}, {
        get(_target, method) {
          if (method === "then") {
            return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
              Promise.resolve().then(() => respond(query)).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            query.push(`${String(method)}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`);
            return builder;
          };
        },
      });
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

export async function generateTestKeyPair(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const base64 = btoa(String.fromCharCode(...pkcs8)).match(/.{1,64}/g)!.join("\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`, publicKey: keyPair.publicKey };
}

/** Durante `test`, las llamadas a fetch las responde `respond` y se apuntan en `requests`. */
export async function withEnableBanking(
  respond: (request: Request) => Response,
  test: (requests: Request[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  Deno.env.set("ENABLE_BANKING_APP_ID", "app-de-prueba");
  Deno.env.set("ENABLE_BANKING_PRIVATE_KEY", (await generateTestKeyPair()).pem);
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return Promise.resolve().then(() => respond(request));
  };
  try {
    await test(requests);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("ENABLE_BANKING_APP_ID");
    Deno.env.delete("ENABLE_BANKING_PRIVATE_KEY");
  }
}

/** "DELETE /sessions/abc" de cada petición, para comprobar qué se ha llamado. */
export function describeRequests(requests: Request[]): string[] {
  return requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
}

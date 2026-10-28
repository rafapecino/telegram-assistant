import { assertEquals } from "jsr:@std/assert@1.0.19";
import { CALENDAR_SCOPE, GMAIL_SCOPE } from "./calendar.ts";
import { describeGoogleAccount, describeScopes, listBankAccess } from "./connected-accounts.ts";
import { fakeDb, withFakeFetch } from "./testing.ts";

const GOOGLE_ENV = { GOOGLE_CLIENT_ID: "cliente", GOOGLE_CLIENT_SECRET: "secreto" };
const SINCE = "2026-10-23T10:00:00Z";

function dbWithGoogle(isConnected: boolean) {
  return fakeDb((query) =>
    query[1] === 'select("created_at")'
      ? { data: isConnected ? { created_at: SINCE } : null }
      : { data: isConnected ? { refresh_token: "refresco" } : null }
  );
}

Deno.test("sin Google conectado no llama a Google", async () => {
  await withFakeFetch(GOOGLE_ENV, () => new Response("no debería llamarse", { status: 500 }), async (requests) => {
    assertEquals(await describeGoogleAccount(dbWithGoogle(false).db), { connected: false });
    assertEquals(requests.length, 0);
  });
});

// El token va en el cuerpo y no en la URL, para que no quede en ningún log.
Deno.test("enseña los permisos que Google dice que tiene el token", async () => {
  const google = (request: Request) =>
    request.url.endsWith("/token")
      ? Response.json({ access_token: "acceso" })
      : Response.json({ scope: `${CALENDAR_SCOPE} openid` });
  await withFakeFetch(GOOGLE_ENV, google, async (requests) => {
    assertEquals(await describeGoogleAccount(dbWithGoogle(true).db), {
      connected: true,
      since: SINCE,
      permissions: ["Calendario: ver, crear y cambiar eventos"],
    });
    assertEquals(requests[1].url, "https://oauth2.googleapis.com/tokeninfo");
    assertEquals(await requests[1].text(), "access_token=acceso");
  });
});

Deno.test("si Google retiró el acceso, lo dice en vez de fallar", async () => {
  const revoked = () => Response.json({ error: "invalid_grant" }, { status: 400 });
  await withFakeFetch(GOOGLE_ENV, revoked, async () => {
    const account = await describeGoogleAccount(dbWithGoogle(true).db);
    assertEquals(account.connected, true);
    assertEquals(account.problem?.startsWith("Google ha retirado el acceso"), true);
  });
});

Deno.test("traduce los permisos conocidos y omite los técnicos", () => {
  assertEquals(describeScopes([GMAIL_SCOPE, "openid"]), ["Gmail: solo leer (remitente, asunto y fecha)"]);
});

Deno.test("del banco enseña hasta cuándo dura el acceso y a cuántas cuentas", async () => {
  const { db } = fakeDb(() => ({
    data: [{ created_at: SINCE, valid_until: "2027-04-21T10:00:00Z", account_uids: ["a", "b"] }],
  }));
  assertEquals(await listBankAccess(db), [{ connectedAt: SINCE, validUntil: "2027-04-21T10:00:00Z", accounts: 2 }]);
});

import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { disconnectBank } from "./bank-connection.ts";
import { EnableBankingError } from "./enable-banking.ts";
import { describeRequests, fakeDb, withEnableBanking } from "./testing.ts";

const NOW = new Date("2026-10-22T10:00:00Z");
const ACTIVE = { session_id: "vigente", valid_until: "2027-04-01T00:00:00+00:00" };
const EXPIRED = { session_id: "caducada", valid_until: "2026-09-01T00:00:00+00:00" };

function savedSessions(rows: typeof ACTIVE[]) {
  return fakeDb((query) => query.includes("delete()") ? { error: null } : { data: rows, error: null });
}

Deno.test("desconectar cierra en Enable Banking las sesiones vigentes y borra todas las guardadas", async () => {
  const { db, queries } = savedSessions([ACTIVE, EXPIRED]);
  await withEnableBanking(() => new Response("{}"), async (requests) => {
    assertEquals(await disconnectBank(db, NOW), 1);
    assertEquals(describeRequests(requests), ["DELETE /sessions/vigente"]);
  });
  assertEquals(queries[1], ['from("bank_sessions")', "delete()", 'in("session_id", ["vigente","caducada"])']);
});

Deno.test("si Enable Banking falla no se borra nada, para poder repetir el comando", async () => {
  const { db, queries } = savedSessions([ACTIVE]);
  await withEnableBanking(() => new Response("{}", { status: 500 }), async () => {
    await assertRejects(() => disconnectBank(db, NOW), EnableBankingError);
  });
  assertEquals(queries.length, 1);
});

Deno.test("sin conexiones guardadas no llama a Enable Banking ni borra nada", async () => {
  const { db, queries } = savedSessions([]);
  await withEnableBanking(() => new Response("{}"), async (requests) => {
    assertEquals(await disconnectBank(db, NOW), 0);
    assertEquals(requests.length, 0);
  });
  assertEquals(queries.length, 1);
});

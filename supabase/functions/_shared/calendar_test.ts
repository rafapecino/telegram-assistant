import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  CalendarNotConnectedError,
  completeCalendarLink,
  createCalendarLink,
  disconnectCalendar,
  eventBody,
  formatEvents,
  InvalidCalendarLinkError,
  listEvents,
  parseCalendarRequest,
} from "./calendar.ts";
import { describeRequests, fakeDb, withFakeFetch } from "./testing.ts";

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "cliente",
  GOOGLE_CLIENT_SECRET: "secreto",
  SUPABASE_URL: "https://x.supabase.co",
};
const NOW = new Date("2026-10-22T10:00:00Z");

/** Base de datos con una conexión guardada (o ninguna) y que acepta cualquier escritura. */
function dbWithConnection(refreshToken: string | null) {
  return fakeDb((query) =>
    query[0] === 'from("google_connections")' && query[1].startsWith("select(")
      ? { data: refreshToken ? { refresh_token: refreshToken } : null }
      : {}
  );
}

/** Google de prueba: da un token de acceso y responde a la API del calendario con `events`. */
function google(events: unknown[] = []) {
  return (request: Request) => {
    const url = new URL(request.url);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "acceso" });
    return Response.json({ items: events });
  };
}

Deno.test("entiende ver eventos y crearlos con hora o de todo el día", () => {
  assertEquals(parseCalendarRequest({ action: "list", date_from: "2026-10-23", date_to: "2026-10-23" }), {
    kind: "calendar_list",
    dateFrom: "2026-10-23",
    dateTo: "2026-10-23",
  });
  assertEquals(
    parseCalendarRequest({ action: "create", title: "Dentista", local_datetime: "2026-10-23T17:00" }),
    { kind: "calendar_create", title: "Dentista", start: new Date("2026-10-23T15:00:00Z"), durationMinutes: 60 },
  );
  assertEquals(parseCalendarRequest({ action: "create", title: "Viaje", local_datetime: null, date: "2026-11-01" }), {
    kind: "calendar_create_all_day",
    title: "Viaje",
    date: "2026-11-01",
  });
});

Deno.test("un evento a las 00:00 es que no se dijo hora: se crea de todo el día", () => {
  assertEquals(parseCalendarRequest({ action: "create", title: "Galleta Day", local_datetime: "2026-10-28T00:00" }), {
    kind: "calendar_create_all_day",
    title: "Galleta Day",
    date: "2026-10-28",
  });
});

Deno.test("rechaza fechas raras, rangos al revés o de más de dos meses, y corrige duraciones absurdas", () => {
  assertEquals(
    parseCalendarRequest({ action: "list", date_from: "2026-10-23", date_to: "2026-10-01" }).kind,
    "invalid",
  );
  assertEquals(
    parseCalendarRequest({ action: "list", date_from: "2026-10-01", date_to: "2027-01-01" }).kind,
    "invalid",
  );
  assertEquals(
    parseCalendarRequest({ action: "create", title: "Cena", local_datetime: "2026-02-30T21:00" }).kind,
    "invalid",
  );
  assertEquals(parseCalendarRequest({ action: "create", title: " ", date: "2026-11-01" }).kind, "invalid");
  const request = parseCalendarRequest({
    action: "create",
    title: "Cena",
    local_datetime: "2026-10-23T21:00",
    duration_minutes: 99999,
  });
  assertEquals(request.kind === "calendar_create" && request.durationMinutes, 60);
});

Deno.test("los eventos de todo el día terminan el día siguiente, como los cuenta Google", () => {
  assertEquals(eventBody({ kind: "calendar_create_all_day", title: "Viaje", date: "2026-12-31" }), {
    summary: "Viaje",
    start: { date: "2026-12-31" },
    end: { date: "2027-01-01" },
  });
  const timed = eventBody({
    kind: "calendar_create",
    title: "Dentista",
    start: new Date("2026-10-23T15:00:00Z"),
    durationMinutes: 30,
  });
  assertEquals(timed.end, { dateTime: "2026-10-23T15:30:00.000Z", timeZone: "Europe/Madrid" });
});

Deno.test("el enlace para conectar pide los eventos, leer Gmail y acceso permanente", async () => {
  const { db } = fakeDb(() => ({ data: { state: "estado-1" } }));
  await withFakeFetch(GOOGLE_ENV, google(), async () => {
    const link = new URL(await createCalendarLink(db));
    assertEquals(
      link.searchParams.get("scope"),
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly",
    );
    assertEquals(link.searchParams.get("access_type"), "offline");
    assertEquals(link.searchParams.get("state"), "estado-1");
    assertEquals(link.searchParams.get("redirect_uri"), "https://x.supabase.co/functions/v1/google-callback");
  });
});

Deno.test("un enlace usado o caducado no llega a hablar con Google", async () => {
  const { db } = fakeDb(() => ({ data: [] }));
  await withFakeFetch(GOOGLE_ENV, google(), async (requests) => {
    await assertRejects(() => completeCalendarLink(db, "viejo", "codigo", NOW), InvalidCalendarLinkError);
    assertEquals(requests.length, 0);
  });
});

Deno.test("al conectar, la nueva conexión sustituye a la anterior", async () => {
  const { db, queries } = fakeDb((query) =>
    query[0] === 'from("google_authorizations")' ? { data: [{ state: "s" }] } : {}
  );
  await withFakeFetch(GOOGLE_ENV, () => Response.json({ refresh_token: "permanente" }), async (requests) => {
    await completeCalendarLink(db, "s", "codigo", NOW);
    const form = new URLSearchParams(await requests[0].text());
    assertEquals(form.get("grant_type"), "authorization_code");
    assertEquals(form.get("code"), "codigo");
  });
  assertEquals(queries.slice(1), [
    ['from("google_connections")', "delete()", 'gt("id", 0)'],
    ['from("google_connections")', 'insert({"refresh_token":"permanente"})'],
  ]);
});

Deno.test("si Google no da acceso permanente, no guarda nada", async () => {
  const { db, queries } = fakeDb((query) =>
    query[0] === 'from("google_authorizations")' ? { data: [{ state: "s" }] } : {}
  );
  await withFakeFetch(GOOGLE_ENV, () => Response.json({ access_token: "solo-una-hora" }), async () => {
    await assertRejects(() => completeCalendarLink(db, "s", "codigo", NOW), Error, "acceso permanente");
  });
  assertEquals(queries.length, 1);
});

Deno.test("sin calendario conectado se explica cómo conectarlo", async () => {
  const { db } = dbWithConnection(null);
  await withFakeFetch(GOOGLE_ENV, google(), async (requests) => {
    await assertRejects(() => listEvents(db, "2026-10-23", "2026-10-23"), CalendarNotConnectedError);
    assertEquals(requests.length, 0);
  });
});

Deno.test("lista los eventos del día en hora de Madrid", async () => {
  const { db } = dbWithConnection("permanente");
  const events = [
    { summary: "Dentista", start: { dateTime: "2026-10-23T17:00:00+02:00" } },
    { summary: "Viaje", start: { date: "2026-10-23" } },
  ];
  await withFakeFetch(GOOGLE_ENV, google(events), async (requests) => {
    const listed = await listEvents(db, "2026-10-23", "2026-10-23");
    assertEquals(listed, [
      { title: "Dentista", start: new Date("2026-10-23T15:00:00Z"), date: null },
      { title: "Viaje", start: null, date: "2026-10-23" },
    ]);
    const calendarRequest = requests[1];
    assertEquals(calendarRequest.headers.get("Authorization"), "Bearer acceso");
    assertEquals(new URL(calendarRequest.url).searchParams.get("timeMin"), "2026-10-22T22:00:00.000Z");
    assertEquals(new URL(calendarRequest.url).searchParams.get("timeMax"), "2026-10-23T22:00:00.000Z");
    assertEquals(formatEvents(listed).split("\n"), [
      "En tu calendario:",
      "• viernes, 23 de octubre, 17:00 · Dentista",
      "• viernes, 23 de octubre (todo el día) · Viaje",
    ]);
  });
});

Deno.test("si el usuario retiró el permiso en Google, pide volver a conectar", async () => {
  const { db } = dbWithConnection("permanente");
  await withFakeFetch(GOOGLE_ENV, () => Response.json({ error: "invalid_grant" }, { status: 400 }), async () => {
    await assertRejects(() => listEvents(db, "2026-10-23", "2026-10-23"), Error, "/conectar_calendario");
  });
});

Deno.test("desconectar retira el permiso en Google y borra la conexión", async () => {
  const { db, queries } = dbWithConnection("permanente");
  await withFakeFetch(GOOGLE_ENV, () => new Response(""), async (requests) => {
    assertEquals(await disconnectCalendar(db), true);
    assertEquals(describeRequests(requests), ["POST /revoke"]);
  });
  assertEquals(queries.at(-1), ['from("google_connections")', "delete()", 'gt("id", 0)']);
});

Deno.test("desconectar funciona aunque Google ya hubiera olvidado el permiso, y no hace nada sin conexión", async () => {
  const connected = dbWithConnection("permanente");
  await withFakeFetch(GOOGLE_ENV, () => Response.json({ error: "invalid_token" }, { status: 400 }), async () => {
    assertEquals(await disconnectCalendar(connected.db), true);
  });
  assertEquals(connected.queries.length, 2);
  const notConnected = dbWithConnection(null);
  await withFakeFetch(GOOGLE_ENV, google(), async (requests) => {
    assertEquals(await disconnectCalendar(notConnected.db), false);
    assertEquals(requests.length, 0);
  });
});

Deno.test("si Google falla al retirar el permiso, la conexión se conserva para reintentar", async () => {
  const { db, queries } = dbWithConnection("permanente");
  await withFakeFetch(GOOGLE_ENV, () => new Response("", { status: 500 }), async () => {
    await assertRejects(() => disconnectCalendar(db), Error, "Inténtalo de nuevo");
  });
  assertEquals(queries.length, 1);
});

import { completeCalendarLink, InvalidCalendarLinkError } from "../_shared/calendar.ts";
import { createAdminClient } from "../_shared/database.ts";
import { errorMessage } from "../_shared/env.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";

// Supabase no sirve HTML en peticiones GET a funciones, así que la página es texto plano.
function textPage(message: string, status = 200): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function notifyAndRespond(message: string, status: number): Promise<Response> {
  await sendTelegramMessage(message).catch((error) => console.error("No se pudo avisar por Telegram", error));
  return textPage(message, status);
}

Deno.serve(async (request) => {
  const params = new URL(request.url).searchParams;
  const googleError = params.get("error");
  // Esta URL es pública: un error solo se cuenta en la página, sin escribir por Telegram, para que nadie pueda usarla
  // para mandarte mensajes.
  if (googleError) return textPage(`Google no autorizó el acceso: ${googleError}`, 400);
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return textPage("Faltan los parámetros state y code.", 400);

  const db = createAdminClient();
  try {
    await completeCalendarLink(db, state, code, new Date());
    const message = "Google conectado. Ya puedes preguntarme «¿qué tengo mañana?», pedirme que añada eventos o " +
      "preguntarme por tu correo, por ejemplo «¿tengo correos sin leer?».";
    await sendTelegramMessage(message).catch((error) => console.error("No se pudo avisar por Telegram", error));
    return textPage(`${message}\n\nYa puedes cerrar esta pestaña y volver a Telegram.`);
  } catch (error) {
    // Un enlace reutilizado no es un fallo de la conexión: basta con decirlo en la página.
    if (error instanceof InvalidCalendarLinkError) return textPage(error.message, 400);
    console.error(error);
    return notifyAndRespond(`No se pudo conectar el calendario: ${errorMessage(error)}`, 500);
  }
});

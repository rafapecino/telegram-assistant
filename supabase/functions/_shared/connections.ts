// Conectar y desconectar el banco y la cuenta de Google (calendario y Gmail), con comando o con lenguaje natural.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { createBankLink, disconnectBank } from "./bank-connection.ts";
import { createCalendarLink, disconnectCalendar } from "./calendar.ts";
import type { ButtonResult } from "./personal-replies.ts";
import type { BotReply } from "./telegram.ts";

export type ConnectedService = "bank" | "google";

/** Formato que el modelo debe devolver cuando el mensaje pide conectar o desconectar algo (ver message-intent.ts). */
export const CONNECTION_INTENT_FORMAT =
  'Conectar o desconectar su banco o su cuenta de Google (calendario y Gmail): {"intent": "connection", "service": ' +
  '"bank" o "google", "action": "connect" o "disconnect"}, por ejemplo "conecta mi Gmail", "vuelve a conectar ' +
  'Google", "autoriza el banco otra vez", "desconecta el banco". También si pregunta cómo conectarlo.';

export type ConnectionRequest =
  | { kind: "connection_connect"; service: ConnectedService }
  | { kind: "connection_disconnect"; service: ConnectedService }
  | { kind: "invalid"; message: string };

export function parseConnectionRequest(raw: unknown): ConnectionRequest {
  const candidate = raw as { service?: unknown; action?: unknown } | null;
  const service = candidate?.service;
  if (service !== "bank" && service !== "google") {
    return { kind: "invalid", message: "¿Qué quieres conectar, el banco o tu cuenta de Google?" };
  }
  if (candidate?.action === "connect") return { kind: "connection_connect", service };
  if (candidate?.action === "disconnect") return { kind: "connection_disconnect", service };
  return { kind: "invalid", message: "No he entendido si quieres conectar o desconectar." };
}

export async function describeBankLink(db: SupabaseClient, now: Date): Promise<string> {
  return `Autoriza el acceso desde tu banco en este enlace (caduca en 30 minutos):\n${await createBankLink(db, now)}`;
}

export async function describeGoogleLink(db: SupabaseClient): Promise<string> {
  return "Autoriza tu cuenta de Google en este enlace (caduca en 30 minutos). Marca también la casilla de Gmail " +
    `para que pueda leer tu correo:\n${await createCalendarLink(db)}`;
}

export async function disconnectBankAndDescribe(db: SupabaseClient, now: Date): Promise<string> {
  const closedConnections = await disconnectBank(db, now);
  if (closedConnections === 0) return "No había ninguna conexión con el banco activa.";
  // Enable Banking cierra el permiso en el banco "si es posible": por eso se dice que se ha pedido, no que esté hecho.
  return [
    "Banco desconectado: he cerrado el acceso en Enable Banking y he pedido al banco que retire el permiso.",
    "Ya no importaré más gastos; los que ya tengo siguen guardados. Para volver a conectarlo, pídemelo.",
  ].join("\n");
}

export async function disconnectGoogleAndDescribe(db: SupabaseClient): Promise<string> {
  return await disconnectCalendar(db)
    ? "Google desconectado: he retirado el permiso del calendario y de Gmail."
    : "No tenías Google conectado.";
}

const SERVICE_NAMES: Record<ConnectedService, string> = { bank: "el banco", google: "tu cuenta de Google" };
const STILL_CONNECTED: Record<ConnectedService, string> = {
  bank: "Vale, el banco sigue conectado.",
  google: "Vale, tu cuenta de Google sigue conectada.",
};
const DISCONNECT_WARNINGS: Record<ConnectedService, string> = {
  bank: "Dejaré de importar tus gastos; los que ya tengo se quedan.",
  google: "Dejaré de ver tu calendario y tu correo.",
};

/**
 * Con lenguaje natural, desconectar pide confirmación: una frase mal entendida ("¿cómo desconecto el banco?") no
 * debe cortar el acceso. Conectar solo da un enlace, así que no hace falta.
 */
export async function replyToConnection(db: SupabaseClient, request: ConnectionRequest, now: Date): Promise<BotReply> {
  switch (request.kind) {
    case "connection_connect":
      return { text: request.service === "bank" ? await describeBankLink(db, now) : await describeGoogleLink(db) };
    case "connection_disconnect":
      return {
        text: `¿Seguro que quieres desconectar ${SERVICE_NAMES[request.service]}? ${
          DISCONNECT_WARNINGS[request.service]
        }`,
        buttons: [[
          { text: "Sí, desconectar", callback_data: `connection:disconnect:${request.service}` },
          { text: "No", callback_data: `connection:keep:${request.service}` },
        ]],
      };
    case "invalid":
      return { text: request.message };
  }
}

export function parseConnectionButton(data: string): { service: ConnectedService; disconnect: boolean } | null {
  const match = data.match(/^connection:(disconnect|keep):(bank|google)$/);
  return match ? { service: match[2] as ConnectedService, disconnect: match[1] === "disconnect" } : null;
}

export async function applyConnectionButton(
  db: SupabaseClient,
  button: { service: ConnectedService; disconnect: boolean },
  now: Date,
): Promise<ButtonResult> {
  if (!button.disconnect) {
    return { message: { text: STILL_CONNECTED[button.service] }, toast: "Sin cambios" };
  }
  const text = button.service === "bank"
    ? await disconnectBankAndDescribe(db, now)
    : await disconnectGoogleAndDescribe(db);
  return { message: { text }, toast: "Desconectado" };
}

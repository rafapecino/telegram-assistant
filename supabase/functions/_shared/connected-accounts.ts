// Cuentas conectadas para la sección Ajustes del panel: qué hay conectado, desde cuándo y con qué permisos.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { CALENDAR_SCOPE, getAccessToken, GMAIL_SCOPE, parseJsonOrEmpty } from "./calendar.ts";
import { UserFacingError } from "./errors.ts";

const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const SCOPE_LABELS: Record<string, string> = {
  [CALENDAR_SCOPE]: "Calendario: ver, crear y cambiar eventos",
  [GMAIL_SCOPE]: "Gmail: solo leer (remitente, asunto y fecha)",
};

export interface GoogleAccount {
  connected: boolean;
  since?: string;
  permissions?: string[];
  // Si Google ya no acepta la conexión, el motivo; así se puede ver aquí antes de que falle el calendario.
  problem?: string;
}

export interface BankAccess {
  connectedAt: string;
  validUntil: string;
  accounts: number;
}

/** Los permisos que Google dice que tiene el token, no los que se pidieron: el usuario pudo desmarcar alguno. */
async function grantedGoogleScopes(db: SupabaseClient): Promise<string[]> {
  // Por POST para que el token no quede en ninguna URL ni en logs.
  const response = await fetch(GOOGLE_TOKEN_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: await getAccessToken(db) }),
  });
  const info = parseJsonOrEmpty(await response.text());
  if (!response.ok || typeof info.scope !== "string") {
    throw new Error(`Google respondió ${response.status} al consultar los permisos.`);
  }
  return info.scope.split(" ").filter(Boolean);
}

export function describeScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => SCOPE_LABELS[scope]).map((scope) => SCOPE_LABELS[scope]);
}

export async function describeGoogleAccount(db: SupabaseClient): Promise<GoogleAccount> {
  const { data, error } = await db.from("google_connections").select("created_at").limit(1).maybeSingle();
  if (error) throw new Error(`No se pudo leer la conexión con Google: ${error.message}`);
  if (!data) return { connected: false };
  try {
    return { connected: true, since: data.created_at, permissions: describeScopes(await grantedGoogleScopes(db)) };
  } catch (scopeError) {
    if (!(scopeError instanceof UserFacingError)) throw scopeError;
    return { connected: true, since: data.created_at, problem: scopeError.message };
  }
}

export async function listBankAccess(db: SupabaseClient): Promise<BankAccess[]> {
  const { data, error } = await db.from("bank_sessions").select("created_at,valid_until,account_uids")
    .order("valid_until", { ascending: false });
  if (error) throw new Error(`No se pudo leer la conexión con el banco: ${error.message}`);
  return (data as { created_at: string; valid_until: string; account_uids: unknown }[]).map((session) => ({
    connectedAt: session.created_at,
    validUntil: session.valid_until,
    accounts: Array.isArray(session.account_uids) ? session.account_uids.length : 0,
  }));
}

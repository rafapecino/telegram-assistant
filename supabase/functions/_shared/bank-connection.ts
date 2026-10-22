import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { functionUrl } from "./database.ts";
import { type BankSession, createBankSession, deleteBankSession, startBankAuthorization } from "./enable-banking.ts";

const AUTHORIZATION_LINK_LIFETIME_MINUTES = 30;

/** El enlace ya se usó o ha caducado: pasa, por ejemplo, al recargar la página de confirmación. */
export class InvalidBankLinkError extends Error {}

export async function createBankLink(db: SupabaseClient, now: Date): Promise<string> {
  const { data, error } = await db.from("bank_authorizations").insert({}).select("state").single();
  if (error) throw new Error(`No se pudo preparar la autorización: ${error.message}`);
  return startBankAuthorization(data.state, functionUrl("bank-callback"), now);
}

/** Canjea el código que devuelve el banco. El state se consume una sola vez para que un enlace viejo no sirva. */
export async function completeBankLink(
  db: SupabaseClient,
  state: string,
  code: string,
  now: Date,
): Promise<BankSession> {
  const oldestValidLink = new Date(now.getTime() - AUTHORIZATION_LINK_LIFETIME_MINUTES * 60_000);
  const { data: claimed, error } = await db.from("bank_authorizations")
    .update({ used_at: now.toISOString() })
    .eq("state", state)
    .is("used_at", null)
    .gte("created_at", oldestValidLink.toISOString())
    .select("state");
  if (error) throw new Error(`No se pudo validar la autorización: ${error.message}`);
  if (claimed.length === 0) {
    throw new InvalidBankLinkError(
      "Este enlace ya se usó o ha caducado. Si necesitas conectar el banco, pide otro con /conectar_banco.",
    );
  }

  const session = await createBankSession(code);
  const { error: insertError } = await db.from("bank_sessions").insert({
    session_id: session.sessionId,
    account_uids: session.accountUids,
    valid_until: session.validUntil,
  });
  if (insertError) throw new Error(`No se pudo guardar la conexión con el banco: ${insertError.message}`);
  return session;
}

export async function getActiveBankSession(db: SupabaseClient, now: Date): Promise<BankSession | null> {
  const { data, error } = await db.from("bank_sessions")
    .select("session_id, account_uids, valid_until")
    .gt("valid_until", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conexión con el banco: ${error.message}`);
  if (!data) return null;
  return { sessionId: data.session_id, accountUids: data.account_uids, validUntil: data.valid_until };
}

/** Distingue "nunca conectado o desconectado a propósito" (false) de "conectado pero caducado" (true). */
export async function hasBankConnections(db: SupabaseClient): Promise<boolean> {
  const { count, error } = await db.from("bank_sessions").select("session_id", { count: "exact", head: true });
  if (error) throw new Error(`No se pudo leer la conexión con el banco: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Cierra en Enable Banking las conexiones vigentes y borra todas las guardadas. Devuelve cuántas seguían vigentes.
 * Si Enable Banking falla no se borra nada, para poder repetir el comando.
 */
export async function disconnectBank(db: SupabaseClient, now: Date): Promise<number> {
  const { data: sessions, error } = await db.from("bank_sessions").select("session_id, valid_until");
  if (error) throw new Error(`No se pudo leer la conexión con el banco: ${error.message}`);
  const activeSessions = sessions.filter((session) => new Date(session.valid_until) > now);
  for (const session of activeSessions) await deleteBankSession(session.session_id);
  if (sessions.length > 0) {
    const { error: deleteError } = await db.from("bank_sessions").delete()
      .in("session_id", sessions.map((session) => session.session_id));
    if (deleteError) throw new Error(`No se pudo borrar la conexión con el banco: ${deleteError.message}`);
  }
  return activeSessions.length;
}

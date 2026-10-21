import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { functionUrl } from "./database.ts";
import { type BankSession, createBankSession, startBankAuthorization } from "./enable-banking.ts";

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

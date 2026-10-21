import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { requireEnv } from "./env.ts";

export function createAdminClient(): SupabaseClient {
  // Clave secreta nueva (sb_secret_...): la service_role legacy deja de funcionar a finales de 2026.
  const secretKeys = JSON.parse(requireEnv("SUPABASE_SECRET_KEYS"));
  return createClient(requireEnv("SUPABASE_URL"), secretKeys.default, {
    auth: { persistSession: false },
  });
}

export async function getInternalSecret(db: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await db.rpc("get_internal_secret", { secret_name: name });
  if (error) throw new Error(`No se pudo leer el secreto interno ${name}: ${error.message}`);
  if (!data) throw new Error(`El secreto interno ${name} no existe en Vault.`);
  return data as string;
}

export function functionUrl(functionName: string): string {
  return `${requireEnv("SUPABASE_URL")}/functions/v1/${functionName}`;
}

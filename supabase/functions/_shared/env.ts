/** Lee un secreto obligatorio y, si falta, explica dónde configurarlo. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Falta el secreto ${name}. Añádelo en Supabase → Edge Functions → Secrets.`);
  }
  return value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

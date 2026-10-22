import { requireEnv } from "./env.ts";

const ENABLE_BANKING_API = "https://api.enablebanking.com";
// Banco del usuario. Enable Banking lo identifica por nombre y país.
const BANK = { name: "Banco Santander", country: "ES" };

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/** Acepta el .pem con saltos de línea reales o escritos como "\n", según cómo se haya pegado en Supabase. */
export function pemToPkcs8Bytes(pem: string): Uint8Array<ArrayBuffer> {
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error("La clave privada está en formato PKCS#1; hace falta PKCS#8 (BEGIN PRIVATE KEY).");
  }
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\\n|\s/g, "");
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
}

/** JWT firmado con la clave de la aplicación: Enable Banking lo exige en cada petición. */
export async function createEnableBankingJwt(applicationId: string, privateKeyPem: string, now: Date): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Bytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64UrlEncodeJson({ typ: "JWT", alg: "RS256", kid: applicationId });
  const payload = base64UrlEncodeJson({
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: issuedAt,
    exp: issuedAt + 3600,
  });
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function parseResponseBody(text: string): Record<string, unknown> {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

/** Respuesta de error de Enable Banking. Guarda el código HTTP para distinguir, por ejemplo, un 404. */
export class EnableBankingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function enableBankingRequest<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const jwt = await createEnableBankingJwt(
    requireEnv("ENABLE_BANKING_APP_ID").trim(),
    requireEnv("ENABLE_BANKING_PRIVATE_KEY"),
    new Date(),
  );
  const response = await fetch(`${ENABLE_BANKING_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = parseResponseBody(await response.text());
  if (!response.ok) {
    const detail = result.error ? `${result.error}: ${result.message}` : JSON.stringify(result);
    throw new EnableBankingError(
      `Enable Banking respondió ${response.status} en ${path.split("?")[0]} (${detail})`,
      response.status,
    );
  }
  return result as T;
}

async function getMaximumConsentSeconds(): Promise<number> {
  const { aspsps } = await enableBankingRequest<{ aspsps: { name: string; maximum_consent_validity: number }[] }>(
    "GET",
    `/aspsps?country=${BANK.country}&psu_type=personal`,
  );
  const bank = aspsps.find((aspsp) => aspsp.name === BANK.name);
  if (!bank) throw new Error(`Enable Banking no tiene "${BANK.name}" en la lista de bancos de ${BANK.country}.`);
  return bank.maximum_consent_validity;
}

/** Devuelve el enlace en el que el usuario autoriza el acceso desde su banco. */
export async function startBankAuthorization(state: string, redirectUrl: string, now: Date): Promise<string> {
  // Se resta un minuto de margen: el banco rechaza fechas por encima de su máximo.
  const validitySeconds = (await getMaximumConsentSeconds()) - 60;
  const validUntil = new Date(now.getTime() + validitySeconds * 1000).toISOString().replace("Z", "+00:00");
  const { url } = await enableBankingRequest<{ url: string }>("POST", "/auth", {
    access: { valid_until: validUntil },
    aspsp: BANK,
    state,
    redirect_url: redirectUrl,
    psu_type: "personal",
  });
  return url;
}

export interface BankSession {
  sessionId: string;
  accountUids: string[];
  validUntil: string;
}

export async function createBankSession(code: string): Promise<BankSession> {
  const session = await enableBankingRequest<{
    session_id: string;
    accounts: { uid?: string }[];
    access: { valid_until: string };
  }>("POST", "/sessions", { code });
  const accountUids = session.accounts.map((account) => account.uid).filter((uid): uid is string => Boolean(uid));
  if (accountUids.length === 0) throw new Error("El banco no ha compartido ninguna cuenta.");
  return { sessionId: session.session_id, accountUids, validUntil: session.access.valid_until };
}

/** Cierra la sesión en Enable Banking, que a su vez cierra el permiso en el banco cuando el banco lo permite. */
export async function deleteBankSession(sessionId: string): Promise<void> {
  try {
    await enableBankingRequest("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
  } catch (error) {
    // 404: Enable Banking ya no tiene la sesión (caducó o se cerró antes), así que no queda ningún acceso que cerrar.
    if (error instanceof EnableBankingError && error.status === 404) return;
    throw error;
  }
}

export interface BankTransaction {
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string | null } | null;
  // Quien paga: en los ingresos es lo que identifica el movimiento (en los gastos lo es creditor, quien cobra).
  debtor?: { name?: string | null } | null;
  remittance_information?: string[] | null;
}

export async function fetchTransactions(accountUid: string, dateFrom: string): Promise<BankTransaction[]> {
  const transactions: BankTransaction[] = [];
  let continuationKey: string | null | undefined;
  do {
    const query = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) query.set("continuation_key", continuationKey);
    const page = await enableBankingRequest<{ transactions: BankTransaction[]; continuation_key?: string | null }>(
      "GET",
      `/accounts/${accountUid}/transactions?${query}`,
    );
    transactions.push(...page.transactions);
    continuationKey = page.continuation_key;
  } while (continuationKey);
  return transactions;
}

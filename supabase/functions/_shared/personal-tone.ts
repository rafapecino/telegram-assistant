// Las respuestas a las acciones («Apuntado: «leche».») salían secas. Groq les pone el tono del asistente.
import { askGroqForJson } from "./groq.ts";
import { nicknameGuide } from "./memory.ts";

// Las confirmaciones son cortas; los informes (gastos, listas) llevan saltos de línea y se dejan tal cual.
const MAX_TONE_LENGTH = 300;
// Algo de variedad para que no salga siempre la misma frase, sin llegar a desvariar.
const TONE_TEMPERATURE = 0.8;
// Lo que no puede cambiar al reescribir: textos entre comillas, enlaces, números, días y meses.
const FACTS =
  /«([^»]+)»|"([^"]+)"|(https?:\/\/\S+)|(\d+(?:[.,:]\d+)*)|\b(hoy|mañana|lunes|martes|miércoles|jueves|viernes|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/gi;

/** Los datos de la respuesta original que la reescrita debe conservar tal cual. */
export function factsOf(reply: string): string[] {
  return [...reply.matchAll(FACTS)].map((match) => match.slice(1).find(Boolean)!.toLowerCase());
}

/** La reescritura vale si es texto, no se alarga demasiado y conserva todos los datos. */
export function parseTonedReply(raw: unknown, original: string): string | null {
  const text = (raw as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TONE_LENGTH * 2) return null;
  const rewritten = text.trim().toLowerCase();
  return factsOf(original).every((fact) => rewritten.includes(fact)) ? text.trim() : null;
}

/** La misma respuesta con el tono del asistente. Si no es una confirmación corta o algo falla, la original. */
export async function withPersonalTone(reply: string): Promise<string> {
  if (reply.length > MAX_TONE_LENGTH || reply.includes("\n")) return reply;
  try {
    const raw = await askGroqForJson(
      [
        "Reescribes en español la respuesta de un asistente personal a Rafa, como un colega de confianza: cercano,",
        "con guasa y breve (una o dos frases).",
        nicknameGuide(),
        "Conserva exactamente todos los datos: textos entre comillas, números, horas, fechas, días, importes y",
        "enlaces. No añadas datos nuevos ni prometas nada que no diga. Si es un error, que siga claro qué ha fallado.",
        'Responde solo con JSON {"text": "<respuesta reescrita>"}.',
      ].join(" "),
      reply,
      TONE_TEMPERATURE,
    );
    return parseTonedReply(raw, reply) ?? reply;
  } catch (error) {
    // El tono es un extra: si Groq falla, la respuesta seca sigue siendo correcta.
    console.error("Tono personal: Groq no pudo reescribir la respuesta, se manda la original:", error);
    return reply;
  }
}

import { requireEnv } from "./env.ts";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
// Modelo open source. Groq usa el formato de la API de OpenAI: cambiar de proveedor es cambiar URL y modelo.
const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// Whisper turbo: solo transcribe (no traduce), que es lo único que hace falta, y es el más barato de Groq.
const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";

/** Pasa a texto un audio en español. `fileName` debe llevar una extensión que Groq acepte (por ejemplo .ogg). */
export async function transcribeAudio(audio: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, fileName);
  form.append("model", GROQ_TRANSCRIPTION_MODEL);
  form.append("language", "es");
  form.append("response_format", "json");
  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Groq respondió ${response.status} al transcribir: ${await response.text()}`);
  const { text } = await response.json();
  return typeof text === "string" ? text.trim() : "";
}

/** Pide al modelo una respuesta en JSON y la devuelve ya parseada (sin validar: eso lo hace quien llama). */
export async function askGroqForJson(systemPrompt: string, userMessage: string): Promise<unknown> {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`Groq respondió ${response.status}: ${await response.text()}`);
  const completion = await response.json();
  const content = completion.choices?.[0]?.message?.content;
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Groq no devolvió un JSON válido: ${content}`);
  }
}

/** Quita espacios sobrantes y pone la primera letra en mayúscula: " mamá " → "Mamá". */
export function tidyName(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Para comparar textos sin que importen mayúsculas, tildes ni espacios: " Plátanos" → "platanos". */
export function comparable(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ");
}

/**
 * Busca por nombre sin que importen mayúsculas ni tildes. Si no hay uno igual, vale uno que contenga al otro
 * ("hacer ejercicio" encuentra "Ejercicio"), pero solo si es el único: con varios candidatos no se adivina.
 */
export function matchByName<T extends { name: string }>(items: T[], name: string): T | null {
  const wanted = comparable(name);
  const exact = items.find((item) => comparable(item.name) === wanted);
  if (exact) return exact;
  const partial = items.filter((item) => {
    const candidate = comparable(item.name);
    return candidate.includes(wanted) || wanted.includes(candidate);
  });
  return partial.length === 1 ? partial[0] : null;
}

/** Lista de textos no vacíos y sin repetir, recortados a `maxLength`. Lo que no es texto se descarta. */
export function cleanTextList(raw: unknown, maxLength: number): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item.trim().replace(/\s+/g, " ").slice(0, maxLength);
    if (!text || seen.has(comparable(text))) continue;
    seen.add(comparable(text));
    result.push(text);
  }
  return result;
}

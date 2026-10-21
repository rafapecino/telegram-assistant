// Validación del formulario de recordatorios. Sin React, para poder probarla con node --test.

export interface ReminderFormError {
  field: "text" | "when";
  message: string;
}

/** `when` y `nowLocal` van en el formato de <input type="datetime-local"> en hora de Madrid, así que se comparan como texto. */
export function validateReminderForm(text: string, when: string, nowLocal: string): ReminderFormError | null {
  if (!text.trim()) return { field: "text", message: "Escribe qué quieres que te recuerde" };
  if (!when) return { field: "when", message: "Elige cuándo quieres que te lo recuerde" };
  if (when <= nowLocal) return { field: "when", message: "Elige una hora que no haya pasado" };
  return null;
}

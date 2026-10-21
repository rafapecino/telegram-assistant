// Cada categoría tiene siempre el mismo color en barras, etiquetas y chat (--category-1 a --category-8 en
// styles.css). La paleta está validada para daltonismo en el orden de abajo, y el color acompaña siempre al nombre
// de la categoría: nunca es la única pista. "Otros" y cualquier categoría desconocida van en gris.

const CATEGORY_SLOTS = new Map<string, number>([
  ["Supermercado", 1],
  ["Restaurantes", 2],
  ["Transporte", 3],
  ["Hogar", 4],
  ["Suscripciones", 5],
  ["Ocio", 6],
  ["Salud", 7],
  ["Compras", 8],
]);

/** Clase CSS que fija --category-color para la categoría. */
export function categoryColorClass(category: string): string {
  const slot = CATEGORY_SLOTS.get(category);
  return slot ? `category-${slot}` : "category-other";
}

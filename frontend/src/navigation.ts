/** La URL identifica la sección sin incluir datos del panel. */
export const SECTION_ROUTES = {
  overview: 'inicio', finances: 'finanzas', reminders: 'recordatorios',
  shopping_items: 'compra', deliveries: 'pedidos', birthdays: 'cumpleanos', habits: 'habitos',
  weight: 'peso', calendar: 'agenda', weather: 'tiempo', memory: 'memoria',
  notes: 'notas', settings: 'ajustes', news: 'noticias', markets: 'mercados', prices: 'precios',
} as const;
export type Section = keyof typeof SECTION_ROUTES;

export function sectionFromSearch(search: string): Section {
  const route = new URLSearchParams(search).get('section');
  return (Object.keys(SECTION_ROUTES) as Section[]).find(section => SECTION_ROUTES[section] === route) ?? 'overview';
}

export function sectionSearch(search: string, section: Section): string {
  const params = new URLSearchParams(search);
  params.set('section', SECTION_ROUTES[section]);
  return `?${params.toString()}`;
}

/** La URL explícita gana; la app instalada abre / y recupera solo el nombre de sección. */
export const LAST_SECTION_KEY = 'assistant.panel.last-section.v1';
export function initialSection(search: string, saved: string | null): Section {
  if (new URLSearchParams(search).has('section')) return sectionFromSearch(search);
  return saved && Object.hasOwn(SECTION_ROUTES, saved) ? saved as Section : 'overview';
}
export function readLastSection(): string | null {
  try { return window.localStorage.getItem(LAST_SECTION_KEY); } catch { return null; }
}
export function rememberSection(section: Section): void {
  try { window.localStorage.setItem(LAST_SECTION_KEY, section); } catch { /* Navegación disponible sin almacenamiento. */ }
}

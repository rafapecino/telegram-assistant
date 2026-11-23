// Fondo del saludo del Inicio: el cielo de CloudSky cambia de color según la hora de Madrid.
export type SkyPhase = 'day' | 'afternoon' | 'night';

const madridHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Madrid'}).format(now));

/** Día de 7:00 a 17:00, tarde de 17:00 a 20:00 y noche el resto, en hora de Madrid. */
export function skyPhase(now: Date): SkyPhase {
  const hour = madridHour(now);
  if (hour >= 7 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'afternoon';
  return 'night';
}

// background es el cenit, baseColor el horizonte y accentColor las nubes. Un brillo con alfa 00 apaga el sol.
export const SKY_PRESETS: Record<SkyPhase, Record<string, unknown>> = {
  day: {background: '#2F7FE0', baseColor: '#A9CDF2', accentColor: '#FFFFFF', density: 100, sun: {x: 88, y: 95, glow: '#FFFFFF'}, clouds: {cirrus: 100, shadow: 70, softness: 200}},
  afternoon: {background: '#34407F', baseColor: '#F2A35E', accentColor: '#FFE1C7', density: 90, sun: {x: 80, y: 12, glow: '#FFB070'}, clouds: {cirrus: 80, shadow: 90, softness: 200}},
  night: {background: '#060A1C', baseColor: '#1B2546', accentColor: '#59637F', density: 70, sun: {x: 88, y: 90, glow: '#00000000'}, clouds: {cirrus: 40, shadow: 120, softness: 200}},
};

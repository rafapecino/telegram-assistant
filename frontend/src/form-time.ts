/** Hora de Madrid, independiente de la zona horaria del dispositivo. */
export function madridNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`};
}

export function nextHourInMadrid(now = new Date()) {
  return madridNow(new Date(Math.ceil((now.getTime() + 60_000) / 3_600_000) * 3_600_000));
}

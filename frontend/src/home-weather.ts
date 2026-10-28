export function homeWeatherPlace(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 4 ? 'Stratesys' : 'Villanueva de la Cañada';
}

export function selectHomeWeather<Day extends {date:string}>(forecasts:{place:string;days:Day[]}[],date:string) {
  const place=homeWeatherPlace(date);
  const forecast=forecasts.find(f=>f.place.toLocaleLowerCase('es').includes(place.toLocaleLowerCase('es')));
  return {place,day:forecast?.days.find(day=>day.date===date)};
}

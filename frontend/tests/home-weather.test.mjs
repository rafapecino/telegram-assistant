import test from 'node:test';
import assert from 'node:assert/strict';
import { homeWeatherPlace, selectHomeWeather } from '../src/home-weather.ts';

test('Stratesys de lunes a jueves y Villanueva de viernes a domingo', () => {
  for(const date of ['2026-10-26','2026-10-27','2026-10-28','2026-10-29'])assert.equal(homeWeatherPlace(date),'Stratesys');
  for(const date of ['2026-10-30','2026-10-31','2026-11-01'])assert.equal(homeWeatherPlace(date),'Villanueva de la Cañada');
});
test('selecciona la ubicación correcta y el día de hoy aunque no sea la primera previsión', () => {
  const forecasts=[{place:'Villanueva de la Cañada',days:[{date:'2026-10-28',max:20}]},{place:'Stratesys',days:[{date:'2026-10-27',max:99},{date:'2026-10-28',max:21}]}];
  assert.deepEqual(selectHomeWeather(forecasts,'2026-10-28'),{place:'Stratesys',day:{date:'2026-10-28',max:21}});
});
test('no sustituye hoy por otro día ni por otra ubicación', () => {
  assert.deepEqual(selectHomeWeather([{place:'Stratesys',days:[{date:'2026-10-29'}]}],'2026-10-28'),{place:'Stratesys',day:undefined});
  assert.deepEqual(selectHomeWeather([{place:'Villanueva de la Cañada',days:[{date:'2026-10-28'}]}],'2026-10-28'),{place:'Stratesys',day:undefined});
});

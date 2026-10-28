import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_ROUTES, sectionFromSearch, sectionSearch, initialSection, readLastSection, rememberSection, LAST_SECTION_KEY } from '../src/navigation.ts';
import { nextHourInMadrid } from '../src/form-time.ts';

test('cada sección conserva su destino al abrir o recargar el enlace', () => {
  for (const section of Object.keys(SECTION_ROUTES)) {
    assert.equal(sectionFromSearch(sectionSearch('', section)), section);
  }
});
test('una URL desconocida abre Inicio y se conservan otros parámetros', () => {
  assert.equal(sectionFromSearch('?section=desconocida'), 'overview');
  assert.equal(sectionFromSearch(''), 'overview');
  const search = sectionSearch('?source=bookmark&section=agenda', 'reminders');
  assert.equal(new URLSearchParams(search).get('source'), 'bookmark');
  assert.equal(sectionFromSearch(search), 'reminders');
});
test('propone la próxima hora, con la fecha correcta al pasar medianoche', () => {
  assert.deepEqual(nextHourInMadrid(new Date('2026-10-28T13:15:00Z')), {date:'2026-10-28',time:'15:00'});
  assert.deepEqual(nextHourInMadrid(new Date('2026-10-28T22:30:00Z')), {date:'2026-10-29',time:'00:00'});
});
test('la próxima hora respeta el cambio de horario de Madrid', () => {
  assert.deepEqual(nextHourInMadrid(new Date('2026-03-29T00:30:00Z')), {date:'2026-03-29',time:'03:00'});
  assert.deepEqual(nextHourInMadrid(new Date('2026-10-25T00:30:00Z')), {date:'2026-10-25',time:'02:00'});
});

test('la app instalada recupera la última sección y los enlaces explícitos ganan', () => {
  assert.equal(initialSection('', 'calendar'), 'calendar');
  assert.equal(initialSection('?section=recordatorios', 'calendar'), 'reminders');
  assert.equal(initialSection('?section=inicio', 'calendar'), 'overview');
  assert.equal(initialSection('?section=incorrecta', 'calendar'), 'overview');
  assert.equal(initialSection('', 'incorrecta'), 'overview');
  assert.equal(initialSection('', '__proto__'), 'overview');
  assert.equal(initialSection('', null), 'overview');
});
test('la navegación funciona aunque el dispositivo bloquee el almacenamiento', () => {
  globalThis.window = {get localStorage(){throw new Error('Storage unavailable')}};
  assert.equal(readLastSection(), null);
  assert.doesNotThrow(() => rememberSection('calendar'));
  delete globalThis.window;
});
test('solo se guarda el identificador de sección', () => {
  const saved = new Map();
  globalThis.window = {localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)}};
  rememberSection('calendar');
  assert.equal(readLastSection(), 'calendar');
  assert.deepEqual([...saved], [[LAST_SECTION_KEY, 'calendar']]);
  delete globalThis.window;
});

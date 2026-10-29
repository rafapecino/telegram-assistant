import test from 'node:test';
import assert from 'node:assert/strict';
import {contextualGreeting} from '../src/greetings.ts';
const at=date=>new Date(date+'T12:00:00Z');
test('fechas especiales y cumpleaños tienen prioridad',()=>{
 assert.match(contextualGreeting([],at('2026-10-31')),/Halloween/);
 assert.match(contextualGreeting([],at('2026-12-25')),/Navidad/);
 assert.match(contextualGreeting([{name:'Persona de prueba',day:31,month:10}],at('2026-10-31')),/recuerda felicitar a Persona de prueba/);
});
test('usa Madrid incluso antes de medianoche UTC y omite otros cumpleaños',()=>{
 assert.match(contextualGreeting([{name:'Ejemplo',day:1,month:11}],new Date('2026-10-31T23:30:00Z')),/felicitar a Ejemplo/);
 assert.doesNotMatch(contextualGreeting([{name:'Ejemplo',day:2,month:11}],at('2026-11-01')),/Ejemplo/);
});
test('agrupa nombres sin repetir y limita el saludo',()=>{
 const people=['A','A','B','C'].map(name=>({name,day:29,month:10}));
 assert.match(contextualGreeting(people,at('2026-10-29')),/A, B y 1 persona más/);
 assert.equal(contextualGreeting([],at('2026-10-29')),contextualGreeting([],at('2026-10-29')));
});

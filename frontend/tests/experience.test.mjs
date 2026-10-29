import test from 'node:test';
import assert from 'node:assert/strict';
import {financeSummary,dayFocus,isDraftCandidate} from '../src/experience.ts';
test('compara el mismo tramo del mes y excluye días futuros',()=>{
 const result=financeSummary([{booking_date:'2026-10-01',amount:20,description:'A'},{booking_date:'2026-10-30',amount:500,description:'Futuro'},{booking_date:'2026-09-01',amount:40,description:'A'},{booking_date:'2026-09-30',amount:800,description:'Fuera de tramo'}],'2026-10-29');
 assert.equal(result.spent,20);assert.equal(result.before,40);assert.equal(result.percent,-50);
});
test('no divide entre cero y ajusta el final de febrero',()=>{
 const result=financeSummary([{booking_date:'2026-02-28',amount:12,description:'A'}],'2026-03-31');
 assert.equal(result.previousEnd,'2026-02-28');assert.equal(result.before,12);
 assert.equal(financeSummary([],'2026-10-29').percent,null);
});
test('detecta un patrón mensual estable sin confundir compras frecuentes o aisladas',()=>{
 const monthly=['2026-08-10','2026-09-10','2026-10-10'].map(booking_date=>({booking_date,amount:10,description:'Servicio mensual'}));
 assert.equal(financeSummary(monthly,'2026-10-29').recurring.length,1);
 assert.equal(financeSummary(monthly.slice(0,2),'2026-10-29').recurring.length,0);
 assert.equal(financeSummary(monthly.map((r,i)=>({...r,amount:i===2?80:10})),'2026-10-29').recurring.length,0);
 assert.equal(financeSummary(['2026-10-01','2026-10-03','2026-10-05'].map(booking_date=>({booking_date,amount:10,description:'Supermercado'})),'2026-10-29').recurring.length,0);
});
test('por la tarde prepara mañana solo si ya no quedan asuntos hoy',()=>{
 const now=new Date('2026-10-29T19:00:00Z');
 assert.equal(dayFocus({},now).date,'2026-10-30');
 assert.equal(dayFocus({reminders:[{text:'Pendiente',remind_at:'2026-10-29T08:00:00Z'}]},now).isTomorrow,false);
 assert.equal(dayFocus({habits:[{id:1,scheduled_days:[4]}]},now).isTomorrow,false);
 assert.equal(dayFocus({habits:[{id:1,scheduled_days:[4]}],habit_checks:[{habit_id:1,date:'2026-10-29',done:true}]},now).isTomorrow,true);
 assert.equal(dayFocus({},new Date('2026-10-29T10:00:00Z')).isTomorrow,false);
});
test('ordena lo próximo y cuenta los recordatorios vencidos',()=>{
 const result=dayFocus({reminders:[{text:'Antes',remind_at:'2026-10-29T08:00:00Z'},{text:'Luego',remind_at:'2026-10-29T14:00:00Z'}],calendar:{events:[{title:'Primero',start:'2026-10-29T12:00:00Z'}]}},new Date('2026-10-29T10:00:00Z'));
 assert.equal(result.next.text,'Primero');assert.equal(result.overdue,1);
});

test('las consultas y confirmaciones no necesitan otra interpretación',()=>{
 for(const message of ['Sí','no','hecho','¿Qué tiempo hace?','¿Cuánto he gastado?','Hola'])assert.equal(isDraftCandidate(message),false);
 for(const message of ['añade un gasto','apunta tabaco 5,50','recuérdame llamar mañana','toma nota de esta idea','quiero un evento mañana'])assert.equal(isDraftCandidate(message),true);
});

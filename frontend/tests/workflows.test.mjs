import test from 'node:test';
import assert from 'node:assert/strict';
import {expenseCapture,correctCapture,duplicateCandidates,normalizeMerchant} from '../../supabase/functions/_shared/workflow-logic.ts';
const today='2026-10-29';
test('captura alias, importe ausente y correcciones sin inventar escrituras',()=>{
 const energy=expenseCapture('añade un yeti',today);assert.equal(energy.amount,1.2);assert.match(energy.description,/x1/);
 const two=correctCapture(energy,'eran dos');assert.equal(two.amount,2.4);assert.equal(correctCapture(energy,'eran 2').amount,2.4);assert.equal(correctCapture(energy,'eran 2,50').amount,2.5);assert.match(two.description,/x2/);
 assert.equal(correctCapture(two,'total 2,50').amount,2.5);
 assert.equal(correctCapture(two,'en tarjeta').payment_method,'card');
 assert.equal(expenseCapture('apunta tabaco',today).amount,undefined);
 assert.equal(correctCapture(expenseCapture('apunta tabaco',today),'6.70').amount,6.7);
 assert.equal(expenseCapture('qué tiempo hará mañana',today),null);
 assert.equal(expenseCapture('añade leche a la compra',today),null);
 assert.equal(expenseCapture('apunta tabaco ayer',today),null);
});
test('normalización conserva números: una regla no mezcla comercios distintos',()=>{
 assert.equal(normalizeMerchant(' CAFÉ   24 '),'cafe 24');assert.notEqual(normalizeMerchant('TIENDA 24'),normalizeMerchant('TIENDA 25'));
});
const manual={id:1,account_uid:'manual',booking_date:today,amount:6.7,currency:'EUR',description:'Tabaco',payment_method:'card',duplicate_of:null};
const bank={...manual,id:2,account_uid:'bank',description:'Estanco'};
test('duplicados son candidatos, excluyen efectivo, divisas, fechas y decisiones anteriores',()=>{
 assert.equal(duplicateCandidates([manual,bank]).length,1);
 for(const change of [{payment_method:'cash'},{amount:6.71},{currency:'USD'},{booking_date:'2026-10-01'}])assert.equal(duplicateCandidates([{...manual,...change},bank]).length,0);
 assert.equal(duplicateCandidates([manual,bank],[{manual_id:1,bank_id:2}]).length,0);
 assert.equal(duplicateCandidates([{...manual,duplicate_of:2},bank,{...manual,id:3}]).length,0);
 assert.equal(manual.duplicate_of,null);
});

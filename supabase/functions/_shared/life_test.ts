import {assertEquals,assertThrows,assertStringIncludes} from 'jsr:@std/assert@1.0.19';
import {parseLifeInput,weekStart,consumptionProgress,deliveryNotices,lifeWrite,sendLifeWeeklyReview} from './life.ts';
import {fakeDb,withTelegram} from './testing.ts';
Deno.test('tareas y deudas validan fecha, importe, dirección y conservan precisión',()=>{
 assertEquals(parseLifeInput('tasks',{text:' Llamar al banco '},'2026-10-29'),{text:'Llamar al banco',scheduled_on:'2026-10-29'});
 assertThrows(()=>parseLifeInput('debts',{person:'A',amount:12.001,direction:'receivable'},'2026-10-29'));
 assertThrows(()=>parseLifeInput('debts',{person:'A',amount:-12,direction:'receivable'},'2026-10-29'));
 assertThrows(()=>parseLifeInput('debts',{person:'A',amount:12,direction:'wrong'},'2026-10-29'));
 assertThrows(()=>parseLifeInput('tasks',{text:'A',scheduled_on:'2026-02-30'},'2026-10-29'));
 assertThrows(()=>parseLifeInput('consumption_goals',{item:'energy',weekly_limit:1.5},'2026-10-29'));
});
Deno.test('semana lunes-domingo y objetivos no infieren latas de cualquier pago pequeño',()=>{
 assertEquals(weekStart('2026-11-01'),'2026-10-26');
 const [g]=consumptionProgress([{item:'energy',weekly_limit:3}],[{description:'ENERGÉTICA x2 (apuntado a mano)',amount:3,booking_date:'2026-10-29'},{description:'Compra cualquiera',amount:1.2,booking_date:'2026-10-29'}],'2026-10-29');
 assertEquals(g.used,2);assertEquals(g.spent_month,3);
});
const email=(subject:string,date='2026-10-29T10:00:00Z',from='Tienda')=>({subject,date:new Date(date),from});
Deno.test('paquetes: no oculta otro pedido, no reutiliza ayer como hoy y no confunde no entregado',()=>{
 const result=deliveryNotices([email('Pedido 123456 en reparto'),email('Pedido 123456 entregado','2026-10-29T11:00:00Z'),email('Pedido 999999 llega hoy'),email('Tu paquete llega hoy','2026-10-28T10:00:00Z'),email('Pedido 888888 no entregado')],'2026-10-29');
 assertEquals(result.length,1);assertEquals(result[0].reference,'999999');
 assertEquals(deliveryNotices([email('Pedido 123456 en reparto'),email('Pedido 123456 entregado','2026-10-29T11:00:00Z','Otra tienda')],'2026-10-29').length,1);
});
Deno.test('escrituras rechazan estados inválidos antes de tocar la base de datos',async()=>{
 const {db,queries}=fakeDb(()=>({data:{id:1}}));
 let rejected=false;try{await lifeWrite(db,'task_status',{id:1,done:'sí'},'2026-10-29')}catch{rejected=true};assertEquals(rejected,true);assertEquals(queries.length,0);
 await lifeWrite(db,'task_status',{id:1,done:false},'2026-10-29');assertStringIncludes(queries[0].join(' '),'"completed_at":null');
});
Deno.test('repaso ya reclamado no vuelve a enviar Telegram',async()=>{
 const {db}=fakeDb(()=>({data:[],error:null}));
 await withTelegram(async requests=>{await sendLifeWeeklyReview(db,new Date('2026-11-01T19:00:00Z'));assertEquals(requests.length,0)});
});
Deno.test('repaso tolera un origen caído sin inventar ceros ni perder otros bloques',async()=>{
 const {weeklyReview}=await import('./life.ts');
 const {db}=fakeDb(q=>q[0]==='from("expenses")'?{data:null,error:new Error('Origen no disponible')}:{data:[],error:null});
 const text=await weeklyReview(db,new Date('2026-11-01T19:00:00Z'));
 assertStringIncludes(text,'Gastos: no disponibles');assertStringIncludes(text,'Hábitos: 0 cumplidos');assertStringIncludes(text,'Cumpleaños próximos');assertStringIncludes(text,'Bajadas de precio');
});

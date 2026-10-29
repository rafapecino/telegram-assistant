import {assertEquals,assertThrows} from 'jsr:@std/assert@1';
import {fakeDb} from './testing.ts';
import {startCapture,captureButton,parseQuickCapture,replyToWorkflow} from './workflows.ts';
import {parseLifeInput,lifeWrite} from './life.ts';
import {parseManualEntry} from './manual-entries.ts';
const now=new Date('2026-10-29T12:00:00Z'),values={description:'TABACO',date:'2026-10-29',category:'Otros',payment_method:'unknown' as const};
Deno.test('propuesta incompleta no escribe gastos ni confirma con importe vacío',async()=>{
 const {db,queries}=fakeDb(q=>({data:{id:'00000000-0000-4000-8000-000000000001',version:1,values,status:'pending',expires_at:'2026-10-29T13:00:00Z'},error:null}));
 const reply=await startCapture(db,values,'panel',now);assertEquals(reply.text.includes('Falta el importe'),true);assertEquals(queries.some(q=>q[0]==='from("expenses")'),false);
 assertEquals(reply.buttons?.flat().some(b=>b.text==='Confirmar'),false);
});
Deno.test('confirmación caducada y versión antigua nunca escriben',async()=>{
 for(const change of [{expires_at:'2026-10-29T11:00:00Z'},{version:2}]){
 const {db,queries}=fakeDb(()=>({data:{id:'00000000-0000-4000-8000-000000000001',version:1,values:{...values,amount:6.7},status:'pending',expires_at:'2026-10-29T13:00:00Z',...change},error:null}));
 await captureButton(db,'cap:00000000-0000-4000-8000-000000000001:1:ok','panel',now);assertEquals(queries.some(q=>q[0].startsWith('rpc')),false);
 }
});
Deno.test('confirmar dos veces devuelve ya guardado sin otra escritura',async()=>{
 const {db,queries}=fakeDb(()=>({data:{status:'saved'},error:null}));await captureButton(db,'cap:00000000-0000-4000-8000-000000000001:1:ok','panel',now);assertEquals(queries.length,1);
});
Deno.test('confirmación no informa éxito cuando falla la transacción',async()=>{
 const {db}=fakeDb(q=>q[0].startsWith('rpc')?{data:null,error:new Error('Fallo de DB')}:{data:{id:'00000000-0000-4000-8000-000000000001',version:1,values:{...values,amount:6.7},status:'pending',expires_at:'2026-10-29T13:00:00Z'},error:null});
 let failed=false;try{await captureButton(db,'cap:00000000-0000-4000-8000-000000000001:1:ok','panel',now)}catch{failed=true}assertEquals(failed,true);
});
Deno.test('favoritos restringen recursos y nunca conservan ids ni fechas obsoletas',()=>{
 assertThrows(()=>parseQuickCapture({label:'X',resource:'calendar',values:{}}));
 assertEquals(parseQuickCapture({label:'Café',resource:'expenses',values:{description:'Café',date:'2020-01-01',request_key:'bad',amount:2}}).values,{description:'Café',amount:2});
});
Deno.test('planificar conserva plazo al mover día; fechas y duración inválidas no escriben',async()=>{
 const parsed=parseLifeInput('tasks',{text:'Paquete',scheduled_on:'2026-10-30',due_on:'2026-11-01',duration_minutes:20},'2026-10-29');assertEquals(parsed.due_on,'2026-11-01');
 assertThrows(()=>parseLifeInput('tasks',{text:'X',scheduled_on:'2026-10-30',duration_minutes:2},'2026-10-29'));
 const {db,queries}=fakeDb(q=>q.some(s=>s.startsWith('update'))?{data:{id:1},error:null}:{data:{id:1,text:'Paquete',scheduled_on:'2026-10-29',due_on:'2026-11-01',duration_minutes:20},error:null});
 await lifeWrite(db,'task_plan',{id:1,scheduled_on:'2026-10-30'},'2026-10-29');assertEquals(queries[1].some(s=>s.includes('"due_on":"2026-11-01"')),true);
});
Deno.test('gastos validan fechas reales y métodos de pago',()=>{
 assertThrows(()=>parseManualEntry({...values,amount:2,date:'2026-02-31'},'expense','2026-10-29'));
 assertThrows(()=>parseManualEntry({...values,amount:2,payment_method:'bitcoin'},'expense','2026-10-29'));
});

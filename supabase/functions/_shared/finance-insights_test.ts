import {assertEquals} from 'jsr:@std/assert@1.0.19';
import {fakeDb} from './testing.ts';
import {loadFinanceInsightExpenses} from './finance-insights.ts';
function sample(total:number,cap=500){return fakeDb(query=>{const range=query.find(q=>q.startsWith('range('))!;const offset=Number(range.match(/range\((\d+)/)![1]);return {count:total,data:Array.from({length:Math.min(cap,Math.max(0,total-offset))},(_,i)=>({id:offset+i}))}})}
Deno.test('pagina el historial con orden estable sin omitir la segunda página',async()=>{
 const {db,queries}=sample(700);const result=await loadFinanceInsightExpenses(db,'2026-10-29');
 assertEquals(result.expenses.length,700);assertEquals(result.truncated,false);assertEquals(queries.length,2);
 assertEquals(queries[0].includes('order("id", {"ascending":false})'),true);
 assertEquals(queries[0].includes('lte("booking_date", "2026-10-29")'),true);
});
Deno.test('avisa si se supera el límite local o si el servidor reduce las filas',async()=>{
 assertEquals((await loadFinanceInsightExpenses(sample(3000).db,'2026-10-29')).truncated,true);
 const capped=await loadFinanceInsightExpenses(sample(700,100).db,'2026-10-29');
 assertEquals(capped.expenses.length,100);assertEquals(capped.truncated,true);
});

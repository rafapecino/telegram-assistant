import {assertEquals} from 'jsr:@std/assert@1.0.19';
import {parsePanelDraft} from './panel-drafts.ts';
Deno.test('solo admite recursos de creación conocidos y campos permitidos',()=>{
 assertEquals(parsePanelDraft({resource:'personal_data',values:{confirm:'BORRAR'}}),null);
 assertEquals(parsePanelDraft({resource:'__proto__',values:{text:'x'}}),null);
 assertEquals(parsePanelDraft({resource:'notes',values:{text:'Nota',id:42,user_id:'otra cuenta'}}),{resource:'notes',values:{text:'Nota'}});
});
Deno.test('elimina valores no finitos y objetos arbitrarios',()=>{
 assertEquals(parsePanelDraft({resource:'expenses',values:{amount:Infinity,description:{bad:true}}}),null);
 assertEquals(parsePanelDraft({resource:null}),null);
 assertEquals(parsePanelDraft({resource:'notes',values:[]}),null);
});
Deno.test('recorta los textos y permite completar importes ausentes en el editor',()=>{
 const draft=parsePanelDraft({resource:'expenses',values:{description:'x'.repeat(300),amount:''}});
 assertEquals(draft?.values.description,'x'.repeat(200));assertEquals(draft?.values.amount,'');
});

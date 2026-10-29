import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const project=fileURLToPath(new URL('..',import.meta.url));
await mkdir(`${project}/node_modules/.cache/qa`,{recursive:true});
await build({entryPoints:[`${project}/src/ExperiencePanels.tsx`],outfile:`${project}/node_modules/.cache/qa/experience.mjs`,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid',pretendToBeVisual:true});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLDialogElement','Event','MouseEvent','FormData'])globalThis[k]=dom.window[k];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;window.scrollTo=()=>{};HTMLElement.prototype.scrollIntoView=()=>{};
HTMLDialogElement.prototype.showModal=function(){this.open=true;};
const {createRoot}=await import(`${project}/node_modules/react-dom/client.js`);
const {act,createElement:h}=await import(`${project}/node_modules/react/index.js`);
const {NotesPanel,ProposalEditor,DataFreshness,useUndoQueue,UndoTray,FinanceInsights}=await import(`${project}/node_modules/.cache/qa/experience.mjs`);
let root=createRoot(document.getElementById('root'));const tick=()=>new Promise(r=>setTimeout(r,25));
async function render(component,props){await act(async()=>{root.render(h(component,props));await tick()});await act(tick)}
async function input(el,value){await act(async()=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));await tick()})}
async function click(el){assert.ok(el,'control visible');await act(async()=>{el.click();await tick()})}
async function submit(form){await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick()});await act(tick)}
async function clear(){await act(async()=>root.unmount());root=createRoot(document.getElementById('root'))}
const writes=[];let notes=[{id:1,text:'Idea de prueba',created_at:'2026-10-29T10:00:00Z'}];
const api=async(resource,method='GET',data)=>{if(method!=='GET'){writes.push({resource,method,data});if(resource==='notes'&&method==='POST'){if(data.id)notes=notes.map(n=>n.id===data.id?{...n,text:data.text}:n);else notes.push({id:2,text:data.text,created_at:'2026-10-29T10:00:00Z'})}}return resource==='notes'?notes:{expenses:[],truncated:false}};
await render(NotesPanel,{api});assert.equal(document.querySelectorAll('.saved-note').length,1);
await input(document.getElementById('quick-note'),'Otra idea de prueba');await submit(document.querySelector('.notes-composer form'));assert.equal(writes.at(-1).data.text,'Otra idea de prueba');assert.equal(document.getElementById('quick-note').value,'');
await input(document.getElementById('notes-search'),'Otra');assert.equal(document.querySelectorAll('.saved-note').length,1);
await click(document.querySelector('[aria-label="Editar nota"]'));await input(document.getElementById('quick-note'),'Otra idea corregida');await submit(document.querySelector('.notes-composer form'));assert.equal(writes.at(-1).data.id,2);
await click(document.querySelector('[aria-label="Eliminar nota"]'));assert.equal(document.querySelectorAll('.saved-note').length,0);await click(document.querySelector('.undo-toast button'));assert.equal(document.querySelectorAll('.saved-note').length,1);assert.equal(writes.filter(w=>w.method==='DELETE').length,0);
console.log('PASS: notas, búsqueda, edición y Deshacer sin borrar');await clear();
const start=writes.length;let closed=false,saved=false;
await render(ProposalEditor,{draft:{resource:'expenses',values:{description:'Café de prueba',amount:2.4,date:'2026-10-29',category:'Otros'}},api,onClose:()=>{closed=true},onSaved:async()=>{saved=true}});assert.equal(writes.length,start);assert.equal(document.activeElement.name,'description');await input(document.querySelector('input[name=description]'),'Café corregido');await submit(document.querySelector('dialog form'));assert.equal(writes.at(-1).data.amount,2.4);assert.equal(writes.at(-1).data.description,'Café corregido');assert.equal(saved,true);assert.equal(closed,true);
console.log('PASS: propuesta editable sin escritura hasta confirmar');await clear();
await render(DataFreshness,{updatedAt:Date.now()-20*60000,loading:false,problem:false,onRefresh:()=>{}});assert.ok(document.querySelector('.freshness.is-stale'));console.log('PASS: estado de datos antiguos');await clear();
await render(FinanceInsights,{api});assert.ok(document.querySelector('.insight-comparison'));assert.match(document.querySelector('.insight-change').textContent,/Sin base/);console.log('PASS: comparativa sin división entre cero');await clear();
let hook,committed=0;function QueueTest(){hook=useUndoQueue(message=>{throw new Error(message)});return h(UndoTray,{queue:hook})}
await render(QueueTest,{});await act(async()=>{hook.schedule('cancel','Cancelar',async()=>{committed+=100});hook.schedule('commit','Confirmar',async()=>{committed++})});await act(async()=>hook.cancel('cancel'));assert.equal(committed,0);await act(async()=>new Promise(r=>setTimeout(r,8200)));assert.equal(committed,1);assert.equal(hook.pending.length,0);console.log('PASS: la cola espera 8 segundos y no ejecuta lo deshecho');await clear();await act(async()=>root.unmount());dom.window.close();

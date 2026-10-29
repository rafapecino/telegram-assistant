import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const project=fileURLToPath(new URL('..',import.meta.url));
await mkdir(`${project}/node_modules/.cache/qa`,{recursive:true});
await build({entryPoints:[`${project}/src/WorkflowPanels.tsx`],outfile:`${project}/node_modules/.cache/qa/workflows.mjs`,bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid',pretendToBeVisual:true});
for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLDialogElement','Event','MouseEvent','FormData'])globalThis[k]=dom.window[k];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;window.scrollTo=()=>{};HTMLElement.prototype.scrollIntoView=()=>{};
HTMLDialogElement.prototype.showModal=function(){this.open=true;};
const {createRoot}=await import(`${project}/node_modules/react-dom/client.js`);
const {act,createElement:h}=await import(`${project}/node_modules/react/index.js`);
const {QuickCaptures,TaskPlanner,CategoryEditor,ExpenseReviewDisclosure}=await import(`${project}/node_modules/.cache/qa/workflows.mjs`);
let root=createRoot(document.getElementById('root'));const tick=()=>new Promise(r=>setTimeout(r,25));
async function render(component,props){await act(async()=>{root.render(h(component,props));await tick()});await act(tick)}
async function input(el,value){await act(async()=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));await tick()})}
async function click(el){assert.ok(el,'control visible');await act(async()=>{el.click();await tick()})}
async function submit(form){await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick()});await act(tick)}
async function clear(){await act(async()=>root.unmount());root=createRoot(document.getElementById('root'))}
const writes=[];let fail=false;const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date());
let tasks=[{id:1,text:'Devolver paquete',scheduled_on:date,due_on:'2026-11-10',duration_minutes:20,completed_at:null}];
let favorites=[{id:1,label:'Energética',resource:'expenses',values:{description:'ENERGÉTICA x1',amount:1.2,category:'Otros',payment_method:'card'}}];
const api=async(resource,method='GET',data)=>{if(method==='POST'){writes.push({resource,data});if(fail)throw new Error('Fallo simulado');if(resource==='task_plan')tasks=tasks.map(t=>({...t,...data}));if(resource==='task_status')tasks=tasks.map(t=>({...t,completed_at:data.done?'now':null}));}
if(resource==='life')return {tasks};if(resource==='quick_captures')return favorites;if(resource==='expense_review')return {candidates:[],linked:[{id:1,description:'Café',amount:2,booking_date:date,duplicate_of:2}],rules:[]};return {ok:true};};
await render(QuickCaptures,{api,onSaved:async()=>{}});await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Energética'));assert.equal(writes.length,0);assert.ok(document.querySelector('dialog'));assert.equal(document.querySelector('[name=payment_method]').value,'card');
fail=true;await submit(document.querySelector('dialog form'));assert.match(document.querySelector('[role=alert]').textContent,/Fallo simulado/);const key=writes.at(-1).data.request_key;assert.ok(key);assert.equal(document.querySelector('[name=amount]').value,'1.2');fail=false;await submit(document.querySelector('dialog form'));assert.equal(writes.at(-1).data.request_key,key);console.log('PASS: favorito prepara sin escribir, conserva pago y reintenta con la misma identidad');await clear();
await render(TaskPlanner,{api,onChanged:async()=>{}});await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Planificar'));const plan=document.querySelector('.task-plan-form');await input(plan.querySelector('[name=scheduled_on]'),'2026-11-02');await submit(plan);assert.equal(writes.at(-1).data.due_on,'2026-11-10');assert.equal(writes.at(-1).data.scheduled_on,'2026-11-02');assert.equal(writes.at(-1).data.duration_minutes,20);console.log('PASS: mover tarea conserva plazo y duración');await clear();
await render(CategoryEditor,{row:{id:2,description:'Café',category:'Otros'},api,onSaved:async()=>{},onClose:()=>{}});await click(document.querySelector('[name=always]'));await submit(document.querySelector('form'));assert.equal(writes.at(-1).resource,'expense_category');assert.equal(writes.at(-1).data.always,true);console.log('PASS: corrección distingue este gasto y regla futura');await clear();
await render(ExpenseReviewDisclosure,{api,onChanged:async()=>{}});assert.equal(document.querySelector('.expense-review'),null);await act(async()=>{const details=document.querySelector('details');details.open=true;details.dispatchEvent(new Event('toggle'));await tick()});await act(tick);assert.match(document.body.textContent,/Sin coincidencias pendientes/);await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Deshacer vínculo'));assert.equal(writes.at(-1).data.decision,'unlink');console.log('PASS: revisión carga al desplegar y permite deshacer vínculos');await clear();
await act(async()=>root.unmount());dom.window.close();

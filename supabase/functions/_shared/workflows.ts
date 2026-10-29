import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { UserFacingError } from './errors.ts';
import { parseManualEntry } from './manual-entries.ts';
import { madridClock, addDaysToDate } from './madrid-time.ts';
import { CATEGORIES, normalizeMerchant, expenseCapture, correctCapture, duplicateCandidates, type CaptureValues } from './workflow-logic.ts';
import type { BotReply } from './telegram.ts';
export type Channel='panel'|'telegram';
const euro=(v:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(v);
const id=(v:unknown)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new UserFacingError('Identificador no válido.');return n;};
function check(r:{error:any}){if(r.error)throw r.error;}
export async function listQuickCaptures(db:SupabaseClient){const r=await db.from('quick_captures').select('*').order('id').limit(30);check(r);return r.data??[];}
export function parseQuickCapture(input:Record<string,unknown>){
 const label=typeof input.label==='string'?input.label.trim():'';if(!label||label.length>60)throw new UserFacingError('Pon un nombre de hasta 60 caracteres.');
 const resource=String(input.resource);if(!['expenses','tasks','notes'].includes(resource))throw new UserFacingError('Tipo de favorito no válido.');
 const v=input.values;if(!v||typeof v!=='object'||Array.isArray(v))throw new UserFacingError('Favorito no válido.');
 const allowed=resource==='expenses'?['description','amount','category','payment_method']:['text',...(resource==='tasks'?['duration_minutes','period']:[])];
 const values:Record<string,unknown>={};for(const k of allowed){const value=(v as Record<string,unknown>)[k];if(typeof value==='string')values[k]=value.slice(0,300);else if(typeof value==='number'&&Number.isFinite(value))values[k]=value;}
 if(values.amount!==undefined&&(Number(values.amount)<=0||Number(values.amount)>100000))throw new UserFacingError('Importe no válido.');
 if(resource==='expenses'){if(!CATEGORIES.includes(String(values.category??'Otros')))throw new UserFacingError('Categoría no válida.');if(!['cash','card','unknown'].includes(String(values.payment_method??'unknown')))throw new UserFacingError('Método no válido.');}
 return {label,resource,values};
}
export async function writeQuickCapture(db:SupabaseClient,input:Record<string,unknown>){
 if(input.remove===true){check(await db.from('quick_captures').delete().eq('id',id(input.id)));return {ok:true};}
 const value=parseQuickCapture(input);
 if(input.id){const r=await db.from('quick_captures').update(value).eq('id',id(input.id)).select('id').single();check(r);}
 else {const existing=await listQuickCaptures(db);if(existing.length>=30)throw new UserFacingError('Puedes guardar hasta 30 favoritos.');check(await db.from('quick_captures').insert(value));}
 return {ok:true};
}
export async function quickDraft(db:SupabaseClient,rawId:unknown,today:string){
 const r=await db.from('quick_captures').select('*').eq('id',id(rawId)).single();check(r);const f=r.data;
 const values={...f.values};if(f.resource==='expenses')values.date=today;
 if(f.resource==='tasks'){values.scheduled_on=values.period==='week'?addDaysToDate(today,6-(new Date(today+'T12:00:00Z').getUTCDay()+6)%7):today;delete values.period;}
 return {resource:f.resource,values};
}
function captureReply(op:any):BotReply {
 const v=op.values as CaptureValues;
 if(op.values._resource){const value=op.values;return {text:`${value._resource==='tasks'?'Tarea':'Nota'} pendiente: ${value.text||'Falta el texto'}${value.scheduled_on?' · '+value.scheduled_on:''}. Para completar o corregir, escribe «texto: tu tarea o nota». Después confirma. Caduca en 20 minutos.`,buttons:[...(value.text?[[{text:'Confirmar',callback_data:`cap:${op.id}:${op.version}:ok`}]]:[]),[{text:'Cancelar',callback_data:`cap:${op.id}:${op.version}:no`}]]};}
 return {text:`Gasto pendiente: ${v.description}\n${v.amount?euro(v.amount):'Falta el importe'} · ${v.date} · ${v.payment_method==='cash'?'efectivo':v.payment_method==='card'?'tarjeta':'pago sin especificar'}\n${v.amount?'Confirma para guardarlo.':'Dime el importe total, por ejemplo «6,70». También puedes cancelar.'} Puedes corregir: «eran dos», «total 2,50» o «en tarjeta». Caduca en 20 minutos.`,buttons:[...(v.amount?[[{text:'Confirmar',callback_data:`cap:${op.id}:${op.version}:ok`}]]:[]),[{text:'Corregir',callback_data:`cap:${op.id}:${op.version}:edit`},{text:'Cancelar',callback_data:`cap:${op.id}:${op.version}:no`}]]};
}
export async function startCapture(db:SupabaseClient,values:CaptureValues,channel:Channel,now:Date):Promise<BotReply>{
 parseManualEntry({...values,amount:values.amount??1},'expense',madridClock(now).localDate);
 // Supersede only this channel; a Telegram reply cannot confirm a web proposal.
 check(await db.from('pending_captures').update({status:'cancelled'}).eq('channel',channel).eq('status','pending'));
 const r=await db.from('pending_captures').insert({channel,values,expires_at:new Date(now.getTime()+20*60000).toISOString()}).select('*').single();check(r);return captureReply(r.data);
}
export async function captureButton(db:SupabaseClient,data:string,channel:Channel,now:Date):Promise<BotReply|null>{
 const match=data.match(/^cap:([a-f0-9-]{36}):(\d+):(ok|no|edit)$/);if(!match)return null;
 const r=await db.from('pending_captures').select('*').eq('id',match[1]).eq('channel',channel).single();check(r);const op=r.data;
 if(op.status==='saved')return {text:'Este gasto ya estaba guardado. No se ha duplicado.'};
 if(op.status!=='pending'||Date.parse(op.expires_at)<=now.getTime())return {text:'La propuesta ya no está activa. Vuelve a indicar el gasto.'};
 if(op.version!==Number(match[2]))return captureReply(op);
 if(match[3]==='edit')return {text:'Dime el importe total («total 6,70»), la cantidad («eran dos») o el pago («en efectivo»). No se ha guardado nada.'};
 if(match[3]==='no'){check(await db.from('pending_captures').update({status:'cancelled'}).eq('id',op.id).eq('version',op.version).eq('status','pending'));return {text:'Propuesta cancelada. No se ha guardado el gasto.'};}
 if(!op.values._resource)parseManualEntry(op.values,'expense',madridClock(now).localDate);
 else if(typeof op.values.text!=='string'||!op.values.text.trim()||op.values.text.length>(op.values._resource==='tasks'?300:1000))throw new UserFacingError('Completa primero el texto.');
 const saved=await db.rpc('confirm_personal_capture',{capture_id:op.id,capture_channel:channel,expected_version:op.version});check(saved);
 return {text:saved.data==='already_saved'?'Este gasto ya estaba guardado. No se ha duplicado.':op.values._resource?`${op.values._resource==='tasks'?'Tarea':'Nota'} guardada. Puedes verla en su sección.`:`Guardado en Finanzas: ${op.values.description}, ${euro(op.values.amount)}.`};
}
/** Runs before habits' yes/no matching: explicit pending capture has its own channel and expiry. */
export async function replyToWorkflow(db:SupabaseClient,text:string,channel:Channel,now:Date):Promise<BotReply|null>{
 const today=madridClock(now).localDate,s=normalizeMerchant(text);
 if(s==='/rapido'||s==='captura rapida'){const favorites=await listQuickCaptures(db);return {text:'Captura rápida: elige un favorito para revisarlo antes de guardar. Puedes editarlos en Añadir → Favoritos.',buttons:favorites.map(f=>[{text:f.label,callback_data:`quick:${f.id}`}])};}
 const fresh=expenseCapture(text,today);if(fresh)return startCapture(db,fresh,channel,now);
 const r=await db.from('pending_captures').select('*').eq('channel',channel).eq('status','pending').gt('expires_at',now.toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();check(r);const op=r.data;
 if(!op?.id)return null;
 if(/^(si|confirmar|confirma|confirmo|guardar|vale|ok)[.!]?$/.test(s))return captureButton(db,`cap:${op.id}:${op.version}:ok`,channel,now);
 if(/^(no|cancelar|cancela)[.!]?$/.test(s))return captureButton(db,`cap:${op.id}:${op.version}:no`,channel,now);
 if(op.values._resource&&!/^texto\s*:/i.test(text))return null;
 const values=op.values._resource?{...op.values,text:text.replace(/^texto\s*:/i,'').trim().slice(0,op.values._resource==='tasks'?300:1000)}:correctCapture(op.values,text);if(!values)return null;
 if(values.amount!==undefined&&!op.values._resource)parseManualEntry(values,'expense',today);
 const changed=await db.from('pending_captures').update({values,version:op.version+1,expires_at:new Date(now.getTime()+20*60000).toISOString()}).eq('id',op.id).eq('version',op.version).eq('status','pending').select('*').maybeSingle();check(changed);
 return changed.data?captureReply(changed.data):{text:'La propuesta cambió en otra petición. Revisa la última versión antes de confirmar.'};
}
export async function workflowButton(db:SupabaseClient,data:string,channel:Channel,now:Date):Promise<BotReply|null>{
 const capture=await captureButton(db,data,channel,now);if(capture)return capture;
 if(/^quick:\d+$/.test(data)){
  const draft=await quickDraft(db,data.slice(6),madridClock(now).localDate);
  if(draft.resource==='expenses')return startCapture(db,{description:draft.values.description??'',category:draft.values.category??'Otros',payment_method:draft.values.payment_method??'unknown',date:draft.values.date,...(draft.values.amount?{amount:draft.values.amount}:{})},channel,now);
  check(await db.from('pending_captures').update({status:'cancelled'}).eq('channel',channel).eq('status','pending'));
  const r=await db.from('pending_captures').insert({channel,values:{...draft.values,_resource:draft.resource},expires_at:new Date(now.getTime()+20*60000).toISOString()}).select('*').single();check(r);return captureReply(r.data);
 }
 return null;
}
export async function loadExpenseReview(db:SupabaseClient,today:string){
 const [r,d,rules]=await Promise.all([
 db.from('expenses').select('id,account_uid,booking_date,amount,currency,description,payment_method,duplicate_of,category').gte('booking_date',addDaysToDate(today,-120)).order('booking_date',{ascending:false}).limit(1000),
 db.from('expense_duplicate_dismissals').select('*').limit(1000),db.from('expense_category_rules').select('*').order('id').limit(500)]);
 [r,d,rules].forEach(check);const all=r.data??[];
 // Linked history is loaded independently: old manual records must remain reversible.
 const links=await db.from('expenses').select('id,description,booking_date,amount,duplicate_of').not('duplicate_of','is',null).order('booking_date',{ascending:false}).limit(500);check(links);
 const alreadyLinked=new Set((links.data??[]).map(x=>x.duplicate_of));
 return {candidates:duplicateCandidates(all,d.data??[]).filter(pair=>!alreadyLinked.has(pair.bank.id)).slice(0,60),linked:links.data??[],rules:rules.data??[],partial:all.length===1000,window_days:120};
}
export async function reviewWrite(db:SupabaseClient,resource:string,input:Record<string,unknown>){
 if(resource==='expense_duplicate'){
  if(!['link','unlink','dismiss'].includes(String(input.decision)))throw new UserFacingError('Decisión no válida.');
  check(await db.rpc('review_expense_duplicate',{manual_expense_id:id(input.manual_id),bank_expense_id:id(input.bank_id),decision:input.decision}));
 }else if(resource==='expense_category'){
  if(!CATEGORIES.includes(String(input.category)))throw new UserFacingError('Categoría no válida.');
  if(input.always!==undefined&&typeof input.always!=='boolean')throw new UserFacingError('Elige el alcance.');
  const r=await db.from('expenses').select('description').eq('id',id(input.id)).single();check(r);
  check(await db.rpc('correct_expense_category',{expense_id:id(input.id),new_category:input.category,rule_merchant:input.always?normalizeMerchant(r.data!.description):null}));
 }else if(resource==='category_rule'){
  if(input.remove===true)check(await db.from('expense_category_rules').delete().eq('id',id(input.id)));
  else {if(!CATEGORIES.includes(String(input.category)))throw new UserFacingError('Categoría no válida.');check(await db.from('expense_category_rules').update({category:input.category}).eq('id',id(input.id)).select('id').single());}
 }return {ok:true};
}

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { UserFacingError } from './errors.ts';
import { isCalendarDate } from './expense-queries.ts';
import { addDaysToDate, madridClock, madridLocalToUtc } from './madrid-time.ts';
import { searchEmails, type EmailSummary } from './gmail.ts';
import { isCalendarConnected, listEvents } from './calendar.ts';
import { sendTelegramMessage } from './telegram.ts';

const euro = (n:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n);
export function textValue(value:unknown,max=200):string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new UserFacingError(`Escribe un texto de 1 a ${max} caracteres.`);
  return value.trim();
}
export function amountValue(value:unknown):number {
  const n=typeof value==='number'?value:Number(String(value??'').replace(',','.'));
  if(!Number.isFinite(n)||n<=0||n>100000||Math.abs(n*100-Math.round(n*100))>0.00001)throw new UserFacingError('Indica un importe positivo con un máximo de dos decimales.');
  return n;
}
function idValue(value:unknown):number {const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new UserFacingError('Identificador no válido.');return n;}
export function weekStart(today:string):string {return addDaysToDate(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));}
export function parseLifeInput(resource:string,input:Record<string,unknown>,today:string):Record<string,unknown>{
  if(resource==='tasks'){
    const scheduled_on=input.scheduled_on??today;
    if(!isCalendarDate(scheduled_on))throw new UserFacingError('Fecha de tarea no válida.');
    const due_on=input.due_on||null,duration_minutes=input.duration_minutes==null||input.duration_minutes===''?null:Number(input.duration_minutes);
    if(due_on!==null&&!isCalendarDate(due_on))throw new UserFacingError('Fecha límite no válida.');
    if(duration_minutes!==null&&(!Number.isInteger(duration_minutes)||duration_minutes<5||duration_minutes>480))throw new UserFacingError('Duración entre 5 y 480 minutos.');
    return {text:textValue(input.text,300),scheduled_on,...('due_on' in input?{due_on}:{}),...('duration_minutes' in input?{duration_minutes}:{})};
  }
  if(resource==='debts'){
    if(input.direction!=='receivable'&&input.direction!=='payable')throw new UserFacingError('Elige si te deben o debes.');
    const incurred_on=input.incurred_on??today;
    if(!isCalendarDate(incurred_on)||incurred_on>today)throw new UserFacingError('La fecha de la deuda no puede ser futura.');
    return {person:textValue(input.person,100),bank_name:input.bank_name?textValue(input.bank_name,150):null,description:textValue(input.description||'Gasto compartido',200),amount:amountValue(input.amount),direction:input.direction,incurred_on};
  }
  if(resource==='consumption_goals'){
    if(input.item!=='tobacco'&&input.item!=='energy')throw new UserFacingError('Objetivo no válido.');
    const weekly_limit=Number(input.weekly_limit);
    if(!Number.isInteger(weekly_limit)||weekly_limit<0||weekly_limit>1000)throw new UserFacingError('El límite debe ser un entero entre 0 y 1000.');
    return {item:input.item,weekly_limit};
  }
  throw new UserFacingError('Operación no válida.');
}
export async function lifeWrite(db:SupabaseClient,resource:string,input:Record<string,unknown>,today:string){
  let result;
  if(resource==='task_status'){
    if(typeof input.done!=='boolean')throw new UserFacingError('Estado no válido.');
    result=await db.from('tasks').update({completed_at:input.done?new Date().toISOString():null}).eq('id',idValue(input.id)).select('id').single();
  }else if(resource==='debt_status'){
    // Cash settlement is explicit. It does not guess a bank transaction or alter the bank history.
    if(input.status!=='settled'&&input.status!=='open')throw new UserFacingError('Estado no válido.');
    result=await db.from('debts').update({status:input.status,settled_at:input.status==='settled'?new Date().toISOString():null,income_id:null,expense_id:null}).eq('id',idValue(input.id)).select('id').single();
  }else if(resource==='reconcile_debts')return reconcileDebts(db);
  else if(resource==='task_plan'){
    const r=await db.from('tasks').select('*').eq('id',idValue(input.id)).single();if(r.error)throw r.error;
    const payload=parseLifeInput('tasks',{...r.data,...input},today);
    result=await db.from('tasks').update(payload).eq('id',idValue(input.id)).select('id').single();
  }else {
    const payload=parseLifeInput(resource,input,today);
    result=resource==='consumption_goals'?await db.from(resource).upsert(payload,{onConflict:'item'}):await db.from(resource).insert(payload);
  }
  if(result.error)throw result.error;
  if(resource==='debts')await reconcileDebts(db).catch(error=>console.error('Deuda guardada; conciliación pendiente',error));
  return {ok:true};
}
export async function reconcileDebts(db:SupabaseClient){const {data,error}=await db.rpc('reconcile_personal_debts');if(error)throw error;return {ok:true,matched:data??0};}
async function rows(db:SupabaseClient,table:string){let query=db.from(table).select('*');if(table==='debts')query=query.order('status',{ascending:true});const {data,error}=await query.order('id',{ascending:false}).limit(500);if(error)throw error;return data??[];}
export async function loadLife(db:SupabaseClient,today:string){
 const [tasks,debts,goals,expenses]=await Promise.all([
   db.from('tasks').select('*').order('completed_at',{ascending:false,nullsFirst:true}).order('scheduled_on',{ascending:true}).limit(500).then(r=>{if(r.error)throw r.error;return r.data??[];}),rows(db,'debts'),db.from('consumption_goals').select('*').then(r=>{if(r.error)throw r.error;return r.data??[];}),
   db.from('expenses').select('id,booking_date,description,amount').is('duplicate_of',null).gte('booking_date',today.slice(0,8)+'01').lte('booking_date',today).limit(1000).then(r=>{if(r.error)throw r.error;return r.data??[];})
 ]);
 return {tasks,debts,goals:consumptionProgress(goals,expenses,today)};
}
// Existing estimates of cans by price are not reliable enough for quantity targets.
export function consumptionUnits(row:{description:string;amount:number|string},item:string):number{
 const s=row.description??'';
 if(item==='tobacco')return /tabac|estanc|expendedur/i.test(s)?1:0;
 const m=s.match(/^ENERG[ÉE]TICA\s*x(\d+)/i);return m?Number(m[1]):0;
}
export function consumptionProgress(goals:any[],expenses:any[],today:string){
 const start=weekStart(today);
 return goals.map(g=>{
  const relevant=expenses.filter(e=>consumptionUnits(e,g.item)>0),week=relevant.filter(e=>e.booking_date>=start);
  const used=week.reduce((s,e)=>s+consumptionUnits(e,g.item),0),units=relevant.reduce((s,e)=>s+consumptionUnits(e,g.item),0),spent=relevant.reduce((s,e)=>s+Number(e.amount),0);
  // Savings against an explicit weekly ceiling, not a fabricated historic spending baseline.
  let allowance=0;for(let d=today.slice(0,8)+'01';d<=today;d=addDaysToDate(d,1))allowance+=Number(g.weekly_limit)/7;
  const estimated_saving=units>0?Math.max(0,(allowance-units)*(spent/units)):0;
  return {...g,used,week_start:start,spent_month:spent,estimated_saving:Math.round(estimated_saving*100)/100};
 });
}
export interface DeliveryNotice {key:string;subject:string;from:string;status:'today'|'transit';reference:string|null;}
export function deliveryNotices(emails:EmailSummary[],today:string):DeliveryNotice[]{
 const normalized=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 const ref=(s:string)=>{const m=s.match(/(?:pedido|order|env[ií]o|tracking|seguimiento)\s*(?:n[ºo.]|numero|number|#|:)?\s*([a-z0-9][a-z0-9-]{5,})/i)?.[1];return m&&/\d/.test(m)?m.toLowerCase():null;};
 const ordered=[...emails].sort((a,b)=>(b.date?.getTime()??0)-(a.date?.getTime()??0));
 const closed=new Set<string>(),seen=new Set<string>(),result:DeliveryNotice[]=[];
 for(const e of ordered){
  const s=normalized(e.subject),reference=ref(e.subject),key=reference?`${normalized(e.from)}:${reference}`:`${e.from}:${e.subject}:${e.date?.toISOString()}`;
  if(/entregado|delivered|cancelad/.test(s)&&! /no entregado|not delivered|no se ha entregado/.test(s)){if(reference)closed.add(key);continue;}
  if(!/pedido|paquete|envio|order|parcel|delivery/.test(s)||!/llega hoy|entrega hoy|en reparto|out for delivery|en camino|shipped|enviado/.test(s))continue;
  if(closed.has(key)||seen.has(key)||!e.date)continue;
  const date=madridClock(e.date).localDate;
  if(date>today)continue;
  const status=/hoy|en reparto|out for delivery/.test(s)?'today':'transit';
  if(status==='today'&&date!==today)continue;
  seen.add(key);result.push({key,from:e.from,subject:e.subject,status,reference});
 }
 return result.slice(0,8);
}
export async function loadDeliveries(db:SupabaseClient,today:string){
 const {emails}=await searchEmails(db,'newer_than:14d {subject:pedido subject:paquete subject:envío subject:order subject:parcel subject:delivery}',50);
 return {notices:deliveryNotices(emails,today),note:'Detección por asunto y fecha. La entrega solo se concilia si coincide remitente y referencia; no se lee el cuerpo del correo.'};
}
export async function weeklyReview(db:SupabaseClient,now:Date){
 const today=madridClock(now).localDate,from=addDaysToDate(today,-6),before=addDaysToDate(today,-13),next=addDaysToDate(today,7);
 const result=await Promise.allSettled([
  db.from('expenses').select('booking_date,amount,category').is('duplicate_of',null).gte('booking_date',before).lte('booking_date',today).limit(1000).then(r=>{if(r.error)throw r.error;return r.data??[];}),
  db.from('habit_checks').select('done').gte('date',from).lte('date',today).then(r=>{if(r.error)throw r.error;return r.data??[];}),
  rows(db,'birthdays'),rows(db,'debts'),
  isCalendarConnected(db).then(connected=>connected?listEvents(db,addDaysToDate(today,1),next):null),
  db.from('price_drops').select('query,old_price,new_price').gte('observed_at',madridLocalToUtc(from+'T00:00').toISOString()).order('observed_at',{ascending:false}).limit(20).then(r=>{if(r.error)throw r.error;return r.data??[];})
 ]);
 const lines=['📋 Tu repaso semanal',`${from} – ${today}`];
 const value=(i:number):any=>result[i].status==='fulfilled'?(result[i] as PromiseFulfilledResult<any>).value:null;
 const expenses=value(0);if(expenses){const current=expenses.filter((e:any)=>e.booking_date>=from),previous=expenses.filter((e:any)=>e.booking_date<from);const sum=(r:any[])=>r.reduce((s,e)=>s+Number(e.amount),0);lines.push(`\n💶 Gastos: ${euro(sum(current))} · semana anterior: ${euro(sum(previous))}`);const categories=new Map<string,number>();current.forEach((e:any)=>categories.set(e.category,(categories.get(e.category)??0)+Number(e.amount)));lines.push(...[...categories].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>`• ${c}: ${euro(n)}`));}else lines.push('\n💶 Gastos: no disponibles.');
 const checks=value(1);lines.push(checks?`\n✓ Hábitos: ${checks.filter((c:any)=>c.done).length} cumplidos de ${checks.length} respuestas registradas.`:'\n✓ Hábitos: no disponibles.');
 const birthdays=value(2);if(birthdays){const upcoming=[];for(let d=addDaysToDate(today,1);d<=next;d=addDaysToDate(d,1))for(const b of birthdays)if(Number(d.slice(5,7))===b.month&&Number(d.slice(8,10))===b.day)upcoming.push(`• ${d}: ${b.name}`);lines.push('\n🎂 Cumpleaños próximos:',...(upcoming.length?upcoming:['Ninguno registrado.']));}else lines.push('\n🎂 Cumpleaños: no disponibles.');
 const debts=value(3);lines.push('\n🤝 Deudas pendientes:',...(debts?debts.filter((d:any)=>d.status==='open').slice(0,10).map((d:any)=>`• ${d.person}: ${d.direction==='receivable'?'te debe':'debes'} ${euro(Number(d.amount))}`):['No disponibles.']));if(debts&&!debts.some((d:any)=>d.status==='open'))lines.push('Ninguna.');
 const events=value(4);lines.push('\n🗓️ Próxima semana:',...(events?events.slice(0,10).map((e:any)=>`• ${e.date??(e.start?new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(e.start):'Sin fecha')}: ${e.title}`):['Calendario no disponible o sin conectar.']));if(events&&!events.length)lines.push('Sin eventos.');
 const drops=value(5);lines.push('\n🏷️ Bajadas de precio:',...(drops?drops.slice(0,5).map((d:any)=>`• ${d.query}: ${euro(Number(d.old_price))} → ${euro(Number(d.new_price))}`):['No disponibles.']));if(drops&&!drops.length)lines.push('Sin bajadas registradas esta semana.');
 return lines.join('\n').slice(0,4000);
}
export async function sendLifeWeeklyReview(db:SupabaseClient,now:Date){
 const key=`weekly:${weekStart(madridClock(now).localDate)}`;
 const {data,error}=await db.from('review_deliveries').upsert({key,status:'sending'},{onConflict:'key',ignoreDuplicates:true}).select('key');
 if(error)throw error;if(!data?.length)return;
 try{await sendTelegramMessage(await weeklyReview(db,now));const r=await db.from('review_deliveries').update({status:'sent',sent_at:now.toISOString()}).eq('key',key);if(r.error)throw r.error;}
 catch(e){await db.from('review_deliveries').update({status:'failed'}).eq('key',key);throw e;}
}
export const LIFE_INTENT_FORMAT='Tareas sin hora: {"intent":"life","resource":"tasks","text":"llamar al banco","scheduled_on":"YYYY-MM-DD"}. Deudas: {"intent":"life","resource":"debts","person":"Marta","direction":"receivable" (me debe) o "payable" (debo),"amount":12,"description":"cena"}. Objetivos: {"intent":"life","resource":"consumption_goals","item":"tobacco" o "energy","weekly_limit":2}. Tabaco se mide en compras, no paquetes. Consultar tareas, deudas u objetivos: {"intent":"life","resource":"list"}.';
export async function replyToLife(db:SupabaseClient,input:Record<string,unknown>,now:Date){
 const today=madridClock(now).localDate,resource=String(input.resource);
 if(resource==='list'){
  const data=await loadLife(db,today);return ['📌 Pendientes',...data.tasks.filter(t=>!t.completed_at).slice(0,10).map(t=>`• Tarea #${t.id}: ${t.text}`),...data.debts.filter(d=>d.status==='open').slice(0,10).map(d=>`• ${d.person}: ${d.direction==='receivable'?'te debe':'debes'} ${euro(Number(d.amount))}`)].join('\n');
 }
 if(!['tasks','debts','consumption_goals'].includes(resource))throw new UserFacingError('Pídeme crear una tarea, una deuda o un objetivo.');
 await lifeWrite(db,resource,input,today);return resource==='tasks'?'Tarea guardada, sin hora. La verás en Recordatorios hasta completarla.':resource==='debts'?'Deuda guardada. Solo se salda automáticamente si coinciden nombre bancario, importe y una única deuda pendiente.':'Objetivo semanal guardado. Puedes ver el progreso en Inicio.';
}

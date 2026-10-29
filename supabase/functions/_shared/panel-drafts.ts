import { askGroqForJson } from './groq.ts';
import { madridClock } from './madrid-time.ts';

const DRAFT_FIELDS:Record<string,string[]>={
  tasks:["text","scheduled_on"], debts:["person","bank_name","amount","description","direction","incurred_on"], consumption_goals:["item","weekly_limit"],
  expenses:['description','amount','date','category'], incomes:['description','amount','date'],
  reminders:['text','local_datetime','repeat','advance_minutes'], calendar:['title','date','local_datetime','duration_minutes'],
  notes:['text'], habits:['name','scheduled_days'], price_watches:['query','max_price'], budgets:['category','monthly_limit'],
  weight_entries:['date','kg'], shopping_items:['text'],
};
/** Una propuesta no escribe en la base de datos. Los endpoints existentes validan al confirmar. */
export function parsePanelDraft(raw:unknown){
  const value=raw as {resource?:unknown;values?:unknown}|null;
  if(!value||typeof value.resource!=='string'||!Object.hasOwn(DRAFT_FIELDS,value.resource))return null;
  if(!value.values||typeof value.values!=='object'||Array.isArray(value.values))return null;
  const input=value.values as Record<string,unknown>, values:Record<string,string|number>={};
  for(const key of DRAFT_FIELDS[value.resource]){
    const v=input[key];
    if(typeof v==='string')values[key]=v.slice(0,key==='text'?1000:200);
    else if(typeof v==='number'&&Number.isFinite(v))values[key]=v;
  }
  return Object.keys(values).length?{resource:value.resource,values}:null;
}
export async function preparePanelDraft(message:string,now:Date){
  const today=madridClock(now);
  return parsePanelDraft(await askGroqForJson([
    'Preparas formularios editables en español. NO ejecutas acciones.',
    `Fecha y hora actuales en Madrid: ${today.localDateTime}.`,
    'Solo si pide CREAR o apuntar algo, devuelve {"resource":"...","values":{...}}. Si pregunta, consulta, contesta sí/no, borra o cambia algo existente: {"resource":null}.',
    'Para tareas sin hora usa tasks(text,scheduled_on). Para deudas usa debts(person,bank_name opcional,amount,description,direction: receivable si me deben o payable si debo,incurred_on). Para objetivos usa consumption_goals(item: tobacco o energy,weekly_limit). No conviertas una deuda en un ingreso ni una tarea en un recordatorio.',
    'Recursos y campos: expenses(description,amount,date,category), incomes(description,amount,date), reminders(text,local_datetime,repeat,advance_minutes), calendar(title,date,local_datetime,duration_minutes), notes(text), habits(name,scheduled_days), price_watches(query,max_price), budgets(category,monthly_limit), weight_entries(date,kg), shopping_items(text).',
    'Fechas YYYY-MM-DD, horas locales YYYY-MM-DDTHH:mm. Importes numéricos en euros. No inventes datos ausentes: déjalos vacíos para que se completen.',
    'Para gastos sin fecha usa hoy y categoría Otros. Categorías: Supermercado, Restaurantes, Transporte, Hogar, Suscripciones, Ocio, Salud, Compras, Otros.',
    'Si dice añade un gasto sin más, prepara expenses con description vacía. Ingreso es incomes.',
    'Recordatorios sin hora: 09:00 del día pedido; repeat vacío, daily, weekdays, weekly o monthly; advance_minutes vacío,30 o1440.',
    'Evento sin hora: date y local_datetime vacío (todo el día). Con hora: local_datetime y date vacío. Duración 60 minutos si no dice otra.',
    'Energéticas: 1,20 por lata si no indica precio. Tabaco necesita el importe dicho. Conserva TABACO o ENERGÉTICA xN en description.',
    'En hábitos, scheduled_days es una cadena con los días ISO elegidos: lunes=1, domingo=7; por ejemplo 1,3,5. Si no dice días, 1,2,3,4,5,6,7.',
    'Solo una propuesta por mensaje. Si pide varias acciones, devuelve resource null. Devuelve solo JSON.'
  ].join('\n'),message));
}

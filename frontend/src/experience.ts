export type Expense={booking_date:string;description:string;amount:number|string;category?:string};
export function financeSummary(expenses:Expense[],today:string){
  const [year,month,day]=today.split('-').map(Number);
  const previousDate=new Date(Date.UTC(year,month-2,1)),previous=previousDate.toISOString().slice(0,7),current=today.slice(0,7);
  const previousEnd=`${previous}-${String(Math.min(day,new Date(Date.UTC(year,month-1,0)).getUTCDate())).padStart(2,'0')}`;
  const total=(rows:Expense[])=>Math.round(rows.reduce((s,r)=>s+Number(r.amount),0)*100)/100;
  const spent=total(expenses.filter(r=>r.booking_date.startsWith(current)&&r.booking_date<=today));
  const before=total(expenses.filter(r=>r.booking_date.startsWith(previous)&&r.booking_date<=previousEnd));
  const groups=new Map<string,Expense[]>();
  for(const row of expenses){const merchant=row.description.toLocaleLowerCase('es').replace(/\d+/g,'').replace(/[^\p{L}\s]/gu,' ').replace(/\s+/g,' ').trim();if(merchant.length<4)continue;groups.set(merchant,[...(groups.get(merchant)??[]),row]);}
  const recurring=[...groups.values()].flatMap(rows=>{
    const ordered=[...rows].sort((a,b)=>a.booking_date.localeCompare(b.booking_date));
    if(ordered.length<3||new Set(ordered.map(r=>r.booking_date.slice(0,7))).size<3)return [];
    const amounts=ordered.map(r=>Number(r.amount)).sort((a,b)=>a-b),median=amounts[Math.floor(amounts.length/2)];
    if(amounts.some(a=>Math.abs(a-median)>Math.max(1,median*.15)))return [];
    const gaps=ordered.slice(1).map((r,i)=>(Date.parse(r.booking_date)-Date.parse(ordered[i].booking_date))/86400000);
    if(gaps.some(g=>g<25||g>35))return [];
    return [{name:ordered.at(-1)!.description,amount:median,count:ordered.length}];
  }).slice(0,6);
  return {spent,before,difference:Math.round((spent-before)*100)/100,percent:before>0?Math.round((spent-before)/before*100):null,recurring,previousEnd};
}
export const UNDO_DELAY=8000;
export type Draft={resource:string;values:Record<string,string|number>};
export function dayFocus(data:Record<string,any>,now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  const localDate=(v:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date(v));
  const reminders=(Array.isArray(data.reminders)?data.reminders:[]) as any[];
  const events=(data.calendar?.events??[]) as any[];
  const checks=new Set((data.habit_checks??[]).filter((c:any)=>c.date===today).map((c:any)=>c.habit_id));
  const weekday=new Date(`${today}T12:00:00Z`).getUTCDay()||7;
  const pendingHabits=(data.habits??[]).some((h:any)=>(h.scheduled_days??[1,2,3,4,5,6,7]).includes(weekday)&&!checks.has(h.id));
  const unfinished=reminders.some(r=>localDate(r.remind_at)<=today)||events.some(e=>e.start&&localDate(e.start)===today&&Date.parse(e.start)>now.getTime())||pendingHabits;
  const isTomorrow=Number(parts.hour)>=19&&!unfinished;
  const date=isTomorrow?new Date(Date.parse(`${today}T12:00:00Z`)+86400000).toISOString().slice(0,10):today;
  const upcoming=[...reminders.filter(r=>localDate(r.remind_at)===date&&Date.parse(r.remind_at)>=now.getTime()).map(r=>({text:r.text,at:r.remind_at,section:'reminders'})),...events.filter(e=>e.start&&localDate(e.start)===date&&Date.parse(e.start)>=now.getTime()).map(e=>({text:e.title,at:e.start,section:'calendar'}))].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  return {date,isTomorrow,next:upcoming[0],overdue:reminders.filter(r=>Date.parse(r.remind_at)<now.getTime()).length};
}
/** Evita una llamada extra al modelo en saludos, consultas y respuestas cortas. */
export function isDraftCandidate(message:string){
  const text=message.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
  if(/^(si|no|ya|hecho|todavia no|vale|ok)[.!]?$/.test(text))return false;
  return /\b(anad\w*|apunt\w*|guard\w*|crea\w*|registra\w*|recuerd\w*|avisa\w*|vigila\w*|gaste|pague)\b/.test(text)||/\b(he pagado|toma nota|peso \d)\b/.test(text)||/\b(quiero|necesito|pon|ponme)\b.*\b(recordatorio|nota|habito|gasto|ingreso|evento|presupuesto)\b/.test(text);
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { LayoutDashboard, Wallet, Bell, ShoppingBasket, Cake, Flame, CalendarDays, LogOut, Plus, Trash2, RefreshCw, ArrowUpRight, ArrowDownRight, Menu, X, Check, AlertCircle, Send, Scale, Cigarette, CupSoda, Mic, Square, Brain } from 'lucide-react';
import chatbotLogo from './assets/chatbot-logo.png';

type Row = Record<string, any>;
type Section = 'overview'|'finances'|'reminders'|'shopping_items'|'birthdays'|'habits'|'weight'|'calendar'|'memory';

// La clave publicable de Supabase está pensada para ir en el navegador; los permisos los decide panel-api.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://znzyzstvfqsrilhzyqub.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_8ryCdPQQEVxc2rZVWN0rDQ_5yPUskbh';
const apiUrl = import.meta.env.VITE_PANEL_API_URL ?? `${supabaseUrl}/functions/v1/panel-api`;
const supabase = createClient(supabaseUrl, supabaseKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});

const chartColors = ['#1779db','#f08143','#32ad91','#8a66d7','#e6b33e','#ea7091','#5277a6','#69b27b'];
const navigation: {id:Section; label:string; icon:typeof LayoutDashboard}[] = [
  {id:'overview',label:'Inicio',icon:LayoutDashboard},{id:'finances',label:'Finanzas',icon:Wallet},{id:'reminders',label:'Recordatorios',icon:Bell},
  {id:'shopping_items',label:'Lista de la compra',icon:ShoppingBasket},
  {id:'birthdays',label:'Cumpleaños',icon:Cake},{id:'habits',label:'Hábitos',icon:Flame},{id:'weight',label:'Peso',icon:Scale},{id:'calendar',label:'Calendario',icon:CalendarDays},
  {id:'memory',label:'Memoria',icon:Brain}
];
const resources = ['expenses','incomes','budgets','reminders','shopping_items','birthdays','habits','habit_checks','weight_entries','calendar','bank_connection','memory'] as const;
const euro = (v:number) => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(v);
const dateTime = (v:string) => new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(v));
const todayInMadrid = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date());

async function api(resource:string, token:string, method='GET', data?:object, params?:Record<string,string>):Promise<any> {
  const url = new URL(apiUrl); url.searchParams.set('resource',resource);
  Object.entries(params??{}).forEach(([key,value])=>url.searchParams.set(key,value));
  const response = await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const result = await response.json().catch(()=>({}));
  if (!response.ok) throw Object.assign(new Error(result.error??'No se pudo conectar con el asistente.'),{status:response.status});
  return result;
}

/** Fecha y hora actuales en Madrid, para proponer valores en los formularios. */
function madridNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
const tomorrowInMadrid = () => madridNow(new Date(Date.now()+86_400_000)).date;

function Card({title,aside,children,className=''}:{title:string;aside?:ReactNode;children:ReactNode;className?:string}) {return <section className={`card ${className}`}><div className="card-heading"><h2>{title}</h2>{aside}</div>{children}</section>}
function Empty({children}:{children:ReactNode}) {return <p className="empty">{children}</p>}
function InlineForm({label,placeholder,onSubmit,type='text'}:{label:string;placeholder:string;onSubmit:(text:string)=>Promise<boolean>;type?:string}) {
  const [value,setValue]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();if(!value.trim())return;setBusy(true);try{if(await onSubmit(value.trim())!==false)setValue('')}finally{setBusy(false)}}
  return <form className="inline-form" onSubmit={submit}><label className="sr-only" htmlFor={`input-${label}`}>{label}</label><input id={`input-${label}`} type={type} value={value} placeholder={placeholder} onChange={e=>setValue(e.target.value)} required/><button className="primary icon-button" type="submit" disabled={busy} aria-label={label}><Plus size={19}/></button></form>
}

// En el gráfico, tabaco y energéticas van aparte de la categoría que les puso el banco, para ver cuánto suponen.
function chartCategory(r:Row):string{
  if(isTobaccoShop(String(r.description??'')))return 'Tabaco';
  if(energyDrinkCans(r)>0)return 'Energéticas';
  return r.category||'Otros';
}

function SpendingChart({expenses,period}:{expenses:Row[];period:number}) {
  const now=new Date(), bars=period===7?7:period===30?10:13, daysPerBar=period===7?1:period===30?3:7;
  const buckets=Array.from({length:bars},(_,i)=>{
    const end=new Date(now);end.setUTCDate(end.getUTCDate()-(bars-1-i)*daysPerBar);
    const start=new Date(end);start.setUTCDate(start.getUTCDate()-daysPerBar+1);
    const from=start.toISOString().slice(0,10), to=end.toISOString().slice(0,10);
    return {from,to,value:expenses.filter(r=>r.booking_date>=from&&r.booking_date<=to).reduce((n,r)=>n+Number(r.amount),0)};
  });
  const highest=Math.max(1,...buckets.map(b=>b.value)), total=expenses.reduce((n,r)=>n+Number(r.amount),0);
  const categories=Object.entries(expenses.reduce((acc:Record<string,number>,r)=>{const c=chartCategory(r);acc[c]=(acc[c]||0)+Number(r.amount);return acc},{})).sort((a,b)=>b[1]-a[1]);
  const tobaccoPurchases=expenses.filter(r=>chartCategory(r)==='Tabaco').length, cans=expenses.reduce((n,r)=>n+energyDrinkCans(r),0);
  const quantity:Record<string,string>={Tabaco:tobaccoPurchases===1?'1 compra':`${tobaccoPurchases} compras`,'Energéticas':cans===1?'1 lata':`${cans} latas`};
  let start=0;
  const slices=categories.map(([,value],i)=>{const end=start+value/total*100;const slice=`${chartColors[i%chartColors.length]} ${start}% ${end}%`;start=end;return slice});
  return <div className="finance-visuals"><div className="chart-heading"><div><span className="eyebrow">EVOLUCIÓN</span><h3>Gasto en el periodo</h3></div><strong>{euro(total)}</strong></div>
    {total>0?<><div className="spending-bars" role="img" aria-label={`Gráfico de gastos de los últimos ${period} días`}>{buckets.map((b,i)=><div className="bar-slot" key={i} title={`${b.from} – ${b.to}: ${euro(b.value)}`}><span className={`bar-fill ${b.value===highest?'highest':''}`} style={{height:`${b.value?Math.max(5,b.value/highest*100):0}%`}}/></div>)}</div>
    <div className="chart-axis"><span>{buckets[0].from}</span><span>Hoy</span></div>
    <div className="category-summary"><div className="donut" style={{background:`conic-gradient(${slices.join(',')})`}} role="img" aria-label="Distribución de gastos por categoría"><span>{categories.length}<small>categorías</small></span></div><div className="category-legend">{categories.map(([name,value],i)=><div key={name}><i style={{background:chartColors[i%chartColors.length]}}/><span>{name}{quantity[name]?` · ${quantity[name]}`:''}</span><strong>{euro(value)}</strong></div>)}</div></div></>
    :<p className="empty">Todavía no hay gastos en este periodo.</p>}</div>
}

function ReminderForm({save}:{save:(data:object)=>Promise<boolean>}) {
  const [date,setDate]=useState(tomorrowInMadrid),[time,setTime]=useState(()=>madridNow().time),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const form=e.currentTarget,data=new FormData(form);setBusy(true);
    try{if(await save({text:data.get('text'),local_datetime:`${date}T${time}`,repeat:data.get('repeat')||null,advance_minutes:data.get('advance')?Number(data.get('advance')):null})){form.reset();setDate(tomorrowInMadrid());setTime(madridNow().time)}}
    finally{setBusy(false)}
  }
  return <form className="stack-form" onSubmit={submit}><input name="text" required maxLength={500} placeholder="¿Qué quieres recordar?" aria-label="Texto del recordatorio"/>
    <div className="form-row"><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label><label>Hora<input type="time" value={time} onChange={e=>setTime(e.target.value)} required/></label>
    <label>Repetición<select name="repeat"><option value="">Una vez</option><option value="daily">Cada día</option><option value="weekdays">Lunes a viernes</option><option value="weekly">Cada semana</option><option value="monthly">Cada mes</option></select></label>
    <label>Aviso previo<select name="advance"><option value="">Automático</option><option value="30">30 minutos antes</option><option value="1440">Un día antes</option></select></label>
    <button className="primary" type="submit" disabled={busy}><Plus size={17}/> Añadir</button></div>
    <p className="form-hint">Proponemos mañana a la hora actual. Puedes cambiar la fecha o la hora.</p></form>
}

function EventForm({save}:{save:(data:object)=>Promise<boolean>}) {
  const [date,setDate]=useState(()=>madridNow().date),[time,setTime]=useState(()=>madridNow().time),[hasTime,setHasTime]=useState(false),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const form=e.currentTarget,title=new FormData(form).get('title');setBusy(true);
    try{if(await save(hasTime?{title,local_datetime:`${date}T${time}`,duration_minutes:60}:{title,date})){form.reset();setDate(madridNow().date);setTime(madridNow().time);setHasTime(false)}}
    finally{setBusy(false)}
  }
  return <form className="stack-form" onSubmit={submit}><div className="form-row"><label>Evento<input name="title" required placeholder="Título del evento"/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>{hasTime&&<label>Hora<input type="time" value={time} onChange={e=>setTime(e.target.value)} required/></label>}<button className="primary" type="submit" disabled={busy}><Plus size={17}/> Crear evento</button></div>
    <label className="optional-time"><input type="checkbox" checked={hasTime} onChange={e=>setHasTime(e.target.checked)}/> Añadir hora (si no, será todo el día)</label></form>
}

// Uno distinto cada día, con la guasa que pidió Rafa. Sin «buenos días» porque el panel se abre a cualquier hora.
const GREETINGS = [
  '¿Qué pasa, Petzi? 👋','Buenas, Rafa 😏','¿Qué quieres ahora, pringao? 🙄','Aquí estoy, cabrón 😎','Dime, Rafa 👊',
  'A sus órdenes, Petzi 🫡','¿Otra vez por aquí, Rafa? 😂','¿Qué tal la tesis, ingeniero? 📚','¿Ya vas por la segunda energética, Petzi? 🥤',
  'Mira quién se ha acordado de mí 🙃','¿Hoy toca gimnasio o excusa, Rafa? 🏋️','Habla, cabrón, que no muerdo 🐶',
  '¿Vienes a ver cuánto has gastado, pringao? 💸','Petzi, el ingeniero más procrastinador de Madrid 🏆','Bienvenido a tu centro de mando, Rafa 🚀',
  '¿Otra pausa de la tesis, Petzi? 👀','Aquí tu asistente, más currante que tú 💪','¿Qué se le ofrece al señorito? 🎩',
  'Rafa, que te veo venir 🕵️','Venga, Petzi, sorpréndeme 🎲',
];
const DAY_MS = 86_400_000;
const dailyGreeting = () => GREETINGS[Math.floor(Date.parse(`${todayInMadrid()}T00:00:00Z`)/DAY_MS)%GREETINGS.length];

type ChatMessage = {role:'user'|'assistant'; text:string; buttons?:{text:string;callback_data:string}[][]};
// El servidor acepta como mucho 10 mensajes previos de hasta 2000 caracteres.
const chatHistory = (messages:ChatMessage[]) => messages.slice(-10).map(m=>({role:m.role,text:m.text.slice(0,2000)}));
// Igual que en el bot de Telegram, las notas de voz no pasan de 2 minutos.
const MAX_RECORDING_MS = 120_000;

/** Empieza a grabar del micrófono; al parar (o a los 2 minutos) entrega el audio y suelta el micrófono. */
async function startRecording(onDone:(audio:Blob)=>void):Promise<MediaRecorder>{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const recorder=new MediaRecorder(stream),chunks:Blob[]=[];
  const timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},MAX_RECORDING_MS);
  recorder.ondataavailable=e=>chunks.push(e.data);
  recorder.onstop=()=>{clearTimeout(timer);stream.getTracks().forEach(track=>track.stop());onDone(new Blob(chunks,{type:recorder.mimeType}))};
  recorder.start();
  return recorder;
}

async function transcribe(audio:Blob, token:string):Promise<string>{
  const url=new URL(apiUrl);url.searchParams.set('resource','transcribe');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':audio.type||'audio/webm'},body:audio});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error??'No se pudo transcribir la nota de voz.');
  return String(result.text??'').trim();
}

function AssistantChat({token,onChange}:{token:string;onChange:()=>Promise<void>}) {
  const [messages,setMessages]=useState<ChatMessage[]>([]),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[chatError,setChatError]=useState('');
  const end=useRef<HTMLDivElement>(null),recorder=useRef<MediaRecorder|null>(null),[recording,setRecording]=useState(false);
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'})},[messages,busy]);
  async function ask(payload:object, apply:(reply:ChatMessage)=>void){
    setBusy(true);setChatError('');
    try{const reply=await api('chat',token,'POST',payload);apply({role:'assistant',text:reply.text,buttons:reply.buttons});await onChange()}
    catch(e){setChatError(e instanceof Error?e.message:'No se pudo hablar con el asistente.')}
    finally{setBusy(false)}
  }
  async function send(text:string){
    const message=text.trim();if(!message||busy)return;
    const history=chatHistory(messages);setDraft('');setMessages(m=>[...m,{role:'user',text:message}]);
    await ask({message,history},reply=>setMessages(m=>[...m,reply]));
  }
  // Lo dicho se manda como si se hubiera escrito, así se ve lo que ha entendido.
  async function sendAudio(audio:Blob){
    recorder.current=null;setRecording(false);setBusy(true);setChatError('');
    let text='';
    try{text=await transcribe(audio,token)}
    catch(e){setChatError(e instanceof Error?e.message:'No se pudo transcribir la nota de voz.')}
    finally{setBusy(false)}
    if(text)await send(text);else setChatError(current=>current||'No he entendido la nota de voz.');
  }
  async function toggleRecording(){
    if(recorder.current){recorder.current.stop();return}
    try{setChatError('');recorder.current=await startRecording(audio=>void sendAudio(audio));setRecording(true)}
    catch{setChatError('No puedo usar el micrófono. Revisa el permiso del navegador.')}
  }
  // Como en Telegram, pulsar un botón actualiza el mensaje que lo contenía (por ejemplo, tachar de la compra).
  async function press(index:number,data:string){await ask({button:data},reply=>setMessages(m=>m.map((msg,i)=>i===index?reply:msg)))}
  return <Card title="Pregúntale a tu asistente" aside={messages.length?<button className="text-link" onClick={()=>setMessages([])}>Nueva conversación</button>:undefined} className="chat-card">
    <div className="chat-log" aria-live="polite">
      {!messages.length&&<div className="chat-welcome"><img className="chat-avatar large" src={chatbotLogo} alt=""/><p>Dime, que para eso estoy.</p></div>}
      {messages.map((m,i)=><div key={i} className={`chat-row ${m.role}`}>{m.role==='assistant'&&<img className="chat-avatar" src={chatbotLogo} alt=""/>}<div className={`chat-message ${m.role}`}><p>{m.text}</p>{m.buttons&&<div className="chat-buttons">{m.buttons.flat().map(b=><button key={b.callback_data} className="secondary" onClick={()=>void press(i,b.callback_data)} disabled={busy}>{b.text}</button>)}</div>}</div></div>)}
      {busy&&<div className="chat-row assistant"><img className="chat-avatar" src={chatbotLogo} alt=""/><div className="chat-message assistant typing"><p>Pensando…</p></div></div>}
      <div ref={end}/>
    </div>
    {chatError&&<p className="error" role="alert">{chatError}</p>}
    <form className="inline-form chat-form" onSubmit={e=>{e.preventDefault();void send(draft)}}><label className="sr-only" htmlFor="chat-input">Mensaje para el asistente</label><input id="chat-input" value={draft} maxLength={1000} placeholder={recording?'Grabando… pulsa ■ para enviar':'Escribe un mensaje…'} disabled={recording} onChange={e=>setDraft(e.target.value)} autoComplete="off"/><button className={`icon-button ${recording?'primary recording':'secondary'}`} type="button" onClick={()=>void toggleRecording()} disabled={busy} aria-label={recording?'Parar y enviar la nota de voz':'Grabar una nota de voz'}>{recording?<Square size={16}/>:<Mic size={18}/>}</button><button className="primary icon-button" type="submit" disabled={busy||recording||!draft.trim()} aria-label="Enviar mensaje"><Send size={18}/></button></form>
  </Card>;
}

function LoginScreen({onNotice,error,notice,setError}:{onNotice:(text:string)=>void;error:string;notice:string;setError:(text:string)=>void}) {
  const [mode,setMode]=useState<'login'|'signup'>('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    const {error:authError}=mode==='signup'?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});
    setBusy(false);setPassword('');
    if(authError){setError(authError.code==='email_not_confirmed'?'Confirma tu correo con el enlace que te enviamos y vuelve a entrar. Revisa también la carpeta de spam.':mode==='signup'?'No se pudo crear la cuenta. Revisa el correo y prueba otra contraseña.':'No se pudo iniciar sesión. Revisa el correo y la contraseña.');return}
    if(mode==='signup'){await supabase.auth.signOut();setMode('login');onNotice('Cuenta creada. Confirma el correo que te hemos enviado y después entra con tu contraseña.')}
  }
  async function resend(){
    if(!email)return;setBusy(true);setError('');
    const {error:resendError}=await supabase.auth.resend({type:'signup',email});setBusy(false);
    if(resendError)setError('No se pudo reenviar el correo ahora. Inténtalo en unos minutos.');else onNotice('Te hemos enviado otro correo de confirmación. Revisa también la carpeta de spam.');
  }
  return <div className="login-screen"><div className="login-intro"><img src={chatbotLogo} alt="Mi asistente"/><span className="eyebrow">TU ESPACIO PERSONAL</span><h1>Un lugar para tenerlo <em>todo claro.</em></h1><p>Finanzas, agenda y tareas. Tu información real, organizada en un panel fácil de consultar.</p><div className="login-pills"><span>Finanzas</span><span>Recordatorios</span><span>Agenda</span></div></div>
    <div className="login-card"><span className="eyebrow">ACCESO SEGURO</span><h2>{mode==='signup'?'Crea tu cuenta':'Bienvenido de nuevo'}</h2><p>{mode==='signup'?'Confirma el correo después de crear la cuenta.':'Entra con tu correo y contraseña para ver tu dashboard.'}</p>
      <form onSubmit={submit}><label htmlFor="email">Correo electrónico</label><input id="email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="tu@correo.com"/><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete={mode==='signup'?'new-password':'current-password'} minLength={6} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Tu contraseña"/><button className="primary full" disabled={busy}>{busy?'Un momento…':mode==='signup'?'Crear cuenta':'Entrar al panel'} <ArrowUpRight size={18}/></button></form>
      <button className="login-switch" onClick={()=>{setError('');onNotice('');setMode(mode==='login'?'signup':'login')}}>{mode==='login'?'¿Primera vez? Crear cuenta':'Ya tengo cuenta · Entrar'}</button>
      {error&&<p className="error" role="alert">{error}</p>}
      {error.includes('Confirma tu correo')&&<button className="login-switch" disabled={busy} onClick={()=>void resend()}>Reenviar correo de confirmación</button>}
      {notice&&<p className="login-notice" role="status">{notice}</p>}
    </div></div>
}

const kilos = (v:number) => `${v.toFixed(1).replace('.',',')} kg`;
/** Ni subir ni bajar es bueno o malo de por sí: solo se indica el sentido. */
const kiloChange = (from:number,to:number) => {const d=Math.round((to-from)*10)/10;return d===0?'Sin cambios':`${d>0?'+':'−'}${kilos(Math.abs(d))}`};

function WeightChart({entries}:{entries:Row[]}) {
  if(entries.length<2)return <Empty>Apunta al menos dos pesos para ver la gráfica.</Empty>;
  const width=600,height=190,pad=28,values=entries.map(e=>Number(e.kg));
  const min=Math.min(...values)-0.5,max=Math.max(...values)+0.5;
  const points=values.map((kg,i)=>[pad+i*(width-2*pad)/(values.length-1),height-pad-(kg-min)/(max-min)*(height-2*pad)]);
  return <svg className="weight-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolución del peso">
    <text x={4} y={pad}>{kilos(max-0.5)}</text><text x={4} y={height-pad+4}>{kilos(min+0.5)}</text>
    <polyline points={points.map(p=>p.join(',')).join(' ')}/>{points.map(([x,y],i)=><circle key={entries[i].date} cx={x} cy={y} r={4}><title>{`${entries[i].date}: ${kilos(values[i])}`}</title></circle>)}
  </svg>;
}

const MAX_MEMORY_LENGTH = 4000;
function MemorySection({content,save}:{content:string;save:(content:string)=>Promise<boolean>}) {
  const [draft,setDraft]=useState(content);
  useEffect(()=>setDraft(content),[content]);
  return <Card title="Tu memoria" aside={<span className="count">{draft.length}/{MAX_MEMORY_LENGTH}</span>}><form className="memory-form" onSubmit={e=>{e.preventDefault();void save(draft)}}><label className="sr-only" htmlFor="memory">Lo que sabe de ti</label><textarea id="memory" value={draft} maxLength={MAX_MEMORY_LENGTH} onChange={e=>setDraft(e.target.value)} placeholder="Cuéntale cosas de ti: a qué te dedicas, tu tesis, tus manías…"/><button className="primary" type="submit" disabled={draft===content}>Guardar</button></form></Card>;
}

function WeightSection({entries,save,remove}:{entries:Row[];save:(payload:object)=>Promise<boolean>;remove:(id:number)=>void}) {
  const [date,setDate]=useState(todayInMadrid()),[kg,setKg]=useState(''),[busy,setBusy]=useState(false);
  const ordered=[...entries].sort((a,b)=>a.date.localeCompare(b.date)), last=ordered.at(-1), previous=ordered.at(-2), first=ordered[0];
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);try{if(await save({date,kg:Number(kg.replace(',','.'))}))setKg('')}finally{setBusy(false)}}
  return <>
    <div className="summary-grid finance-metrics"><div className="metric balance-tile"><span>Último peso</span><strong>{last?kilos(Number(last.kg)):'—'}</strong><small>{last?last.date:'Sin registros'}</small></div><div className="metric"><span>Desde la vez anterior</span><strong>{last&&previous?kiloChange(Number(previous.kg),Number(last.kg)):'—'}</strong><small>{previous?`Desde el ${previous.date}`:'Necesitas dos registros'}</small></div><div className="metric"><span>Desde el principio</span><strong>{last&&first&&first!==last?kiloChange(Number(first.kg),Number(last.kg)):'—'}</strong><small>{first?`Desde el ${first.date}`:'Sin registros'}</small></div></div>
    <Card title="Apunta tu peso"><form className="stack-form" onSubmit={submit}><div className="form-row"><label>Fecha<input type="date" value={date} max={todayInMadrid()} onChange={e=>setDate(e.target.value)} required/></label><label>Peso (kg)<input inputMode="decimal" value={kg} placeholder="72,5" onChange={e=>setKg(e.target.value)} required pattern="[0-9]+([.,][0-9])?"/></label><button className="primary" type="submit" disabled={busy}><Plus size={17}/> Guardar</button></div><p className="form-hint">Una vez por semana basta, mejor a la misma hora. Si repites un día, se sustituye. También puedes decírselo al asistente: «peso 72,5».</p></form></Card>
    <Card title="Evolución" aside={<span className="count">{ordered.length} registros</span>}><WeightChart entries={ordered.slice(-20)}/>{[...ordered].reverse().map((r,i,list)=><div className="list-row" key={r.id}><span className="row-symbol mint"><Scale size={17}/></span><span className="row-main"><strong>{kilos(Number(r.kg))}</strong><small>{r.date}{list[i+1]?` · ${kiloChange(Number(list[i+1].kg),Number(r.kg))}`:''}</small></span><button className="delete icon-button" aria-label={`Eliminar el peso del ${r.date}`} onClick={()=>remove(r.id)}><Trash2 size={17}/></button></div>)}{!ordered.length&&<Empty>Apunta tu peso para empezar a ver cómo evoluciona.</Empty>}</Card>
  </>;
}

/** El banco describe los Bizum como «BIZUM A FAVOR DE <persona> CONCEPTO…» (enviados) o «BIZUM DE <persona> CONCEPTO…» (recibidos). */
function parseBizum(description:string):{person:string;concept:string}|null {
  const match=description.match(/^BIZUM\s+(?:A FAVOR DE|DE)\s+(.+?)(?:\s+CONCEPTO:?\s*(.*))?$/i);
  if(!match)return null;
  const concept=(match[2]??'').trim();
  return {person:match[1].trim(),concept:/^sin concepto$/i.test(concept)?'':concept};
}

function BizumCard({expenses,incomes,period}:{expenses:Row[];incomes:Row[];period:number}) {
  const bizums:Row[]=[...expenses.map(r=>({...r,sent:true})),...incomes.map(r=>({...r,sent:false}))]
    .map((r:Row):Row=>({...r,bizum:parseBizum(String(r.description??''))})).filter(r=>r.bizum)
    .sort((a,b)=>b.booking_date.localeCompare(a.booking_date));
  const total=(sent:boolean)=>bizums.filter(r=>r.sent===sent).reduce((n,r)=>n+Number(r.amount),0);
  return <Card title="Bizums" aside={<span className="count">Últimos {period} días</span>}>
    <div className="bizum-totals"><div><span>Enviados</span><strong>{euro(total(true))}</strong></div><div><span>Recibidos</span><strong className="positive">{euro(total(false))}</strong></div></div>
    {bizums.map((r,i)=><div className="list-row" key={`${r.sent}-${r.id}-${i}`}><span className={`row-symbol ${r.sent?'peach':'mint'}`}>{r.sent?<ArrowUpRight size={17}/>:<ArrowDownRight size={17}/>}</span><span className="row-main"><strong>{r.sent?'A':'De'} {r.bizum.person}</strong><small>{r.booking_date}{r.bizum.concept?` · ${r.bizum.concept}`:''}</small></span><strong className={r.sent?'':'positive'}>{r.sent?'−':'+'}{euro(Number(r.amount))}</strong></div>)}
    {!bizums.length&&<Empty>No hay Bizums en este periodo.</Empty>}
  </Card>;
}

// Mismos patrones que TOBACCO_PATTERNS del backend: el banco nombra los estancos «EXPENDEDURIA 16», «ESTANCO…» o «TABACOS…».
const isTobaccoShop=(description:string)=>/expendedur|estanc|tabac/i.test(description);

function TobaccoCard({expenses,period}:{expenses:Row[];period:number}) {
  const purchases=expenses.filter(r=>isTobaccoShop(String(r.description??''))).sort((a,b)=>b.booking_date.localeCompare(a.booking_date));
  const total=tobaccoTotal(purchases);
  return <Card title="Tabaco" aside={<span className="count">Últimos {period} días</span>}>
    <div className="bizum-totals"><div><span>Gastado en estancos</span><strong>{euro(total)}</strong></div><div><span>Compras</span><strong>{purchases.length}</strong></div></div>
    {purchases.map(r=><div className="list-row" key={r.id}><span className="row-symbol peach"><Cigarette size={17}/></span><span className="row-main"><strong>{String(r.description).replace(/^(PAGO MOVIL|TRANSACCION CONTACTLESS|COMPRA) EN /i,'').split(',')[0]}</strong><small>{r.booking_date}</small></span><strong>−{euro(Number(r.amount))}</strong></div>)}
    {!purchases.length&&<Empty>No has comprado en estancos en este periodo.</Empty>}
  </Card>;
}

// Una lata de energética cuesta 1,20 € en las alimentaciones: un pago de 1,20 € o 2,40 € (que no sea un Bizum) son una o
// dos latas. Las apuntadas a mano desde el chat llevan «ENERGÉTICA xN» y cuentan todas.
const ENERGY_DRINK_PRICE=1.2;
function energyDrinkCans(r:Row):number{
  const description=String(r.description??''),cans=Math.round(Number(r.amount)/ENERGY_DRINK_PRICE);
  if(/^ENERG[ÉE]TICA/i.test(description))return cans;
  return !/^BIZUM/i.test(description)&&[1,2].includes(cans)&&Math.abs(cans*ENERGY_DRINK_PRICE-Number(r.amount))<0.001?cans:0;
}
const tobaccoTotal=(expenses:Row[])=>expenses.filter(r=>isTobaccoShop(String(r.description??''))).reduce((n,r)=>n+Number(r.amount),0);

function EnergyDrinkCard({expenses,period}:{expenses:Row[];period:number}) {
  const purchases=expenses.filter(r=>energyDrinkCans(r)>0).sort((a,b)=>b.booking_date.localeCompare(a.booking_date));
  const cans=purchases.reduce((n,r)=>n+energyDrinkCans(r),0);
  return <Card title="Energéticas" aside={<span className="count">Últimos {period} días</span>}>
    <div className="bizum-totals"><div><span>Latas</span><strong>{cans}</strong></div><div><span>Gastado</span><strong>{euro(purchases.reduce((n,r)=>n+Number(r.amount),0))}</strong></div></div>
    {purchases.map(r=><div className="list-row" key={r.id}><span className="row-symbol mint"><CupSoda size={17}/></span><span className="row-main"><strong>{String(r.description).replace(/^(PAGO MOVIL|TRANSACCION CONTACTLESS|COMPRA) EN /i,'').split(',')[0]}</strong><small>{r.booking_date} · {energyDrinkCans(r)===1?'1 lata':`${energyDrinkCans(r)} latas`}</small></span><strong>−{euro(Number(r.amount))}</strong></div>)}
    {!purchases.length&&<Empty>No has comprado energéticas en este periodo.</Empty>}
  </Card>;
}

export function App(){
  const [token,setToken]=useState(''),[authReady,setAuthReady]=useState(false);
  const [section,setSection]=useState<Section>('overview'),[mobileOpen,setMobileOpen]=useState(false);
  const [data,setData]=useState<Record<string,any>>({}),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [period,setPeriod]=useState(30),[funnyLine,setFunnyLine]=useState('');
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{setToken(session?.access_token??'');setAuthReady(true)});
    void supabase.auth.getSession().then(({data:{session}})=>{setToken(session?.access_token??'');setAuthReady(true)});
    return ()=>subscription.unsubscribe();
  },[]);
  const refresh=useCallback(async(t=token)=>{
    if(!t)return;setLoading(true);setError('');
    const from=new Date(Date.now()-(period-1)*86400000).toISOString().slice(0,10);
    const results=await Promise.allSettled(resources.map(resource=>api(resource,t,'GET',undefined,resource==='expenses'||resource==='incomes'?{from}:undefined)));
    const next:Record<string,any>={};const failures:string[]=[];
    results.forEach((result,index)=>{if(result.status==='fulfilled')next[resources[index]]=result.value;else failures.push(`${resources[index]}: ${result.reason.message}`)});
    setData(next);setLoading(false);
    if(failures.length){
      setError(failures.join(' · '));
      if(results.every(r=>r.status==='rejected'&&[401,403].includes((r.reason as any).status))){
        const isPending=results.some(r=>r.status==='rejected'&&(r.reason as any).status===403);
        void supabase.auth.signOut();setToken('');
        setError(isPending?'Cuenta creada, pendiente de autorización. Avísanos con tu correo para activar el acceso.':'Tu sesión ha caducado. Entra de nuevo.');
      }
    }
  },[token,period]);
  useEffect(()=>{void refresh()},[refresh]);
  // La frase sorpresa es un extra: si Groq falla se queda el subtítulo de siempre, sin molestar con un aviso.
  useEffect(()=>{if(token)api('greeting',token).then(r=>setFunnyLine(String(r.text??''))).catch(e=>console.error('No se pudo inventar la frase',e))},[token]);
  async function action(resource:string,method:string,payload?:object,params?:Record<string,string>):Promise<boolean>{
    setNotice('');setError('');
    try{await api(resource,token,method,payload,params);setNotice('Cambios guardados.');await refresh();return true}
    catch(e){setError(e instanceof Error?e.message:'Error desconocido');return false}
  }
  function logout(){void supabase.auth.signOut();setToken('');setData({});setError('')}
  const rows=(key:string):Row[]=>Array.isArray(data[key])?data[key]:[];
  const expenses=rows('expenses'), incomes=rows('incomes'), budgets=rows('budgets');
  const totals=useMemo(()=>({spent:expenses.reduce((n,r)=>n+Number(r.amount),0),earned:incomes.reduce((n,r)=>n+Number(r.amount),0)}),[expenses,incomes]);
  const current=navigation.find(n=>n.id===section)!;
  if(!authReady)return <div className="login-screen"><div className="login-card">Cargando acceso…</div></div>;
  if(!token)return <LoginScreen onNotice={setNotice} error={error} notice={notice} setError={setError}/>;
  return <div className="shell"><aside className={`sidebar ${mobileOpen?'open':''}`}><div className="sidebar-top"><div className="identity"><img src={chatbotLogo} alt="Mi asistente"/><small>PANEL PERSONAL</small></div><button className="mobile-close icon-button" aria-label="Cerrar menú" onClick={()=>setMobileOpen(false)}><X/></button></div><nav aria-label="Navegación principal">{navigation.map(({id,label,icon:Icon})=><button key={id} className={section===id?'nav-item active':'nav-item'} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);setMobileOpen(false);setNotice('')}}><Icon size={19} strokeWidth={1.8}/>{label}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="status-dot"/>Conectado a tu asistente</div><button className="nav-item logout" onClick={logout}><LogOut size={18}/> Cerrar sesión</button></div></aside>{mobileOpen&&<div className="backdrop" onClick={()=>setMobileOpen(false)}/>}
  <div className="workspace"><header className="topbar"><button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={()=>setMobileOpen(true)}><Menu/></button><div className="breadcrumbs">Mi espacio <span>/</span> <strong>{current.label}</strong></div><button className="refresh icon-button" onClick={()=>void refresh()} disabled={loading} aria-label="Actualizar datos"><RefreshCw size={18} className={loading?'spin':''}/></button></header>
  <main className="content"><div className="page-heading"><div><div className="eyebrow">PANEL PERSONAL</div><h1>{section==='overview'?dailyGreeting():current.label}</h1><p>{section==='overview'?funnyLine||'Aquí tienes lo importante de un vistazo.':section==='memory'?'Lo que tu asistente sabe de ti. Lo usa para hablarte con gracia.':section==='finances'?'Tus ingresos, gastos y límites en un mismo lugar.':'Organiza y consulta tus cosas sin salir del panel.'}</p></div><span className="today">{new Intl.DateTimeFormat('es-ES',{dateStyle:'full',timeZone:'Europe/Madrid'}).format(new Date())}</span></div>
  {error&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Cerrar error"><X size={16}/></button></div>}{notice&&<div className="notice" role="status"><Check size={17}/>{notice}</div>}
  {section==='overview'&&<><AssistantChat token={token} onChange={()=>refresh()}/>
    <section className="dashboard-hero"><div><span className="hero-kicker">TU DÍA EN ORDEN</span><h2>Tu asistente, de un vistazo.</h2><p>Los números, recordatorios y próximos planes reunidos aquí.</p><div className="hero-actions"><button onClick={()=>setSection('finances')}>Ver finanzas <ArrowUpRight size={16}/></button><button onClick={()=>setSection('reminders')}>Mis recordatorios <Bell size={16}/></button></div></div><div className="hero-balance"><small>Balance · últimos {period} días</small><strong>{euro(totals.earned-totals.spent)}</strong><span>{expenses.length} movimientos · {rows('reminders').length} recordatorios</span></div></section>
    <div className="summary-grid overview-metrics"><div className="metric"><div className="metric-icon warm"><Wallet size={21}/></div><span>Balance del periodo</span><strong className={totals.earned-totals.spent>=0?'positive':'negative'}>{euro(totals.earned-totals.spent)}</strong><small>Ingresos menos gastos</small></div><div className="metric"><div className="metric-icon lilac"><Bell size={21}/></div><span>Recordatorios</span><strong>{rows('reminders').length}</strong><small>Pendientes</small></div><div className="metric"><div className="metric-icon peach"><ShoppingBasket size={21}/></div><span>Lista de la compra</span><strong>{rows('shopping_items').length}</strong><small>Productos por comprar</small></div><div className="metric"><div className="metric-icon mint"><Flame size={21}/></div><span>Hábitos</span><strong>{rows('habits').length}</strong><small>{rows('habit_checks').filter(r=>r.date===todayInMadrid()&&r.done).length} completados hoy</small></div><div className="metric"><div className="metric-icon peach"><Cigarette size={21}/></div><span>Tabaco</span><strong>{euro(tobaccoTotal(expenses))}</strong><small>Últimos {period} días</small></div><div className="metric"><div className="metric-icon mint"><CupSoda size={21}/></div><span>Energéticas</span><strong>{expenses.reduce((n,r)=>n+energyDrinkCans(r),0)}</strong><small>Latas · últimos {period} días</small></div></div>
    <div className="two-cols"><Card title="Próximos recordatorios" aside={<button className="text-link" onClick={()=>setSection('reminders')}>Ver todos →</button>}>{rows('reminders').length?rows('reminders').slice(0,4).map(r=><div className="list-row" key={r.id}><span className="row-symbol lilac"><Bell size={17}/></span><span className="row-main"><strong>{r.text}</strong><small>{dateTime(r.remind_at)}</small></span></div>):<Empty>No tienes recordatorios pendientes.</Empty>}</Card><Card title="En tu calendario" aside={<button className="text-link" onClick={()=>setSection('calendar')}>Ver calendario →</button>}>{data.calendar?.connected?data.calendar.events.length?data.calendar.events.slice(0,4).map((e:Row,i:number)=><div className="list-row" key={i}><span className="row-symbol mint"><CalendarDays size={17}/></span><span className="row-main"><strong>{e.title}</strong><small>{e.start?dateTime(e.start):e.date}</small></span></div>):<Empty>No hay eventos en los próximos días.</Empty>:<Empty>Conecta Google Calendar para ver tus eventos.</Empty>}</Card></div></>}
  {section==='finances'&&<><div className="section-toolbar"><div className="segmented" role="group" aria-label="Periodo de finanzas">{[7,30,90].map(p=><button key={p} className={period===p?'selected':''} aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p} días</button>)}</div></div><div className="summary-grid finance-metrics"><div className="metric income-tile"><span>Ingresos</span><strong className="positive">{euro(totals.earned)}</strong><small><ArrowUpRight size={14}/> En el periodo</small></div><div className="metric expense-tile"><span>Gastos</span><strong>{euro(totals.spent)}</strong><small><ArrowDownRight size={14}/> En el periodo</small></div><div className="metric balance-tile"><span>Balance</span><strong className={totals.earned-totals.spent>=0?'positive':'negative'}>{euro(totals.earned-totals.spent)}</strong><small>Ingresos − gastos</small></div></div><div className="bank-strip"><div><strong>{data.bank_connection?.connected?'Banco conectado':'Conecta tu banco'}</strong><p>{data.bank_connection?.connected?'Los movimientos se importan automáticamente cada día.':'Conecta tu cuenta para ver tus gastos e ingresos aquí.'}</p></div>{data.bank_connection?.connected?<button className="secondary" onClick={()=>{if(window.confirm('¿Desconectar el banco? Los movimientos importados se conservarán.'))void action('bank_connection','DELETE')}}>Desconectar</button>:<button className="primary" onClick={async()=>{try{const result=await api('bank_link',token,'POST',{});window.location.assign(result.url)}catch(e){setError(e instanceof Error?e.message:'No se pudo conectar')}}}>Conectar banco <ArrowUpRight size={17}/></button>}</div><div className="two-cols"><Card title="Análisis de gastos"><SpendingChart expenses={expenses} period={period}/></Card><TobaccoCard expenses={expenses} period={period}/></div><div className="two-cols"><EnergyDrinkCard expenses={expenses} period={period}/><BizumCard expenses={expenses} incomes={incomes} period={period}/></div><Card title="Presupuestos mensuales"><form className="budget-form" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void action('budgets','POST',{category:form.get('category'),monthly_limit:Number(form.get('limit'))});e.currentTarget.reset()}}><label>Categoría<select name="category" required>{['Total','Supermercado','Restaurantes','Transporte','Hogar','Suscripciones','Ocio','Salud','Compras','Otros'].map(c=><option key={c}>{c}</option>)}</select></label><label>Límite mensual (€)<input name="limit" type="number" min="0.01" step="0.01" required placeholder="200"/></label><button className="primary" type="submit">Guardar</button></form>{budgets.length?budgets.map((r:Row)=><div className="budget-item" key={r.budget.id}><div className="between"><strong>{r.budget.category}</strong><button className="delete icon-button" aria-label={`Quitar presupuesto de ${r.budget.category}`} onClick={()=>void action('budgets','DELETE',undefined,{category:r.budget.category})}><Trash2 size={16}/></button></div><p>{euro(r.spent)} de {euro(Number(r.budget.monthly_limit))}</p><div className="track"><span className={r.spent>=Number(r.budget.monthly_limit)?'over':''} style={{width:`${Math.min(100,r.spent/Number(r.budget.monthly_limit)*100)}%`}}/></div></div>):<Empty>Aún no has creado presupuestos.</Empty>}</Card><Card title="Movimientos recientes"><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Importe</th></tr></thead><tbody>{([...(expenses.map(r=>({...r,kind:'expense'}))),...(incomes.map(r=>({...r,kind:'income'})))] as Row[]).sort((a,b)=>b.booking_date.localeCompare(a.booking_date)).slice(0,25).map((r,i)=><tr key={`${r.kind}-${r.id}-${i}`}><td>{r.booking_date}</td><td>{r.description}</td><td>{r.kind==='income'?'Ingreso':r.category}</td><td className={r.kind==='income'?'positive':''}>{r.kind==='income'?'+':'−'}{euro(Number(r.amount))}</td></tr>)}</tbody></table>{!expenses.length&&!incomes.length&&<Empty>No hay movimientos en este periodo.</Empty>}</div></Card></>}
  {section==='reminders'&&<Card title="Tus recordatorios" aside={<span className="count">{rows('reminders').length} pendientes</span>}><ReminderForm save={payload=>action('reminders','POST',payload)}/>{rows('reminders').map(r=><div className="list-row" key={r.id}><span className="row-symbol lilac"><Bell size={17}/></span><span className="row-main"><strong>{r.text}</strong><small>{dateTime(r.remind_at)} {r.repeat?`· ${r.repeat}`:''} · Aviso {r.advance_minutes===1440?'un día':'30 min'} antes</small></span><button className="delete icon-button" aria-label={`Eliminar ${r.text}`} onClick={()=>void action('reminders','DELETE',undefined,{id:String(r.id)})}><Trash2 size={17}/></button></div>)}{!rows('reminders').length&&<Empty>Añade tu primer recordatorio arriba.</Empty>}</Card>}
  {section==='shopping_items'&&<Card title="Por comprar" aside={<span className="count">{rows('shopping_items').length} productos</span>}><InlineForm label="Añadir producto" placeholder="Añadir a la lista…" onSubmit={text=>action('shopping_items','POST',{text})}/>{rows('shopping_items').map(r=><div className="list-row" key={r.id}><button className="check-button" aria-label={`Marcar ${r.text} como comprado`} onClick={()=>void action('shopping_items','DELETE',undefined,{id:String(r.id)})}><Check size={16}/></button><span className="row-main"><strong>{r.text}</strong></span><button className="delete icon-button" aria-label={`Eliminar ${r.text}`} onClick={()=>void action('shopping_items','DELETE',undefined,{id:String(r.id)})}><Trash2 size={17}/></button></div>)}{!rows('shopping_items').length&&<Empty>Tu lista está vacía. Añade algo que necesites.</Empty>}</Card>}
  {section==='birthdays'&&<Card title="Cumpleaños" aside={<span className="count">{rows('birthdays').length} personas</span>}><form className="stack-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action('birthdays','POST',{name:f.get('name'),day:Number(f.get('day')),month:Number(f.get('month')),year:f.get('year')});e.currentTarget.reset()}}><div className="form-row"><label>Nombre<input name="name" required placeholder="Nombre"/></label><label>Día<input name="day" type="number" min="1" max="31" required placeholder="Día"/></label><label>Mes<select name="month">{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Intl.DateTimeFormat('es-ES',{month:'long'}).format(new Date(2024,i,1))}</option>)}</select></label><label>Año opcional<input name="year" type="number" min="1900" max="2100" placeholder="Año"/></label><button className="primary" type="submit"><Plus size={17}/> Añadir</button></div></form>{rows('birthdays').sort((a,b)=>a.month-b.month||a.day-b.day).map(r=><div className="list-row" key={r.id}><span className="row-symbol peach"><Cake size={18}/></span><span className="row-main"><strong>{r.name}</strong><small>{r.day} de {new Intl.DateTimeFormat('es-ES',{month:'long'}).format(new Date(2024,r.month-1,1))}{r.year?` · ${r.year}`:''}</small></span><button className="delete icon-button" aria-label={`Eliminar cumpleaños de ${r.name}`} onClick={()=>void action('birthdays','DELETE',undefined,{id:String(r.id)})}><Trash2 size={17}/></button></div>)}{!rows('birthdays').length&&<Empty>Añade un cumpleaños para que no se te pase.</Empty>}</Card>}
  {section==='habits'&&<Card title="Mis hábitos" aside={<span className="count">{rows('habits').length} hábitos</span>}><InlineForm label="Crear hábito" placeholder="Por ejemplo: leer 20 minutos…" onSubmit={name=>action('habits','POST',{name})}/>{rows('habits').map(r=>{const check=rows('habit_checks').find(c=>c.habit_id===r.id&&c.date===todayInMadrid());return <div className="list-row" key={r.id}><span className="row-symbol warm"><Flame size={18}/></span><span className="row-main"><strong>{r.name}</strong><small>{check?check.done?'Hecho hoy':'Pendiente hoy':'¿Lo has hecho hoy?'}</small></span><button className={`habit-answer ${check?.done?'done':''}`} aria-pressed={check?.done===true} onClick={()=>void action('habit_checks','POST',{habit_id:r.id,done:!check?.done})}>{check?.done?'Hecho':'Marcar hecho'}</button><button className="delete icon-button" aria-label={`Eliminar hábito ${r.name}`} onClick={()=>void action('habits','DELETE',undefined,{id:String(r.id)})}><Trash2 size={17}/></button></div>})}{!rows('habits').length&&<Empty>Empieza con un hábito pequeño que quieras mantener.</Empty>}</Card>}
  {section==='weight'&&<WeightSection entries={rows('weight_entries')} save={payload=>action('weight_entries','POST',payload)} remove={id=>void action('weight_entries','DELETE',undefined,{id:String(id)})}/>}
  {section==='calendar'&&<Card title="Próximos eventos" aside={data.calendar?.connected?<span className="connected"><span className="status-dot"/> Google conectado</span>:undefined}>{data.calendar?.connected?<><EventForm save={payload=>action('calendar','POST',payload)}/>{data.calendar.events.map((e:Row,i:number)=><div className="list-row" key={i}><span className="row-symbol mint"><CalendarDays size={18}/></span><span className="row-main"><strong>{e.title}</strong><small>{e.start?dateTime(e.start):`${e.date} · Todo el día`}</small></span></div>)}{!data.calendar.events.length&&<Empty>No hay eventos en los próximos 14 días.</Empty>}</>:<div className="connect-calendar"><CalendarDays size={34}/><h3>Tu agenda, aquí mismo</h3><p>Conecta Google Calendar para consultar tus próximos eventos y crear otros nuevos.</p><button className="primary" onClick={async()=>{try{const result=await api('calendar_link',token,'POST',{});window.location.assign(result.url)}catch(e){setError(e instanceof Error?e.message:'No se pudo conectar')}}}>Conectar Google Calendar <ArrowUpRight size={18}/></button></div>}</Card>}
  {section==='memory'&&<MemorySection content={String(data.memory?.content??'')} save={content=>action('memory','POST',{content})}/>}
  <footer>Tu asistente personal · Datos actualizados desde Supabase</footer></main></div></div>
}

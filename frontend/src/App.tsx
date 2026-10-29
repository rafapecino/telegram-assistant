import { LifePanels, DeliveriesPanel } from './LifePanels';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { LayoutDashboard, Wallet, Bell, ShoppingBasket, Cake, Flame, CalendarDays, LogOut, Plus, Trash2, RefreshCw, ArrowUpRight, ArrowDownRight, Menu, X, Check, AlertCircle, Send, Scale, Cigarette, CupSoda, Mic, Square, Brain, CloudSun, AlertTriangle, Settings, Download, ChevronLeft, ChevronRight, Newspaper, Search, TrendingUp, Lightbulb, Tag, FileText, Pencil } from 'lucide-react';
import { sectionFromSearch, sectionSearch, initialSection, readLastSection, rememberSection, type Section } from './navigation';
import { madridNow, nextHourInMadrid } from './form-time';
import {DataFreshness,FinanceInsights,NotesPanel,ProposalEditor,UndoTray,useUndoQueue} from './ExperiencePanels';
import {dayFocus,isDraftCandidate,type Draft} from './experience';
import {contextualGreeting} from './greetings';
import { selectHomeWeather } from './home-weather';
import chatbotLogo from './assets/chatbot-logo.png';

type Row = Record<string, any>;

// La clave publicable de Supabase está pensada para ir en el navegador; los permisos los decide panel-api.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://znzyzstvfqsrilhzyqub.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_8ryCdPQQEVxc2rZVWN0rDQ_5yPUskbh';
const apiUrl = import.meta.env.VITE_PANEL_API_URL ?? `${supabaseUrl}/functions/v1/panel-api`;
const supabase = createClient(supabaseUrl, supabaseKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});

// En el móvil, lo más usado queda al alcance del pulgar; el resto, en «Más».
const BOTTOM_NAV:Section[]=['overview','calendar','finances','news'];
const chartColors = ['#1779db','#f08143','#32ad91','#8a66d7','#e6b33e','#ea7091','#5277a6','#69b27b'];
const navigation: {id:Section; label:string; icon:typeof LayoutDashboard}[] = [
  {id:'overview',label:'Inicio',icon:LayoutDashboard},{id:'finances',label:'Finanzas',icon:Wallet},{id:'reminders',label:'Recordatorios',icon:Bell},
  {id:'shopping_items',label:'Lista de la compra',icon:ShoppingBasket},
  {id:'birthdays',label:'Cumpleaños',icon:Cake},{id:'habits',label:'Hábitos',icon:Flame},{id:'weight',label:'Peso',icon:Scale},{id:'calendar',label:'Agenda',icon:CalendarDays},{id:'weather',label:'Tiempo',icon:CloudSun},{id:'news',label:'Noticias',icon:Newspaper},{id:'markets',label:'Mercados',icon:TrendingUp},{id:'prices',label:'Precios',icon:Tag},
  {id:'notes',label:'Notas',icon:FileText},{id:'memory',label:'Memoria',icon:Brain},{id:'settings',label:'Ajustes',icon:Settings}
];
const NAV_GROUPS:{label:string;sections:Section[]}[]=[
  {label:'Mi día',sections:['overview','reminders','calendar','shopping_items','birthdays','habits','weight']},
  {label:'Consultas',sections:['finances','weather','news','markets','prices']},
  {label:'Mi asistente',sections:['notes','memory','settings']}
];
const resources = ['expenses','incomes','budgets','reminders','shopping_items','birthdays','habits','habit_checks','weight_entries','calendar','bank_connection','memory','weather','weather_alerts','debt_settlements'] as const;
const euro = (v:number) => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(v);
const dateTime = (v:string) => new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(v));
const todayInMadrid = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date());

async function api(resource:string, token:string, method='GET', data?:object, params?:Record<string,string>, isRetry=false):Promise<any> {
  const url = new URL(apiUrl); url.searchParams.set('resource',resource);
  Object.entries(params??{}).forEach(([key,value])=>url.searchParams.set(key,value));
  let response:Response;
  try{response = await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})}
  catch{throw Object.assign(new Error('No hay conexión con el asistente. Revisa tu conexión a internet y vuelve a intentarlo.'),{status:0})}
  const result = await response.json().catch(()=>({}));
  // Un 429 sin mensaje nuestro es el límite de Supabase para ráfagas: se espera un momento y se reintenta una vez.
  if (response.status===429&&!result.error&&!isRetry){await new Promise(resolve=>setTimeout(resolve,1500));return api(resource,token,method,data,params,true)}
  if (!response.ok) throw Object.assign(new Error(result.error??(response.status===429?'Demasiadas peticiones a la vez. Espera un momento y reintenta.':'No se pudo conectar con el asistente.')),{status:response.status});
  return result;
}
/** Sin conexión o con un fallo del servidor tiene sentido reintentar; con un dato no válido, no. */
const isRetryable=(error:unknown)=>{const status=(error as {status?:number}).status;return status===0||(status??0)>=500};

function Card({title,aside,children,className=''}:{title:ReactNode;aside?:ReactNode;children:ReactNode;className?:string}) {return <section className={`card ${className}`}><div className="card-heading"><h2>{title}</h2>{aside}</div>{children}</section>}
function SectionLink({target,goTo,className,children}:{target:Section;goTo:(section:Section)=>void;className?:string;children:ReactNode}) {
  return <a href={sectionSearch(window.location.search,target)} className={className} onClick={e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();goTo(target)}}>{children}</a>;
}
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
  const [when,setWhen]=useState(nextHourInMadrid),[busy,setBusy]=useState(false);
  const {date,time}=when;
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const form=e.currentTarget,data=new FormData(form);setBusy(true);
    try{if(await save({text:data.get('text'),local_datetime:`${date}T${time}`,repeat:data.get('repeat')||null,advance_minutes:data.get('advance')?Number(data.get('advance')):null})){form.reset();setWhen(nextHourInMadrid())}}
    finally{setBusy(false)}
  }
  return <form className="stack-form" onSubmit={submit}><input name="text" required maxLength={500} placeholder="¿Qué quieres recordar?" aria-label="Texto del recordatorio"/>
    <div className="form-row"><label>Fecha<input type="date" value={date} onChange={e=>setWhen({...when,date:e.target.value})} required/></label><label>Hora<input type="time" value={time} onChange={e=>setWhen({...when,time:e.target.value})} required/></label>
    <label>Repetición<select name="repeat"><option value="">Una vez</option><option value="daily">Cada día</option><option value="weekdays">Lunes a viernes</option><option value="weekly">Cada semana</option><option value="monthly">Cada mes</option></select></label>
    <label>Aviso previo<select name="advance"><option value="">Automático</option><option value="30">30 minutos antes</option><option value="1440">Un día antes</option></select></label>
    <button className="primary" type="submit" disabled={busy}><Plus size={17}/> Crear recordatorio</button></div>
    <p className="form-hint">Proponemos la próxima hora en punto (hora de Madrid). Revisa la fecha y la hora antes de guardar.</p></form>
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

const DAY_MS = 86_400_000;

// Los enlaces de autorización (banco, Google) llegan en el texto: se abren en otra pestaña para no perder el panel.
function linkify(text:string):ReactNode[]{
  return text.split(/(https?:\/\/\S+)/).map((part,i)=>i%2?<a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>:part);
}

// Los mensajes guardados vuelven sin botones: los de una respuesta antigua ya no valdrían.
type ChatMessage = {role:'user'|'assistant'; text:string; buttons?:{text:string;callback_data:string}[][]};
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
  const [messages,setMessages]=useState<ChatMessage[]>([]),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[chatError,setChatError]=useState(''),[proposal,setProposal]=useState<Draft|null>(null),[proposalNotice,setProposalNotice]=useState('');
  const chatLog=useRef<HTMLDivElement>(null),recorder=useRef<MediaRecorder|null>(null),[recording,setRecording]=useState(false);
  // Desplaza solo el historial: scrollIntoView también arrastraba la página de Inicio.
  useEffect(()=>{const log=chatLog.current;if(log)log.scrollTop=log.scrollHeight},[messages,busy]);
  // La conversación se guarda en el servidor: al volver al panel sigue donde se dejó.
  useEffect(()=>{api('chat_messages',token).then(setMessages).catch(e=>setChatError(e instanceof Error?e.message:'No se pudo cargar la conversación.'))},[token]);
  // Tras cada respuesta se relee la conversación: un «sí» escrito o un botón también cambian la pregunta que contestan.
  async function ask(payload:object){
    setBusy(true);setChatError('');
    try{await api('chat',token,'POST',payload);setMessages(await api('chat_messages',token));await onChange()}
    catch(e){setChatError(e instanceof Error?e.message:'No se pudo hablar con el asistente.')}
    finally{setBusy(false)}
  }
  async function send(text:string){
    const message=text.trim();if(!message||busy)return;
    setBusy(true);setChatError('');setProposalNotice('');
    try{if(isDraftCandidate(message)){const prepared=await api('chat_draft',token,'POST',{message});
      if(prepared.proposal){setProposal(prepared.proposal);setDraft('');return}}
      setDraft('');setMessages(m=>[...m,{role:'user',text:message}]);await ask({message});
    }catch(e){setChatError(e instanceof Error?e.message:'No se pudo preparar el mensaje. No se ha enviado.')}finally{setBusy(false)}
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
  async function press(data:string){await ask({button:data})}
  async function clear(){
    setChatError('');
    try{await api('chat_messages',token,'DELETE');setMessages([])}
    catch(e){setChatError(e instanceof Error?e.message:'No se pudo borrar la conversación.')}
  }
  return <><Card title="Pregúntale a tu asistente" aside={messages.length?<button className="text-link" onClick={()=>void clear()} disabled={busy}>Nueva conversación</button>:undefined} className="chat-card">
    <div ref={chatLog} className="chat-log" aria-live="polite">
      {!messages.length&&<div className="chat-welcome"><img className="chat-avatar large" src={chatbotLogo} alt=""/><p>Dime, que para eso estoy.</p></div>}
      {messages.map((m,i)=><div key={i} className={`chat-row ${m.role}`}>{m.role==='assistant'&&<img className="chat-avatar" src={chatbotLogo} alt=""/>}<div className={`chat-message ${m.role}`}><p>{linkify(m.text)}</p>{m.buttons&&<div className="chat-buttons">{m.buttons.flat().map(b=><button key={b.callback_data} className="secondary" onClick={()=>void press(b.callback_data)} disabled={busy}>{b.text}</button>)}</div>}</div></div>)}
      {busy&&<div className="chat-row assistant"><img className="chat-avatar" src={chatbotLogo} alt=""/><div className="chat-message assistant typing"><p>Pensando…</p></div></div>}
    </div>
    {proposalNotice&&<p className="inline-success" role="status">{proposalNotice}</p>}
    {chatError&&<p className="error" role="alert">{chatError}</p>}
    <form className="inline-form chat-form" onSubmit={e=>{e.preventDefault();void send(draft)}}><label className="sr-only" htmlFor="chat-input">Mensaje para el asistente</label><input id="chat-input" value={draft} maxLength={1000} placeholder={recording?'Grabando… pulsa ■ para enviar':'Escribe un mensaje…'} disabled={recording} onChange={e=>setDraft(e.target.value)} autoComplete="off"/><button className={`icon-button ${recording?'primary recording':'secondary'}`} type="button" onClick={()=>void toggleRecording()} disabled={busy} aria-label={recording?'Parar y enviar la nota de voz':'Grabar una nota de voz'}>{recording?<Square size={16}/>:<Mic size={18}/>}</button><button className="primary icon-button" type="submit" disabled={busy||recording||!draft.trim()} aria-label="Enviar mensaje"><Send size={18}/></button></form>
  </Card>{proposal&&<ProposalEditor draft={proposal} api={(r,m,d,p)=>api(r,token,m,d,p)} onClose={()=>setProposal(null)} onSaved={async()=>{setProposalNotice('Guardado. Puedes verlo en su sección.');await onChange()}}/>}</>;
}

const ALERT_LEVEL_EMOJI:Record<string,string>={amarillo:'🟡',naranja:'🟠',rojo:'🔴'};
// Mismos grupos que describeWeatherCode del servidor (códigos WMO de Open-Meteo).
function weatherEmoji(code:number):string{
  if(code===0)return '☀️';if(code<=2)return '🌤️';if(code===3)return '☁️';if(code===45||code===48)return '🌫️';
  if(code>=71&&code<=77||code===85||code===86)return '❄️';if(code>=95)return '⛈️';if(code>=51)return '🌧️';return '🌥️';
}
const weekday=(date:string)=>new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));
function dayLabel(date:string){const today=todayInMadrid();if(date===today)return 'Hoy';if(date===new Date(Date.parse(`${today}T00:00:00Z`)+DAY_MS).toISOString().slice(0,10))return 'Mañana';const name=weekday(date);return name.charAt(0).toUpperCase()+name.slice(1)}
const rainText=(day:Row)=>day.rainProbability!=null?` · ${day.rainProbability} % lluvia`:'';

/** Solo el lugar que toca hoy, sin mostrar una previsión de otro día o ubicación. */
function TodayWeather({forecasts,alerts,goTo,date=todayInMadrid()}:{forecasts:Row[];alerts:Row[];goTo:(section:Section)=>void;date?:string}) {
  const {place,day}=selectHomeWeather(forecasts as {place:string;days:(Row & {date:string})[]}[],date);
  return <div className="today-weather-wrap"><SectionLink target="weather" goTo={goTo} className="today-weather">
    <span className="today-weather-icon" aria-hidden="true">{day?weatherEmoji(Number(day.code)):'🌤️'}</span>
    <span><strong>{place}</strong><small>{day?`${day.description??'Previsión'}${rainText(day)}`:`Previsión de ${date===todayInMadrid()?'hoy':'mañana'} no disponible`}</small></span>
    {day&&<strong className="today-weather-temperature">{Math.round(Number(day.min))}° / {Math.round(Number(day.max))}°</strong>}<ArrowUpRight size={16} aria-hidden="true"/>
  </SectionLink>{alerts.length>0&&<SectionLink target="weather" goTo={goTo} className="today-weather-alert"><AlertTriangle size={16} aria-hidden="true"/>{alerts.length===1?'Hay un aviso meteorológico':'Hay avisos meteorológicos'} · Ver detalles</SectionLink>}</div>;
}

function WeatherSection({forecasts,alerts}:{forecasts?:Row[];alerts?:Row[]}) {
  return <>
    <Card title="Avisos de AEMET">{alerts?alerts.length?alerts.map(a=><div className="list-row" key={a.id}><span className="row-symbol peach"><AlertTriangle size={17}/></span><span className="row-main"><strong>{ALERT_LEVEL_EMOJI[a.level]} {a.event}</strong><small>{a.zone} · {dateTime(a.onset)} – {dateTime(a.expires)}</small></span></div>):<Empty>Sin avisos en la Comunidad de Madrid.</Empty>:<Empty>No he podido consultar los avisos de AEMET.</Empty>}</Card>
    {forecasts?<div className="two-cols">{forecasts.map(f=><Card key={f.place} title={f.place}>{f.days.map((day:Row)=><div className="list-row" key={day.date}><span className="row-symbol warm weather-emoji">{weatherEmoji(day.code)}</span><span className="row-main"><strong>{dayLabel(day.date)}</strong><small>{day.description}{rainText(day)}</small></span><strong className="weather-temps">{Math.round(day.min)}° / {Math.round(day.max)}°</strong></div>)}</Card>)}</div>:<Card title="Previsión"><Empty>No he podido consultar la previsión.</Empty></Card>}
  </>;
}

function LoginScreen({error,setError}:{error:string;setError:(text:string)=>void}) {
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    const {error:authError}=await supabase.auth.signInWithPassword({email,password});
    setBusy(false);setPassword('');
    if(authError)setError('No se pudo iniciar sesión. Revisa el correo y la contraseña.');
  }
  // Sin registro: el panel es de una sola persona y su cuenta ya existe.
  return <div className="login-screen"><div className="login-intro"><img src={chatbotLogo} alt="Mi asistente"/><span className="eyebrow">TU ESPACIO PERSONAL</span><h1>Un lugar para tenerlo <em>todo claro.</em></h1><p>Finanzas, agenda y tareas. Tu información real, organizada en un panel fácil de consultar.</p><div className="login-pills"><span>Finanzas</span><span>Recordatorios</span><span>Agenda</span></div></div>
    <div className="login-card"><span className="eyebrow">ACCESO SEGURO</span><h2>Bienvenido de nuevo</h2><p>Entra con tu correo y contraseña para ver tu dashboard.</p>
      <form onSubmit={submit}><label htmlFor="email">Correo electrónico</label><input id="email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="tu@correo.com"/><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Tu contraseña"/><button className="primary full" disabled={busy}>{busy?'Un momento…':'Entrar al panel'} <ArrowUpRight size={18}/></button></form>
      {error&&<p className="error" role="alert">{error}</p>}
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

const dayMonthYear=(v:string)=>new Intl.DateTimeFormat('es-ES',{dateStyle:'long',timeZone:'Europe/Madrid'}).format(new Date(v));

/** Descarga un objeto como fichero .json sin pasar por el servidor otra vez. */
function downloadJson(data:unknown,fileName:string){
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  link.download=fileName;link.click();URL.revokeObjectURL(link.href);
}

function SettingsSection({token,onChange}:{token:string;onChange:()=>Promise<void>}) {
  const [accounts,setAccounts]=useState<Row|null>(null),[summary,setSummary]=useState<Row[]|null>(null);
  const [selected,setSelected]=useState<string[]>([]),[confirmText,setConfirmText]=useState('');
  const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[problem,setProblem]=useState('');
  // Se pide al abrir la sección y no con el resto del panel: consulta a Google qué permisos tiene.
  const load=useCallback(async()=>{
    const [loadedAccounts,loadedSummary]=await Promise.allSettled([api('connected_accounts',token),api('data_summary',token)]);
    if(loadedAccounts.status==='fulfilled')setAccounts(loadedAccounts.value);else setProblem(loadedAccounts.reason.message);
    if(loadedSummary.status==='fulfilled')setSummary(loadedSummary.value);else setProblem(current=>current||loadedSummary.reason.message);
  },[token]);
  useEffect(()=>{void load()},[load]);
  async function run(task:string,work:()=>Promise<string>){
    setBusy(task);setMessage('');setProblem('');
    try{setMessage(await work());await load();await onChange()}
    catch(e){setProblem(e instanceof Error?e.message:'No se pudo completar. Inténtalo de nuevo.')}
    finally{setBusy('')}
  }
  async function connect(resource:'calendar_link'|'bank_link'){
    setBusy(resource);setProblem('');
    try{window.location.assign((await api(resource,token,'POST',{})).url)}
    catch(e){setProblem(e instanceof Error?e.message:'No se pudo preparar la conexión.');setBusy('')}
  }
  function disconnect(resource:'google_connection'|'bank_connection',warning:string){
    if(!window.confirm(warning))return;
    void run(resource,async()=>{await api(resource,token,'DELETE');return resource==='google_connection'?'Google desconectado: he retirado el permiso del calendario y de Gmail.':'Banco desconectado: he pedido al banco que retire el permiso.'});
  }
  const exportData=()=>run('export',async()=>{downloadJson(await api('data_export',token),`mi-asistente-${todayInMadrid()}.json`);return 'Copia descargada.'});
  const deleteData=()=>run('delete',async()=>{
    const result=await api('personal_data',token,'DELETE',undefined,{categories:selected.join(','),confirm:'BORRAR'});
    setSelected([]);setConfirmText('');return `Borrado: ${result.deleted.join(', ')}.`;
  });
  const chosen=(summary??[]).filter(c=>selected.includes(c.id)), canDelete=chosen.length>0&&confirmText.trim().toUpperCase()==='BORRAR';
  const google=accounts?.google, bank:Row[]=accounts?.bank??[];
  return <>
    {problem&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{problem}</span></div>}
    {message&&<div className="notice" role="status"><Check size={17}/>{message}</div>}
    <div className="two-cols">
      <Card title="Google" aside={google?.connected?<span className="connected"><span className="status-dot"/> Conectado</span>:undefined}>
        {!accounts?<Empty>Cargando…</Empty>:google?.connected?<>
          <p className="settings-text">Conectado desde el {dayMonthYear(google.since)}.</p>
          {google.problem?<p className="error">{google.problem}</p>:<><p className="settings-text"><strong>Permisos concedidos:</strong></p><ul className="settings-list">{google.permissions.map((p:string)=><li key={p}>{p}</li>)}</ul></>}
          <button className="secondary danger" disabled={!!busy} onClick={()=>disconnect('google_connection','Desconectar Google retira en Google el permiso del calendario y de Gmail. Dejaré de ver tus eventos y tu correo. ¿Seguro?')}>Desconectar Google</button>
        </>:<><p className="settings-text">Sin conectar. Al conectarlo podré ver y crear eventos del calendario y leer el remitente y el asunto de tus correos.</p><button className="primary" disabled={!!busy} onClick={()=>void connect('calendar_link')}>Conectar Google <ArrowUpRight size={16}/></button></>}
      </Card>
      <Card title="Banco" aside={bank.length?<span className="connected"><span className="status-dot"/> Conectado</span>:undefined}>
        {!accounts?<Empty>Cargando…</Empty>:bank.length?<>
          {bank.map((access,i)=><p className="settings-text" key={i}>{access.accounts===1?'1 cuenta':`${access.accounts} cuentas`} · {new Date(access.validUntil)>new Date()?`acceso hasta el ${dayMonthYear(access.validUntil)}`:`el acceso caducó el ${dayMonthYear(access.validUntil)}`}.</p>)}
          <p className="settings-text"><strong>Permisos concedidos:</strong></p><ul className="settings-list"><li>Leer los movimientos y el saldo (no puede hacer pagos)</li></ul>
          <button className="secondary danger" disabled={!!busy} onClick={()=>disconnect('bank_connection','Desconectar el banco cierra el acceso en Enable Banking y pide al banco que retire el permiso. Dejaré de importar tus gastos; los que ya tengo se quedan. ¿Seguro?')}>Desconectar banco</button>
        </>:<><p className="settings-text">Sin conectar. Al conectarlo importaré tus gastos e ingresos cada día.</p><button className="primary" disabled={!!busy} onClick={()=>void connect('bank_link')}>Conectar banco <ArrowUpRight size={16}/></button></>}
      </Card>
    </div>
    <Card title="Descargar mis datos">
      <p className="settings-text">Un fichero .json con todo lo que guarda el asistente: finanzas, recordatorios, notas, hábitos, memoria y conversación. No incluye las claves de conexión con Google ni con el banco.</p>
      <button className="secondary" disabled={!!busy} onClick={()=>void exportData()}><Download size={16}/> {busy==='export'?'Preparando…':'Descargar copia'}</button>
    </Card>
    <Card title="Borrar datos">
      <p className="settings-text">Elige qué quieres borrar. Se borra para siempre y no se puede deshacer, así que descarga antes una copia si la quieres. Las conexiones con Google y el banco se quitan desde arriba.</p>
      {!summary?<Empty>Cargando…</Empty>:<fieldset className="delete-choices"><legend className="sr-only">Datos que se borrarán</legend>
        {summary.map(c=><label key={c.id} className="checkbox-row"><input type="checkbox" checked={selected.includes(c.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,c.id]:current.filter(id=>id!==c.id))}/><span>{c.label}</span><small>{c.count} {c.count===1?'registro':'registros'}</small></label>)}
        <button type="button" className="text-link" onClick={()=>setSelected(selected.length===summary.length?[]:summary.map(c=>c.id))}>{selected.length===summary.length?'Quitar todo':'Seleccionar todo'}</button>
      </fieldset>}
      {chosen.length>0&&<div className="delete-summary">
        <p><strong>Se borrará para siempre:</strong></p>
        <ul className="settings-list">{chosen.map(c=><li key={c.id}>{c.label} ({c.count} {c.count===1?'registro':'registros'})</li>)}</ul>
        {selected.includes('finances')&&bank.length>0&&<p>El banco sigue conectado: los movimientos de los últimos días se volverán a importar en la próxima sincronización.</p>}
        <form onSubmit={e=>{e.preventDefault();if(canDelete)void deleteData()}}>
          <label className="settings-text" htmlFor="confirm-delete">Escribe <strong>BORRAR</strong> para confirmar</label>
          <div className="form-row"><input id="confirm-delete" value={confirmText} onChange={e=>setConfirmText(e.target.value)} autoComplete="off"/><button className="primary danger-fill" disabled={!canDelete||!!busy}>{busy==='delete'?'Borrando…':'Borrar para siempre'}</button></div>
        </form>
      </div>}
    </Card>
  </>;
}

type AddType='reminder'|'expense'|'income'|'event'|'habit'|'note';
const ADD_TYPES:{id:AddType;label:string}[]=[{id:'reminder',label:'Recordatorio'},{id:'expense',label:'Gasto'},{id:'income',label:'Ingreso'},{id:'event',label:'Evento'},{id:'habit',label:'Hábito'},{id:'note',label:'Nota'}];
const ADD_DONE:Record<AddType,string>={reminder:'Recordatorio creado.',expense:'Gasto apuntado.',income:'Ingreso apuntado.',event:'Evento creado en tu calendario.',habit:'Hábito creado.',note:'Nota guardada.'};
const madridDateOf=(v:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date(v));
// 1 = lunes … 7 = domingo, como scheduled_days en el servidor.
const isoWeekday=(date:string)=>new Date(`${date}T12:00:00Z`).getUTCDay()||7;

function MoneyForm({kind,categories,save}:{kind:'expense'|'income';categories:string[];save:(data:object)=>Promise<boolean>}) {
  const [amount,setAmount]=useState(''),[description,setDescription]=useState(''),[category,setCategory]=useState(''),[date,setDate]=useState(todayInMadrid),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);try{await save({amount:amount.replace(',','.'),description,date,...(kind==='expense'?{category}:{})})}finally{setBusy(false)}}
  return <form className="stack-form" onSubmit={submit}><div className="form-row">
    <label>Importe (€)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required pattern="[0-9]+([.,][0-9]{1,2})?" placeholder="12,50" autoFocus/></label>
    <label>Descripción<input value={description} onChange={e=>setDescription(e.target.value)} required maxLength={200} placeholder={kind==='expense'?'Cena con amigos':'Bizum de Ana'}/></label>
    {kind==='expense'&&<label>Categoría<select value={category} onChange={e=>setCategory(e.target.value)} required><option value="">Elige…</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>}
    <label>Fecha<input type="date" value={date} max={todayInMadrid()} onChange={e=>setDate(e.target.value)} required/></label>
    <button className="primary" type="submit" disabled={busy}><Plus size={17}/> {busy?'Guardando…':kind==='expense'?'Apuntar gasto':'Apuntar ingreso'}</button>
  </div></form>;
}

const ALL_DAYS=[1,2,3,4,5,6,7];
const DAY_INITIALS=['L','M','X','J','V','S','D'];
const pad2=(n:number)=>String(n).padStart(2,'0');
const addDays=(date:string,days:number)=>new Date(Date.parse(`${date}T12:00:00Z`)+days*DAY_MS).toISOString().slice(0,10);
const mondayOf=(date:string)=>addDays(date,1-isoWeekday(date));
const shortDay=(date:string)=>new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
const longDay=(date:string)=>new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
const timeOf=(v:string)=>new Intl.DateTimeFormat('es-ES',{timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(v));

/** Siguiente vez de un recordatorio que se repite, con las mismas reglas que el servidor (reminders.ts). */
function nextRepeat(date:string,repeat:string,monthDay:number):string{
  if(repeat==='daily')return addDays(date,1);
  if(repeat==='weekly')return addDays(date,7);
  if(repeat==='weekdays'){let next=addDays(date,1);while(isoWeekday(next)>5)next=addDays(next,1);return next}
  const [year,month]=date.split('-').map(Number),nextYear=month===12?year+1:year,nextMonth=month%12+1;
  return `${nextYear}-${pad2(nextMonth)}-${pad2(Math.min(monthDay,new Date(Date.UTC(nextYear,nextMonth,0)).getUTCDate()))}`;
}
/** Días entre `from` y `to` en los que salta un recordatorio, contando sus repeticiones. */
function reminderDates(reminder:Row,from:string,to:string):string[]{
  const first=madridDateOf(reminder.remind_at),dates:string[]=[];
  if(!reminder.repeat)return first>=from&&first<=to?[first]:[];
  for(let date=first,count=0;date<=to&&count<400;date=nextRepeat(date,reminder.repeat,Number(first.slice(8))),count++){if(date>=from)dates.push(date)}
  return dates;
}

type HabitStatus='done'|'missed'|'unanswered'|'pending'|'upcoming'|'rest'|'before';
const HABIT_STATUS:Record<HabitStatus,{label:string;mark:string}>={done:{label:'Hecho',mark:'✓'},missed:{label:'No hecho',mark:'✗'},unanswered:{label:'Sin apuntar',mark:'?'},pending:{label:'Pendiente hoy',mark:'·'},upcoming:{label:'Toca',mark:''},rest:{label:'Descanso',mark:''},before:{label:'Aún no existía',mark:''}};
/** Los días de descanso no cuentan ni como fallo ni para la racha. */
function habitStatus(habit:Row,checks:Row[],date:string,today:string):HabitStatus{
  if(habit.created_at&&date<madridDateOf(habit.created_at))return 'before';
  if(!(habit.scheduled_days??ALL_DAYS).includes(isoWeekday(date)))return 'rest';
  if(date>today)return 'upcoming';
  const check=checks.find(c=>c.habit_id===habit.id&&c.date===date);
  if(check)return check.done?'done':'missed';
  return date===today?'pending':'unanswered';
}
/** Racha actual (como en el servidor: hoy cuenta si ya está apuntado), mejor racha y % de las últimas 4 semanas. */
function habitStats(habit:Row,checks:Row[],today:string){
  const statusOf=(date:string)=>habitStatus(habit,checks,date,today);
  let current=0;
  for(let date=statusOf(today)==='done'||statusOf(today)==='missed'?today:addDays(today,-1),i=0;i<366;date=addDays(date,-1),i++){
    const status=statusOf(date);if(status==='rest')continue;if(status!=='done')break;current++;
  }
  let best=0,run=0,done=0,counted=0;
  for(let date=addDays(today,-119);date<=today;date=addDays(date,1)){
    const status=statusOf(date);if(status==='rest'||status==='before'||status==='pending')continue;
    run=status==='done'?run+1:0;best=Math.max(best,run);
    if(date>addDays(today,-28)){counted++;if(status==='done')done++}
  }
  return {current,best,percent:counted?Math.round(done/counted*100):null};
}

function HabitsSection({habits,checks,action}:{habits:Row[];checks:Row[];action:(resource:string,method:string,payload?:object,params?:Record<string,string>,done?:string)=>Promise<boolean>}) {
  const today=todayInMadrid(),thisMonday=mondayOf(today),oldest=addDays(today,-120);
  const weeks=[0,1,2,3].map(n=>addDays(thisMonday,-7*n));
  const weekName=(n:number)=>n===0?'Esta semana':n===1?'Semana pasada':`Hace ${n} semanas`;
  function toggleDay(habit:Row,day:number){
    const days:number[]=habit.scheduled_days??ALL_DAYS,next=days.includes(day)?days.filter(d=>d!==day):[...days,day].sort();
    if(next.length)void action('habits','POST',{id:habit.id,scheduled_days:next},undefined,'Días guardados.');
  }
  return <Card title="Mis hábitos" aside={<span className="count">{habits.length} hábitos</span>}>
    <InlineForm label="Crear hábito" placeholder="Por ejemplo: leer 20 minutos…" onSubmit={name=>action('habits','POST',{name},undefined,'Hábito creado.')}/>
    <p className="habit-legend" aria-hidden="true">{(['done','missed','unanswered','rest'] as HabitStatus[]).map(status=><span key={status}><span className={`habit-cell ${status}`}>{HABIT_STATUS[status].mark}</span> {HABIT_STATUS[status].label}</span>)}</p>
    {habits.map(habit=>{const stats=habitStats(habit,checks,today),days:number[]=habit.scheduled_days??ALL_DAYS;return <article className="habit-block" key={habit.id} aria-label={habit.name}>
      <div className="habit-head"><span className="row-symbol warm"><Flame size={18}/></span><div className="row-main"><strong>{habit.name}</strong><small>Racha: {stats.current} {stats.current===1?'día':'días'} · Mejor: {stats.best} · Últimas 4 semanas: {stats.percent===null?'—':`${stats.percent} %`}</small></div><button className="delete icon-button" aria-label={`Eliminar hábito ${habit.name}`} onClick={()=>{if(window.confirm(`¿Eliminar «${habit.name}» y todo su historial?`))void action('habits','DELETE',undefined,{id:String(habit.id)},'Hábito eliminado.')}}><Trash2 size={17}/></button></div>
      <div className="habit-days" role="group" aria-label={`Días en que toca ${habit.name}`}>{DAY_INITIALS.map((initial,i)=><button key={initial} className={days.includes(i+1)?'selected':''} aria-pressed={days.includes(i+1)} disabled={days.length===1&&days.includes(i+1)} title={days.length===1&&days.includes(i+1)?'Tiene que tocar al menos un día':undefined} onClick={()=>toggleDay(habit,i+1)}><span aria-hidden="true">{initial}</span><span className="sr-only">{['lunes','martes','miércoles','jueves','viernes','sábado','domingo'][i]}</span></button>)}</div>
      {weeks.map((monday,n)=><div className="habit-week" key={monday}><span className="habit-week-name">{weekName(n)}</span><div className="habit-cells">{Array.from({length:7},(_,i)=>{const date=addDays(monday,i),status=habitStatus(habit,checks,date,today),canMark=date<=today&&date>=oldest&&status!=='rest'&&status!=='before';const label=`${longDay(date)}: ${HABIT_STATUS[status].label}`;
        return canMark?<button key={date} className={`habit-cell ${status}`} aria-label={`${label}. Pulsa para marcar como ${status==='done'?'no hecho':'hecho'}`} title={label} onClick={()=>void action('habit_checks','POST',{habit_id:habit.id,date,done:status!=='done'},undefined,status==='done'?'Marcado como no hecho.':'Hábito apuntado. ¡Bien!')}>{HABIT_STATUS[status].mark}</button>:<span key={date} className={`habit-cell ${status}`} role="img" aria-label={label} title={label}>{HABIT_STATUS[status].mark}</span>})}</div></div>)}
    </article>})}
    {!habits.length&&<Empty>Empieza con un hábito pequeño que quieras mantener.</Empty>}
  </Card>;
}

type AgendaItem={kind:'event'|'reminder'|'habit';title:string;time:string|null;status?:HabitStatus};
const AGENDA_KINDS={event:{label:'Evento',Icon:CalendarDays},reminder:{label:'Recordatorio',Icon:Bell},habit:{label:'Hábito',Icon:Flame}};
const monthTitle=(date:string)=>{const name=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));return name.charAt(0).toUpperCase()+name.slice(1)};

function AgendaDay({items}:{items:AgendaItem[]}){
  if(!items.length)return <p className="today-empty">Nada este día.</p>;
  return <ul className="agenda-items">{items.map((item,i)=>{const {label,Icon}=AGENDA_KINDS[item.kind];return <li key={i} className={`agenda-item ${item.kind} ${item.status??''}`}><Icon size={14} aria-hidden="true"/><span className="sr-only">{label}:</span>{item.time&&<strong>{item.time}</strong>}<span className="agenda-title">{item.title}</span>{item.status&&<small>{HABIT_STATUS[item.status].label}</small>}</li>})}</ul>;
}

/** Eventos de Google, recordatorios (con sus repeticiones) y hábitos de cada día, por semanas o por meses. */
function AgendaSection({token,reminders,habits,checks,calendar,saveEvent,goToSettings}:{token:string;reminders:Row[];habits:Row[];checks:Row[];calendar?:Row;saveEvent:(data:object)=>Promise<boolean>;goToSettings:()=>void}) {
  const today=todayInMadrid();
  const [view,setView]=useState<'week'|'month'>('week'),[anchor,setAnchor]=useState(today),[selected,setSelected]=useState(today);
  const [eventsByMonth,setEventsByMonth]=useState<Record<string,Row[]>>({}),[problem,setProblem]=useState('');
  const from=view==='week'?mondayOf(anchor):mondayOf(anchor.slice(0,7)+'-01');
  const firstOfMonth=(date:string,step=0)=>{const [year,month]=date.split('-').map(Number);return new Date(Date.UTC(year,month-1+step,1)).toISOString().slice(0,10)};
  const lastOfMonth=addDays(firstOfMonth(anchor,1),-1);
  const to=view==='week'?addDays(from,6):addDays(mondayOf(lastOfMonth),6);
  const days=useMemo(()=>{const list:string[]=[];for(let d=from;d<=to;d=addDays(d,1))list.push(d);return list},[from,to]);
  const months=[...new Set(days.map(d=>d.slice(0,7)))].join(',');
  const isConnected=!!calendar?.connected;
  // Al guardar un evento el panel recarga el calendario: entonces se vuelven a pedir los meses.
  useEffect(()=>setEventsByMonth({}),[calendar]);
  useEffect(()=>{
    if(!isConnected)return;
    for(const month of months.split(',').filter(m=>!(m in eventsByMonth))){
      api('calendar',token,'GET',undefined,{month}).then(r=>setEventsByMonth(current=>({...current,[month]:r.events??[]}))).catch(e=>setProblem(e instanceof Error?e.message:'No se pudieron cargar los eventos.'));
    }
  },[months,isConnected,token,eventsByMonth]);
  const itemsByDay=useMemo(()=>{
    const byDay:Record<string,AgendaItem[]>=Object.fromEntries(days.map(d=>[d,[]]));
    for(const e of Object.values(eventsByMonth).flat()){const date=e.date??madridDateOf(e.start);byDay[date]?.push({kind:'event',title:e.title,time:e.start?timeOf(e.start):null})}
    for(const r of reminders)for(const date of reminderDates(r,from,to))byDay[date]?.push({kind:'reminder',title:r.text,time:timeOf(r.remind_at)});
    for(const d of days){for(const h of habits){const status=habitStatus(h,checks,d,today);if(status!=='rest'&&status!=='before')byDay[d].push({kind:'habit',title:h.name,time:null,status})}
      byDay[d].sort((a,b)=>(a.kind==='habit'?1:0)-(b.kind==='habit'?1:0)||(a.time??'').localeCompare(b.time??''))}
    return byDay;
  },[days,eventsByMonth,reminders,habits,checks,from,to,today]);
  function move(step:number){
    if(view==='week'){setAnchor(addDays(anchor,7*step));return}
    const month=firstOfMonth(anchor,step);setAnchor(month);setSelected(month.slice(0,7)===today.slice(0,7)?today:month);
  }
  const title=view==='week'?`${shortDay(from)} – ${shortDay(to)} · ${monthTitle(to)}`:monthTitle(anchor);
  return <>
    {problem&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{problem}</span></div>}
    <Card title="Agenda" aside={<div className="segmented" role="group" aria-label="Vista"><button className={view==='week'?'selected':''} aria-pressed={view==='week'} onClick={()=>setView('week')}>Semana</button><button className={view==='month'?'selected':''} aria-pressed={view==='month'} onClick={()=>setView('month')}>Mes</button></div>}>
      <div className="agenda-toolbar"><button className="icon-button" aria-label={view==='week'?'Semana anterior':'Mes anterior'} onClick={()=>move(-1)}><ChevronLeft size={18}/></button><h3 aria-live="polite">{title}</h3><button className="icon-button" aria-label={view==='week'?'Semana siguiente':'Mes siguiente'} onClick={()=>move(1)}><ChevronRight size={18}/></button><button className="secondary" onClick={()=>{setAnchor(today);setSelected(today)}}>Hoy</button></div>
      <p className="agenda-legend">{(Object.keys(AGENDA_KINDS) as AgendaItem['kind'][]).map(kind=>{const {label,Icon}=AGENDA_KINDS[kind];return <span key={kind} className={`agenda-key ${kind}`}><Icon size={13} aria-hidden="true"/> {label}</span>})}{!isConnected&&<span className="today-empty">Sin eventos: <button className="text-link" onClick={goToSettings}>conecta Google en Ajustes</button>.</span>}</p>
      {view==='week'?<div className="agenda-week">{days.map(d=><section key={d} className={`agenda-day ${d===today?'is-today':''}`} aria-label={longDay(d)}><h4>{shortDay(d)}{d===today&&<span className="today-tag">Hoy</span>}</h4><AgendaDay items={itemsByDay[d]}/></section>)}</div>
      :<><div className="agenda-month" role="grid" aria-label={monthTitle(anchor)}>{DAY_INITIALS.map(d=><span key={d} className="agenda-weekday" aria-hidden="true">{d}</span>)}{days.map(d=>{const items=itemsByDay[d],isOtherMonth=d.slice(0,7)!==anchor.slice(0,7);return <button key={d} role="gridcell" className={`agenda-cell ${isOtherMonth?'other-month':''} ${d===today?'is-today':''} ${d===selected?'is-selected':''}`} aria-label={`${longDay(d)}: ${items.length?`${items.length} cosas`:'nada'}`} aria-selected={d===selected} onClick={()=>setSelected(d)}><span className="agenda-number">{Number(d.slice(8))}</span><span className="agenda-dots" aria-hidden="true">{items.slice(0,4).map((item,i)=><i key={i} className={item.kind}/>)}</span><span className="agenda-chips" aria-hidden="true">{items.slice(0,3).map((item,i)=><span key={i} className={`agenda-chip ${item.kind}`}>{item.title}</span>)}{items.length>3&&<span className="agenda-more">+{items.length-3}</span>}</span></button>})}</div>
        <div className="agenda-detail"><h4>{longDay(selected)}</h4><AgendaDay items={itemsByDay[selected]??[]}/></div></>}
    </Card>
    {isConnected&&<Card title="Nuevo evento en Google Calendar"><EventForm save={saveEvent}/></Card>}
  </>;
}

// Formato de la fecha de los titulares.
function timeAgo(v:string|null):string{
  if(!v)return '';const minutes=Math.max(1,Math.round((Date.now()-Date.parse(v))/60000));
  if(minutes<60)return `hace ${minutes} min`;const hours=Math.round(minutes/60);if(hours<24)return `hace ${hours} h`;
  const days=Math.round(hours/24);return days===1?'ayer':`hace ${days} días`;
}

/** Un titular del tema de la sección. Es un extra: si falla no se enseña nada (queda en la consola). */
function SectionNews({token,topic,onMore}:{token:string;topic:string;onMore:()=>void}) {
  const [item,setItem]=useState<Row|null>(null);
  useEffect(()=>{setItem(null);api('news',token,'GET',undefined,{topic,limit:'1'}).then(items=>setItem(items[0]??null)).catch(e=>console.error('No se pudo cargar la noticia de la sección',e))},[token,topic]);
  if(!item)return null;
  return <aside className="section-news" aria-label="Noticia relacionada"><Newspaper size={16} aria-hidden="true"/><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a><small>{item.source} · {timeAgo(item.publishedAt)}</small><button className="text-link" onClick={onMore}>Más noticias →</button></aside>;
}

function NewsSection({token}:{token:string}) {
  const [topics,setTopics]=useState<Row[]>([]),[topic,setTopic]=useState('destacadas'),[items,setItems]=useState<Row[]|null>(null),[problem,setProblem]=useState('');
  useEffect(()=>{api('news_topics',token).then(setTopics).catch(e=>setProblem(e instanceof Error?e.message:'No se pudieron cargar los temas.'))},[token]);
  const load=useCallback(()=>{setItems(null);setProblem('');api('news',token,'GET',undefined,{topic,limit:'20'}).then(setItems).catch(e=>{setItems([]);setProblem(e instanceof Error?e.message:'No se pudieron cargar las noticias.')})},[token,topic]);
  useEffect(()=>{load()},[load]);
  return <>
    <div className="news-topics" role="group" aria-label="Temas">{topics.map(t=><button key={t.id} className={topic===t.id?'selected':''} aria-pressed={topic===t.id} onClick={()=>setTopic(t.id)}>{t.label}</button>)}</div>
    {problem&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{problem}</span><button className="retry" onClick={load}>Reintentar</button></div>}
    <Card title={topics.find(t=>t.id===topic)?.label??'Noticias'}>
      {items===null?<Empty>Cargando titulares…</Empty>:items.length?<ul className="news-list">{items.map(n=><li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a><small>{n.source}{n.publishedAt?` · ${timeAgo(n.publishedAt)}`:''}</small>{n.summary&&<p>{n.summary}</p>}</li>)}</ul>:!problem&&<Empty>No hay titulares recientes de este tema. Prueba con otro.</Empty>}
    </Card>
  </>;
}

/** Buscar gastos e ingresos por texto, categoría y fechas. Los filtros los aplica el servidor, sin límite de periodo. */
function MovementSearch({token}:{token:string}) {
  const today=todayInMadrid();
  const [text,setText]=useState(''),[category,setCategory]=useState(''),[from,setFrom]=useState(()=>addDays(todayInMadrid(),-89)),[to,setTo]=useState(today);
  const [categories,setCategories]=useState<string[]>([]),[results,setResults]=useState<Row[]|null>(null),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
  useEffect(()=>{api('expense_categories',token).then(setCategories).catch(e=>setProblem(e instanceof Error?e.message:'No se pudieron cargar las categorías.'))},[token]);
  const search=useCallback(async()=>{
    setBusy(true);setProblem('');
    try{setResults(await api('movements',token,'GET',undefined,{q:text,category,from,to}))}
    catch(e){setProblem(e instanceof Error?e.message:'No se pudo buscar.')}
    finally{setBusy(false)}
  },[token,text,category,from,to]);
  // La primera vez enseña los últimos 90 días; después, solo al pulsar Buscar (los filtros se quedan si falla).
  useEffect(()=>{void search()},[token]);
  const spent=(results??[]).filter(r=>r.kind==='expense').reduce((n,r)=>n+r.amount,0),earned=(results??[]).filter(r=>r.kind==='income').reduce((n,r)=>n+r.amount,0);
  const hasFilters=text||category||from!==addDays(today,-89)||to!==today;
  return <Card title="Buscar movimientos">
    <form className="stack-form" onSubmit={e=>{e.preventDefault();void search()}} role="search" aria-label="Buscar movimientos">
      <div className="form-row"><label>Texto<input value={text} onChange={e=>setText(e.target.value)} maxLength={100} placeholder="Mercadona, Bizum, Netflix…"/></label>
        <label>Categoría<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Todas</option><option>Ingresos</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label></div>
      <div className="form-row"><label>Desde<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} required/></label><label>Hasta<input type="date" value={to} min={from} max={today} onChange={e=>setTo(e.target.value)} required/></label>
        <button className="primary" type="submit" disabled={busy}><Search size={16}/> {busy?'Buscando…':'Buscar'}</button>
        {hasFilters&&<button className="secondary" type="button" onClick={()=>{setText('');setCategory('');setFrom(addDays(today,-89));setTo(today)}}>Quitar filtros</button>}</div>
    </form>
    {problem&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{problem}</span><button className="retry" onClick={()=>void search()}>Reintentar</button></div>}
    {results===null?<Empty>{busy?'Buscando…':'Elige los filtros y pulsa Buscar.'}</Empty>:<>
      <p className="search-summary" role="status"><strong>{results.length===1?'1 movimiento':`${results.length} movimientos`}</strong> · Gastos {euro(spent)} · Ingresos <span className="positive">{euro(earned)}</span> · Balance <span className={earned-spent>=0?'positive':'negative'}>{euro(earned-spent)}</span>{results.length>=300&&' · Se muestran los 300 más recientes: acota las fechas para ver el resto.'}</p>
      {results.length?<div className="table-wrap" tabIndex={0} role="region" aria-label="Resultados (desliza para ver todas las columnas)"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Importe</th></tr></thead><tbody>{results.map(r=><tr key={`${r.kind}-${r.id}`}><td>{r.booking_date}</td><td>{r.description}</td><td>{r.category}</td><td className={r.kind==='income'?'positive':''}>{r.kind==='income'?'+':'−'}{euro(r.amount)}</td></tr>)}</tbody></table></div>
      :<Empty>No hay movimientos con esos filtros. Prueba a ampliar las fechas o a quitar la categoría.</Empty>}
    </>}
  </Card>;
}

/** Estado de un presupuesto en palabras, para no depender solo del color de la barra. */
function budgetState(spent:number,limit:number):{level:'ok'|'near'|'over';text:string}{
  const percent=Math.round(spent/limit*100);
  if(spent>limit)return {level:'over',text:`Superado en ${euro(spent-limit)} (${percent} %)`};
  if(percent>=80)return {level:'near',text:`Al ${percent} %: cerca del límite, te quedan ${euro(limit-spent)}`};
  return {level:'ok',text:`Te quedan ${euro(limit-spent)} (${percent} %)`};
}

type SearchTarget={section:Section;label:string;detail:string;Icon:typeof Bell};
/** Busca en recordatorios, eventos, hábitos, compra y movimientos. Al elegir un resultado lleva a su sección. */
function SearchDialog({token,onClose,goTo}:{token:string;onClose:()=>void;goTo:(section:Section)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),[text,setText]=useState(''),[results,setResults]=useState<Row|null>(null),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
  // showModal lleva el foco al primer botón (Cerrar): se pasa al campo para poder escribir sin más.
  useEffect(()=>{dialog.current?.showModal();input.current?.focus()},[]);
  useEffect(()=>{
    const query=text.trim();if(query.length<2){setResults(null);setProblem('');return}
    // Espera a que se deje de escribir para no buscar con cada letra.
    let active=true;setResults(null);
    const timer=setTimeout(()=>{setBusy(true);setProblem('');api('search',token,'GET',undefined,{q:query}).then(r=>{if(active)setResults(r)}).catch(e=>{if(active)setProblem(e instanceof Error?e.message:'No se pudo buscar.')}).finally(()=>{if(active)setBusy(false)})},300);
    return ()=>{active=false;clearTimeout(timer)};
  },[text,token]);
  const groups:{title:string;items:SearchTarget[]}[]=results?[
    {title:'Recordatorios',items:results.reminders.map((r:Row)=>({section:'reminders',label:r.text,detail:dateTime(r.remind_at),Icon:Bell}))},
    {title:'Eventos',items:results.events.map((e:Row)=>({section:'calendar',label:e.title,detail:e.start?dateTime(e.start):`${e.date} · Todo el día`,Icon:CalendarDays}))},
    {title:'Hábitos',items:results.habits.map((h:Row)=>({section:'habits',label:h.name,detail:'Hábito',Icon:Flame}))},
    {title:'Lista de la compra',items:results.shopping.map((i:Row)=>({section:'shopping_items',label:i.text,detail:'Por comprar',Icon:ShoppingBasket}))},
    {title:'Notas',items:(results.notes??[]).map((n:Row)=>({section:'notes',label:n.text,detail:dateTime(n.created_at),Icon:FileText}))},
    {title:'Movimientos',items:results.movements.map((m:Row)=>({section:'finances',label:m.description,detail:`${m.booking_date} · ${m.kind==='income'?'+':'−'}${euro(m.amount)} · ${m.category}`,Icon:Wallet}))},
  ].filter(g=>g.items.length):[];
  return <dialog ref={dialog} className="add-dialog search-dialog" aria-labelledby="search-title" onClose={onClose}>
    <div className="card-heading"><h2 id="search-title">Buscar</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18}/></button></div>
    <label className="sr-only" htmlFor="global-search">Buscar en tu panel</label>
    <input ref={input} id="global-search" className="search-input" type="search" value={text} onChange={e=>setText(e.target.value)} placeholder="Recordatorios, notas, eventos, hábitos, movimientos…" autoComplete="off"/>
    <div aria-live="polite">
      {problem&&<p className="error" role="alert">{problem}</p>}
      {results?.eventsProblem&&<p className="form-hint">{results.eventsProblem}</p>}
      {text.trim().length<2?<p className="form-hint">Escribe al menos dos letras.</p>:busy&&!results?<p className="form-hint">Buscando…</p>:results&&!groups.length?<p className="form-hint">Sin resultados para «{text.trim()}».</p>:null}
      {groups.map(g=><section key={g.title} className="search-group"><h3>{g.title}</h3>{g.items.map((item,i)=><button key={i} className="search-result" onClick={()=>goTo(item.section)}><item.Icon size={16} aria-hidden="true"/><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</section>)}
    </div>
  </dialog>;
}

type MarketKind='stock'|'crypto'|'currency';
const MARKET_GROUPS:{kind:MarketKind;title:string;add:string;placeholder:string}[]=[
  {kind:'stock',title:'Índices y empresas',add:'Empresa o índice',placeholder:'AMD, Netflix, S&P 500…'},
  {kind:'crypto',title:'Criptomonedas',add:'Criptomoneda',placeholder:'Cardano, Polkadot…'},
  {kind:'currency',title:'Divisas (frente al euro)',add:'Divisa',placeholder:'Código de 3 letras: JPY, MXN…'},
];
/** Igual que formatPrice en el servidor (markets.ts). */
function marketPrice(q:Row):string{
  if(q.kind==='currency')return `1 € = ${q.price.toLocaleString('es-ES',{maximumFractionDigits:4})} ${q.currency}`;
  if(String(q.symbol).startsWith('^'))return q.price.toLocaleString('es-ES',{maximumFractionDigits:2});
  return new Intl.NumberFormat('es-ES',{style:'currency',currency:q.currency}).format(q.price);
}
/** El cambio con signo y flecha, no solo con color. */
function MarketChange({value}:{value:number|null}){
  if(value===null)return <small className="market-change">—</small>;
  const isUp=value>0,isDown=value<0;
  return <small className={`market-change ${isUp?'up':isDown?'down':''}`}>{isUp?'▲ +':isDown?'▼ −':''}{Math.abs(value).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} %</small>;
}

function MarketsSection({token}:{token:string}) {
  const [data,setData]=useState<Row|null>(null),[problem,setProblem]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [kind,setKind]=useState<MarketKind>('stock'),[query,setQuery]=useState('');
  const load=useCallback(async()=>{setProblem('');try{setData(await api('markets',token))}catch(e){setProblem(e instanceof Error?e.message:'No se pudieron cargar los mercados.')}},[token]);
  useEffect(()=>{void load()},[load]);
  async function change(work:()=>Promise<string>){
    setBusy(true);setProblem('');setNotice('');
    try{setNotice(await work());await load()}catch(e){setProblem(e instanceof Error?e.message:'No se pudo guardar.')}finally{setBusy(false)}
  }
  const follow=(e:FormEvent)=>{e.preventDefault();void change(async()=>{const {asset}=await api('market_watchlist',token,'POST',{kind,query});setQuery('');return `Ahora sigues ${asset.label} (${asset.symbol}).`})};
  const quotes:Row[]=data?.quotes??[],assets:Row[]=data?.assets??[];
  return <>
    {problem&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{problem}</span><button className="retry" onClick={()=>void load()}>Reintentar</button></div>}
    {notice&&<div className="notice" role="status"><Check size={17}/>{notice}</div>}
    {data?.problems?.map((p:string)=><p key={p} className="form-hint">{p}</p>)}
    {MARKET_GROUPS.map(group=>{const items=assets.filter(a=>a.kind===group.kind);return <Card key={group.kind} title={group.title} aside={<span className="count">{items.length}</span>}>
      {!data?<Empty>Cargando cotizaciones…</Empty>:items.length?items.map(asset=>{const q=quotes.find(x=>x.id===asset.id);return <div className="list-row" key={asset.id}><span className="row-main"><strong>{asset.label}</strong><small>{asset.symbol}</small></span><span className="market-price"><strong>{q?marketPrice(q):'Sin datos ahora'}</strong>{q&&<MarketChange value={q.changePercent}/>}</span><button className="delete icon-button" aria-label={`Dejar de seguir ${asset.label}`} disabled={busy} onClick={()=>void change(async()=>{await api('market_watchlist',token,'DELETE',undefined,{id:String(asset.id)});return `Ya no sigues ${asset.label}.`})}><Trash2 size={16}/></button></div>}):<Empty>No sigues nada aquí. Añádelo abajo.</Empty>}
    </Card>})}
    <Card title="Seguir algo más"><form className="stack-form" onSubmit={follow}><div className="form-row">
      <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value as MarketKind)}>{MARKET_GROUPS.map(g=><option key={g.kind} value={g.kind}>{g.add}</option>)}</select></label>
      <label>Nombre o símbolo<input value={query} onChange={e=>setQuery(e.target.value)} required maxLength={60} placeholder={MARKET_GROUPS.find(g=>g.kind===kind)!.placeholder}/></label>
      <button className="primary" type="submit" disabled={busy}><Plus size={16}/> {busy?'Buscando…':'Seguir'}</button></div>
      <p className="form-hint">También desde el chat: «sigue AMD», «deja de seguir Tesla» o «¿cómo va el bitcoin?». Los precios se actualizan cada 5 minutos; las acciones, en horario de bolsa.</p></form></Card>
  </>;
}

/** En Finanzas, las primeras cotizaciones de un vistazo. Es un extra: si falla, no se enseña (queda en la consola). */
function MarketsStrip({token,onMore}:{token:string;onMore:()=>void}) {
  const [quotes,setQuotes]=useState<Row[]>([]);
  useEffect(()=>{api('markets',token).then(r=>setQuotes((r.quotes??[]).slice(0,4))).catch(e=>console.error('No se pudieron cargar los mercados',e))},[token]);
  if(!quotes.length)return null;
  return <aside className="markets-strip" aria-label="Mercados">{quotes.map(q=><span key={q.id}><strong>{q.label}</strong> {marketPrice(q)} <MarketChange value={q.changePercent}/></span>)}<button className="text-link" onClick={onMore}>Ver mercados →</button></aside>;
}

/** Un suceso de un día como hoy, el mismo que en el resumen de la mañana. Si falla, no se enseña. */
function CuriosityCard({token}:{token:string}) {
  const [curiosity,setCuriosity]=useState<Row|null>(null);
  useEffect(()=>{api('curiosity',token).then(setCuriosity).catch(e=>console.error('No se pudo cargar la curiosidad del día',e))},[token]);
  if(!curiosity)return null;
  return <section className="card curiosity-card" aria-labelledby="curiosity-title"><div className="card-heading"><h2 id="curiosity-title"><Lightbulb size={17} aria-hidden="true"/> Un día como hoy, en {curiosity.year}</h2></div><p>{curiosity.text}</p>{curiosity.url&&<a href={curiosity.url} target="_blank" rel="noopener noreferrer">Leer más en Wikipedia →</a>}</section>;
}

/** Comparar precios en tiendas (Google Shopping vía SerpApi) y vigilar productos para que avise cuando bajen. */
function PricesSection({token}:{token:string}) {
  const [query,setQuery]=useState(''),[result,setResult]=useState<Row|null>(null),[watches,setWatches]=useState<Row[]|null>(null);
  const [watchQuery,setWatchQuery]=useState(''),[maxPrice,setMaxPrice]=useState(''),[busy,setBusy]=useState(''),[problem,setProblem]=useState(''),[notice,setNotice]=useState(''),[watchEdit,setWatchEdit]=useState<number|null>(null);
  const watchRemoval=useUndoQueue(setProblem);
  const loadWatches=useCallback(async()=>{try{setWatches(await api('price_watches',token))}catch(e){setProblem(e instanceof Error?e.message:'No se pudieron cargar los productos vigilados.')}},[token]);
  useEffect(()=>{void loadWatches()},[loadWatches]);
  async function run(task:string,work:()=>Promise<void>){setBusy(task);setProblem('');setNotice('');try{await work()}catch(e){setProblem(e instanceof Error?e.message:'No se pudo completar.')}finally{setBusy('')}}
  const search=(e:FormEvent)=>{e.preventDefault();void run('search',async()=>{const found=await api('prices',token,'GET',undefined,{q:query});setResult(found);setWatchQuery(found.query);setWatchEdit(null)})};
  const watch=(e:FormEvent)=>{e.preventDefault();void run('watch',async()=>{const {watch:saved}=await api('price_watches',token,'POST',{query:watchQuery,max_price:maxPrice.replace(',','.')||null});setNotice(`Vigilo «${saved.query}» cada día a las 10:00.`);setMaxPrice('');setWatchQuery('');setWatchEdit(null);await loadWatches()})};
  return <>
    {problem&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{problem}</span></div>}
    {notice&&<div className="notice" role="status"><Check size={17}/>{notice}</div>}
    <Card title="Comparar precios">
      <form className="stack-form" role="search" aria-label="Comparar precios" onSubmit={search}><div className="form-row"><label>Producto<input value={query} onChange={e=>setQuery(e.target.value)} required minLength={2} maxLength={100} placeholder="PS5, AirPods Pro 2, Roomba…"/></label><button className="primary" type="submit" disabled={!!busy}><Search size={16}/> {busy==='search'?'Buscando…':'Comparar'}</button></div>
        <p className="form-hint">Busca en Google Shopping de España. Cada búsqueda gasta una de las 250 gratis del mes.</p></form>
      {result&&<>{result.offers.length?<ul className="offer-list">{result.offers.map((o:Row,i:number)=><li key={o.url}><span className="offer-rank">{i+1}</span><span className="row-main"><strong>{o.title}{o.isSecondHand&&<span className="badge-used">2ª mano</span>}</strong><small>{o.source}{o.delivery?` · ${o.delivery}`:''}{o.rating?` · ★ ${o.rating}`:''}</small></span><span className="offer-price"><strong>{euro(o.price)}</strong><a href={o.url} target="_blank" rel="noopener noreferrer">Ver tienda →</a></span></li>)}</ul>:<Empty>No he encontrado «{result.query}» en sí, solo accesorios u otros productos. Prueba con marca y modelo, por ejemplo «consola PS5 Slim».</Empty>}
        <p className="form-hint">Busqué «{result.searchQuery}» y me quedé solo con el producto (sin juegos ni accesorios); lo de segunda mano va marcado. Quedan {result.left} búsquedas este mes.</p></>}
    </Card>
    <Card title="Vigilar un producto" aside={watches&&<span className="count">{watches.length} de 5</span>}>
      <form className="stack-form" onSubmit={watch}><div className="form-row"><label>Producto<input id="watch-product" disabled={watchEdit!==null} value={watchQuery} onChange={e=>setWatchQuery(e.target.value)} required minLength={2} maxLength={100} placeholder="PS5"/></label><label>Avísame si baja de (€, opcional)<input inputMode="decimal" value={maxPrice} onChange={e=>setMaxPrice(e.target.value)} pattern="[0-9]+([.,][0-9]{1,2})?" placeholder="400"/></label><button className="primary" type="submit" disabled={!!busy}><Tag size={16}/> {busy==='watch'?'Guardando…':watchEdit!==null?'Guardar objetivo':'Vigilar'}</button>{watchEdit!==null&&<button type="button" className="secondary" onClick={()=>{setWatchEdit(null);setWatchQuery('');setMaxPrice('')}}>Cancelar edición</button>}</div>
        <p className="form-hint">Lo miro cada día a las 10:00 y te aviso por Telegram. Sin precio, te aviso si baja un 5 % o más.</p></form>
      {watches===null?<Empty>Cargando…</Empty>:watches.length?watches.filter(w=>!watchRemoval.pending.some(p=>p.id===`watch:${w.id}`)).map(w=><div className="list-row" key={w.id}><span className="row-symbol warm"><Tag size={17}/></span><span className="row-main"><strong>{w.query}</strong><span className={`watch-status ${!w.checked_at||Date.now()-Date.parse(w.checked_at)>36*3600000?'is-stale':''}`}>{!w.checked_at?'Sin revisar':Date.now()-Date.parse(w.checked_at)>36*3600000?'Revisión pendiente':'Revisión al día'}</span><small>{w.best_price!=null?<>Mejor: {euro(Number(w.best_price))} en {w.best_link?<a href={w.best_link} target="_blank" rel="noopener noreferrer">{w.best_source}</a>:w.best_source}</>:'Aún sin revisar'} · {w.max_price!=null?`Aviso por debajo de ${euro(Number(w.max_price))}`:'Aviso si baja un 5 %'}{w.checked_at?` · Revisado ${dateTime(w.checked_at)}`:''}</small></span><button className="icon-button" aria-label={`Editar objetivo de ${w.query}`} onClick={()=>{setWatchEdit(w.id);setWatchQuery(w.query);setMaxPrice(w.max_price==null?'':String(w.max_price));document.getElementById('watch-product')?.closest('form')?.scrollIntoView({block:'center',behavior:'smooth'})}}><Pencil size={16}/></button><button className="delete icon-button" aria-label={`Dejar de vigilar ${w.query}`} disabled={!!busy} onClick={()=>watchRemoval.schedule(`watch:${w.id}`,'Seguimiento pendiente de eliminar',async()=>{await api('price_watches',token,'DELETE',undefined,{id:String(w.id)});setWatches(current=>current?.filter(item=>item.id!==w.id)??null);await loadWatches()})}><Trash2 size={16}/></button></div>):<Empty>No vigilas ningún producto. Compara uno arriba y pulsa Vigilar, o dile al chat «avísame si la PS5 baja de 400 €».</Empty>}
    </Card>
  <UndoTray queue={watchRemoval}/></>;
}

/** Ventana para crear cualquier cosa. Si falla, lo escrito se queda y se puede volver a enviar. */
function AddDialog({type,setType,token,isCalendarConnected,onClose,onSaved,goToSettings}:{type:AddType;setType:(type:AddType)=>void;token:string;isCalendarConnected:boolean;onClose:()=>void;onSaved:(message:string)=>Promise<void>;goToSettings:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[problem,setProblem]=useState(''),[categories,setCategories]=useState<string[]>([]);
  // showModal lleva el foco al botón Cerrar: se pasa al primer campo para empezar a escribir.
  useEffect(()=>{dialog.current?.showModal();dialog.current?.querySelector<HTMLElement>('form input, form select')?.focus()},[]);
  useEffect(()=>{if(type==='expense'&&!categories.length)api('expense_categories',token).then(setCategories).catch(e=>setProblem(e instanceof Error?e.message:'No se pudieron cargar las categorías.'))},[type,token,categories.length]);
  async function save(resource:string,payload:object):Promise<boolean>{
    setProblem('');
    try{await api(resource,token,'POST',payload);await onSaved(ADD_DONE[type]);return true}
    catch(e){setProblem(`${e instanceof Error?e.message:'No se ha podido guardar.'} Lo que has escrito sigue aquí: corrígelo o vuelve a enviarlo.`);return false}
  }
  return <dialog ref={dialog} className="add-dialog" aria-labelledby="add-title" onClose={onClose}>
    <div className="card-heading"><h2 id="add-title">Añadir</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18}/></button></div>
    <div className="segmented add-types" role="group" aria-label="Qué quieres añadir">{ADD_TYPES.map(t=><button key={t.id} className={type===t.id?'selected':''} aria-pressed={type===t.id} onClick={()=>{setProblem('');setType(t.id)}}>{t.label}</button>)}</div>
    {problem&&<p className="error" role="alert">{problem}</p>}
    {type==='reminder'&&<ReminderForm save={payload=>save('reminders',payload)}/>}
    {(type==='expense'||type==='income')&&<MoneyForm key={type} kind={type} categories={categories} save={payload=>save(type==='expense'?'expenses':'incomes',payload)}/>}
    {type==='event'&&(isCalendarConnected?<EventForm save={payload=>save('calendar',payload)}/>:<div className="empty">Para crear eventos conecta Google en Ajustes.<br/><button className="text-link" onClick={goToSettings}>Ir a Ajustes →</button></div>)}
    {type==='note'&&<InlineForm label="Guardar nota" placeholder="Una idea, un enlace, un detalle…" onSubmit={text=>save('notes',{text})}/>}
    {type==='habit'&&<InlineForm label="Crear hábito" placeholder="Por ejemplo: leer 20 minutos…" onSubmit={name=>save('habits',{name})}/>}
  </dialog>;
}

/** Lo de hoy, primero: recordatorios y eventos del día, hábitos sin contestar y atajos para añadir. */
function TodaySummary({data,isLoading,onAdd,answerHabit,goTo,token}:{data:Record<string,any>;token:string;isLoading:boolean;onAdd:(type:AddType)=>void;goTo:(section:Section)=>void;answerHabit:(habitId:number,done:boolean)=>void}) {
  const lifeApi=useCallback((resource:string,method="GET",payload?:object,params?:Record<string,string>)=>api(resource,token,method,payload,params),[token]);
  const [clock,setClock]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),60000);return ()=>clearInterval(timer)},[]);
  const focus=dayFocus(data,clock),today=focus.date, list=(key:string):Row[]=>Array.isArray(data[key])?data[key]:[];
  const reminders=list('reminders').filter(r=>madridDateOf(r.remind_at)===today);
  const events:Row[]=data.calendar?.connected?data.calendar.events.filter((e:Row)=>e.date===today||(e.start&&madridDateOf(e.start)===today)):[];
  const birthdays=list('birthdays').filter(b=>Number(b.month)===Number(today.slice(5,7))&&Number(b.day)===Number(today.slice(8,10)));
  const answered=new Set(list('habit_checks').filter(c=>c.date===today).map(c=>c.habit_id));
  const habits=list('habits').filter(h=>(h.scheduled_days??[1,2,3,4,5,6,7]).includes(isoWeekday(today))&&!answered.has(h.id));
  const hasData='reminders' in data;
  const hasItems=reminders.length+events.length+habits.length+birthdays.length>0;
  return <section className="card today-card" aria-labelledby="today-title">
    <div className="card-heading"><h2 id="today-title">{focus.isTomorrow?'Mañana, de un vistazo':'Tu día de hoy'}</h2><button className="text-link" onClick={()=>onAdd('reminder')}>Añadir…</button></div>
    <TodayWeather date={today} forecasts={Array.isArray(data.weather)?data.weather:[]} alerts={Array.isArray(data.weather_alerts)?data.weather_alerts:[]} goTo={goTo}/>
    {focus.overdue>0&&<div className="daily-focus"><SectionLink target="reminders" goTo={goTo}><strong>{focus.overdue===1?'Tienes un recordatorio pendiente de una hora anterior':`Tienes ${focus.overdue} recordatorios de horas anteriores`}</strong>Revisar recordatorios →</SectionLink></div>}
    {focus.next&&<div className="daily-focus"><strong>Lo próximo · {dateTime(focus.next.at)}</strong><SectionLink target={focus.next.section as Section} goTo={goTo}>{focus.next.text} →</SectionLink></div>}
    {!hasData&&isLoading?<Empty>Cargando lo de hoy…</Empty>:hasItems&&<div className="today-grid">
      {reminders.length>0&&<div><h3><SectionLink target="reminders" goTo={goTo}><Bell size={15} aria-hidden="true"/> Recordatorios <ArrowUpRight size={14} aria-hidden="true"/></SectionLink></h3>{reminders.slice(0,3).map(r=><p key={r.id} className="today-item"><strong>{dateTime(r.remind_at).split(', ').at(-1)}</strong> {r.text}</p>)}</div>}
      {events.length>0&&<div><h3><SectionLink target="calendar" goTo={goTo}><CalendarDays size={15} aria-hidden="true"/> Calendario <ArrowUpRight size={14} aria-hidden="true"/></SectionLink></h3>{events.slice(0,3).map((e,i)=><p key={i} className="today-item"><strong>{e.start?dateTime(e.start).split(', ').at(-1):'Todo el día'}</strong> {e.title}</p>)}</div>}
      {habits.length>0&&<div><h3><SectionLink target="habits" goTo={goTo}><Flame size={15} aria-hidden="true"/> Hábitos pendientes <ArrowUpRight size={14} aria-hidden="true"/></SectionLink></h3>{habits.slice(0,3).map(h=><div key={h.id} className="today-habit"><span>{h.name}</span><button className="habit-answer done" onClick={()=>answerHabit(h.id,true)} aria-label={`Hecho: ${h.name}`}>Hecho</button><button className="habit-answer" onClick={()=>answerHabit(h.id,false)} aria-label={`Hoy no: ${h.name}`}>Hoy no</button></div>)}</div>}
      {birthdays.length>0&&<div><h3><SectionLink target="birthdays" goTo={goTo}><Cake size={15} aria-hidden="true"/> Cumpleaños <ArrowUpRight size={14} aria-hidden="true"/></SectionLink></h3>{birthdays.map(b=><p className="today-item" key={b.id}>{b.name}</p>)}</div>}
    </div>}
    <LifePanels api={lifeApi} refreshKey={data}/><DeliveriesPanel api={lifeApi}/>
    <div className="today-editorial"><SectionNews token={token} topic="destacadas" onMore={()=>goTo('news')}/><CuriosityCard token={token}/></div>
  </section>;
}

export function App(){
  const [token,setToken]=useState(''),[authReady,setAuthReady]=useState(false);
  const panelApi=useCallback((resource:string,method='GET',payload?:object,params?:Record<string,string>)=>api(resource,token,method,payload,params),[token]);
  const [section,updateSection]=useState<Section>(()=>initialSection(window.location.search,readLastSection())),[mobileOpen,setMobileOpen]=useState(false);
  const contentRef=useRef<HTMLElement>(null),sidebarNavRef=useRef<HTMLElement>(null);
  const setSection=useCallback((target:Section)=>{
    if(sectionFromSearch(window.location.search)!==target){
      window.history.pushState(null,'',`${window.location.pathname}${sectionSearch(window.location.search,target)}`);
    }
    updateSection(target);setMobileOpen(false);setNotice('');
    window.scrollTo({top:0,left:0,behavior:'instant'});
  },[]);
  useEffect(()=>{const restore=()=>{updateSection(sectionFromSearch(window.location.search));setMobileOpen(false);setNotice('');window.scrollTo({top:0})};window.addEventListener('popstate',restore);return ()=>window.removeEventListener('popstate',restore)},[]);
  useEffect(()=>{if(token){document.title=`${navigation.find(n=>n.id===section)!.label} · Mi asistente`;contentRef.current?.focus({preventScroll:true})}},[section,token]);
  const [data,setData]=useState<Record<string,any>>({}),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [refreshProblem,setRefreshProblem]=useState(false),[updatedAt,setUpdatedAt]=useState<number|null>(null),requestSequence=useRef(0),refreshLatest=useRef<()=>Promise<void>>(async()=>{});
  const removalQueue=useUndoQueue(setError);
  useEffect(()=>{if(!token){removalQueue.clear();setData({});setUpdatedAt(null)}},[token,removalQueue.clear]);
  const [greetingNow,setGreetingNow]=useState(()=>new Date());
  useEffect(()=>{const update=()=>setGreetingNow(new Date());const timer=setInterval(update,60_000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update)}},[]);
  const [period,setPeriod]=useState(30),[funnyLine,setFunnyLine]=useState('');
  const [addType,setAddType]=useState<AddType|null>(null),[retry,setRetry]=useState<(()=>void)|null>(null),[isSearching,setIsSearching]=useState(false);
  // La PWA abre /: recupera la sección y deja una URL que también pueda compartirse.
  useEffect(()=>{
    rememberSection(section);
    if(!new URLSearchParams(window.location.search).has('section')){
      window.history.replaceState(null,'',`${window.location.pathname}${sectionSearch(window.location.search,section)}`);
    }
  },[section]);
  useEffect(()=>{const previous=window.history.scrollRestoration;window.history.scrollRestoration='manual';return ()=>{window.history.scrollRestoration=previous}},[]);
  useLayoutEffect(()=>{if(authReady&&token)window.scrollTo({top:0,left:0,behavior:'instant'})},[section,authReady,Boolean(token)]);
  useEffect(()=>{if(mobileOpen&&sidebarNavRef.current)sidebarNavRef.current.scrollTop=0},[mobileOpen]);
  // «/» y Ctrl/Cmd+K abren la búsqueda. No interrumpen formularios ni otros diálogos.
  useEffect(()=>{const open=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;const shortcut=(e.key==='k'&&(e.ctrlKey||e.metaKey))||e.key==='/';if(!shortcut||target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;e.preventDefault();setIsSearching(true)};window.addEventListener('keydown',open);return ()=>window.removeEventListener('keydown',open)},[]);
  useEffect(()=>{if(!mobileOpen)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setMobileOpen(false)};window.addEventListener('keydown',close);return ()=>window.removeEventListener('keydown',close)},[mobileOpen]);
  // La confirmación se va sola; los errores se quedan hasta cerrarlos o reintentar.
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return ()=>clearTimeout(timer)},[notice]);
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{setToken(session?.access_token??'');setAuthReady(true)});
    void supabase.auth.getSession().then(({data:{session}})=>{setToken(session?.access_token??'');setAuthReady(true)});
    return ()=>subscription.unsubscribe();
  },[]);
  const refresh=useCallback(async(t=token)=>{
    if(!t)return;const sequence=++requestSequence.current;setLoading(true);setError('');setRetry(null);
    const from=new Date(Date.now()-(period-1)*86400000).toISOString().slice(0,10);
    // Todo en una petición: con una por recurso, Supabase cortaba la ráfaga con 429.
    const next:Record<string,any>={};const failures:string[]=[];let isAuthProblem=false,isPending=false;
    try{
      const parts:Record<string,{data?:unknown;error?:string}>=await api('dashboard',t,'GET',undefined,{from});
      resources.forEach(resource=>{const part=parts[resource];if(part&&'data' in part)next[resource]=part.data;else failures.push(part?.error??'Sin respuesta.')});
    }catch(e){failures.push(e instanceof Error?e.message:'No se pudo conectar con el asistente.');const status=(e as {status?:number}).status;isAuthProblem=status===401||status===403;isPending=status===403}
    if(sequence!==requestSequence.current)return;
    setData(previous=>({...previous,...next}));setLoading(false);setRefreshProblem(failures.length>0);if(!failures.length)setUpdatedAt(Date.now());
    if(failures.length){
      setError(`No se ha podido cargar todo el panel: ${[...new Set(failures)].join(' · ')}`);setRetry(()=>()=>void refresh(t));
      if(isAuthProblem){
        void supabase.auth.signOut();setToken('');
        setError(isPending?'Cuenta creada, pendiente de autorización. Avísanos con tu correo para activar el acceso.':'Tu sesión ha caducado. Entra de nuevo.');
      }
    }
  },[token,period]);
  refreshLatest.current=()=>refresh();
  useEffect(()=>{void refresh()},[refresh]);
  // La frase sorpresa es un extra: si Groq falla se queda el subtítulo de siempre, sin molestar con un aviso.
  useEffect(()=>{if(token)api('greeting',token).then(r=>setFunnyLine(String(r.text??''))).catch(e=>console.error('No se pudo inventar la frase',e))},[token]);
  async function action(resource:string,method:string,payload?:object,params?:Record<string,string>,done?:string):Promise<boolean>{
    setNotice('');setError('');setRetry(null);
    if(method==='DELETE'&&['reminders','shopping_items','birthdays','habits','weight_entries','budgets'].includes(resource)){
      const key=`${resource}:${params?.id??params?.category}`;
      removalQueue.schedule(key,`${({reminders:'Recordatorio',shopping_items:'Producto',birthdays:'Cumpleaños',habits:'Hábito',weight_entries:'Registro de peso',budgets:'Presupuesto'} as Record<string,string>)[resource]} pendiente de eliminar`,async()=>{await api(resource,token,method,payload,params);setData(previous=>({...previous,[resource]:(previous[resource]??[]).filter((row:Row)=>resource==='budgets'?row.budget?.category!==params?.category:String(row.id)!==params?.id)}));await refreshLatest.current()});return true;
    }
    try{await api(resource,token,method,payload,params);setNotice(done??(method==='DELETE'?'Eliminado.':'Guardado.'));await refresh();return true}
    catch(e){
      setError(e instanceof Error?e.message:'No se ha podido completar.');
      if(isRetryable(e))setRetry(()=>()=>void action(resource,method,payload,params,done));
      return false;
    }
  }
  function logout(){requestSequence.current++;removalQueue.clear();void supabase.auth.signOut();setToken('');setData({});setError('')}
  const rows=(key:string):Row[]=>(Array.isArray(data[key])?data[key]:[]).filter((row:Row)=>!removalQueue.pending.some(p=>p.id===`${key}:${key==='budgets'?row.budget?.category:row.id}`));
  const expenses=rows('expenses'), incomes=rows('incomes'), budgets=rows('budgets');
  const reimbursementIds=new Set((data.debt_settlements??[]).map((r:Row)=>r.income_id));
  const totals={spent:expenses.reduce((n,r)=>n+Number(r.amount),0),earned:incomes.reduce((n,r)=>n+Number(r.amount),0),reimbursements:incomes.filter(r=>reimbursementIds.has(r.id)).reduce((n,r)=>n+Number(r.amount),0)};
  const current=navigation.find(n=>n.id===section)!;
  if(!authReady)return <div className="login-screen"><div className="login-card">Cargando acceso…</div></div>;
  if(!token)return <LoginScreen error={error} setError={setError}/>;
  return <div className="shell"><a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();contentRef.current?.focus();contentRef.current?.scrollIntoView()}}>Saltar al contenido</a><aside className={`sidebar ${mobileOpen?'open':''}`}><div className="sidebar-top"><div className="identity"><img src={chatbotLogo} alt="Mi asistente"/><small>PANEL PERSONAL</small></div><button className="mobile-close icon-button" aria-label="Cerrar menú" onClick={()=>setMobileOpen(false)}><X/></button></div><nav ref={sidebarNavRef} aria-label="Navegación principal">{NAV_GROUPS.map(group=><div className="nav-group" key={group.label}><p className="nav-group-label">{group.label}</p>{group.sections.map(id=>{const {label,icon:Icon}=navigation.find(n=>n.id===id)!;return <a key={id} href={sectionSearch(window.location.search,id)} className={section===id?'nav-item active':'nav-item'} aria-current={section===id?'page':undefined} onClick={e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();setSection(id)}}><Icon size={19} strokeWidth={1.8} aria-hidden="true"/>{label}</a>})}</div>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="status-dot"/>Conectado a tu asistente</div><button className="nav-item logout" onClick={logout}><LogOut size={18}/> Cerrar sesión</button></div></aside>{mobileOpen&&<div className="backdrop" onClick={()=>setMobileOpen(false)}/>}
  <div className="workspace"><header className="topbar">{/* En el móvil, dentro de una sección, la vuelta al inicio ocupa el sitio del menú (que ya está en «Más»). */}{section==='overview'?<button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={()=>setMobileOpen(true)}><Menu/></button>:<button className="mobile-menu icon-button back-home" onClick={()=>setSection('overview')}><ChevronLeft size={20} aria-hidden="true"/> Inicio</button>}<div className="breadcrumbs"><span className="crumb-root">Mi espacio <span>/</span> </span><strong>{current.label}</strong></div><button className="icon-button search-button" onClick={()=>setIsSearching(true)} aria-label="Buscar (atajos: / o Ctrl+K)" title="Buscar · / o Ctrl+K"><Search size={19}/></button><button className="primary add-button" onClick={()=>setAddType('reminder')}><Plus size={17}/> Añadir…</button><button className="refresh icon-button" onClick={()=>void refresh()} disabled={loading} aria-label="Actualizar datos"><RefreshCw size={18} className={loading?'spin':''}/></button></header>
  <main id="main-content" ref={contentRef} tabIndex={-1} className={`content ${section==='overview'?'overview-content':''}`}><div className="page-heading"><div><div className="eyebrow">PANEL PERSONAL</div><h1>{section==='overview'?contextualGreeting(rows('birthdays'),greetingNow):current.label}</h1><p className={section==='overview'?'overview-subtitle':undefined}>{section==='overview'?funnyLine||'Aquí tienes lo importante de un vistazo.':section==='notes'?'Ideas, enlaces y detalles para tener a mano.':section==='memory'?'Lo que tu asistente sabe de ti. Lo usa para hablarte con gracia.':section==='finances'?'Tus ingresos, gastos y límites en un mismo lugar.':section==='weather'?'Previsión de los próximos 7 días y avisos de AEMET.':section==='settings'?'Cuentas conectadas, permisos y tus datos.':section==='news'?'Titulares de España y del mundo, por temas.':section==='markets'?'Nasdaq, criptomonedas y divisas. Tú eliges qué seguir.':section==='prices'?'Compara precios en tiendas españolas y vigila los que quieras.':'Organiza y consulta tus cosas sin salir del panel.'}</p></div><span className="today">{new Intl.DateTimeFormat('es-ES',{dateStyle:'full',timeZone:'Europe/Madrid'}).format(new Date())}</span></div>
  {error&&<div className="alert" role="alert"><AlertCircle size={18}/><span>{error}</span>{retry&&<button className="retry" onClick={retry}>Reintentar</button>}<button onClick={()=>{setError('');setRetry(null)}} aria-label="Cerrar error"><X size={16}/></button></div>}{notice&&<div className="notice" role="status"><Check size={17}/>{notice}</div>}
  <DataFreshness updatedAt={updatedAt} loading={loading} problem={refreshProblem} onRefresh={()=>void refresh()}/>
  {section==='overview'&&<div className="overview-layout"><AssistantChat token={token} onChange={()=>refresh()}/>
    <TodaySummary token={token} data={data} goTo={setSection} isLoading={loading} onAdd={setAddType} answerHabit={(habitId,done)=>void action('habit_checks','POST',{habit_id:habitId,done},undefined,done?'Hábito apuntado. ¡Bien!':'Apuntado como no hecho hoy.')}/>
    <div className="summary-grid overview-metrics" aria-label="Tus secciones">
      <SectionLink target="finances" goTo={setSection} className="metric metric-link"><div className="metric-icon warm"><Wallet size={21}/></div><span>Finanzas</span><strong className={totals.earned-totals.spent>=0?'positive':'negative'}>{euro(totals.earned-totals.spent)}</strong><small>Balance de caja · últimos {period} días</small></SectionLink>
      <SectionLink target="habits" goTo={setSection} className="metric metric-link"><div className="metric-icon mint"><Flame size={21}/></div><span>Hábitos</span><strong>{rows('habit_checks').filter(r=>r.date===todayInMadrid()&&r.done).length} completados</strong><small>Tu progreso de hoy</small></SectionLink>
      <SectionLink target="markets" goTo={setSection} className="metric metric-link"><div className="metric-icon lilac"><TrendingUp size={21}/></div><span>Mercados</span><strong>Tu seguimiento</strong><small>Empresas, cripto y divisas</small></SectionLink>
      <SectionLink target="prices" goTo={setSection} className="metric metric-link"><div className="metric-icon peach"><Tag size={21}/></div><span>Precios</span><strong>Comparar y vigilar</strong><small>Productos y ofertas</small></SectionLink>
    </div>
    <details className="home-more"><summary>Próximos planes</summary><div className="home-more-content"><div className="two-cols overview-upcoming"><Card className="section-card" title={<SectionLink target="reminders" goTo={setSection} className="card-section-link">Próximos recordatorios <ArrowUpRight size={16} aria-hidden="true"/></SectionLink>}>{rows('reminders').length?rows('reminders').slice(0,4).map(r=><div className="list-row" key={r.id}><span className="row-symbol lilac"><Bell size={17}/></span><span className="row-main"><strong>{r.text}</strong><small>{dateTime(r.remind_at)}</small></span></div>):<Empty>No tienes recordatorios pendientes.</Empty>}</Card><Card className="section-card" title={<SectionLink target="calendar" goTo={setSection} className="card-section-link">En tu calendario <ArrowUpRight size={16} aria-hidden="true"/></SectionLink>}>{data.calendar?.connected?data.calendar.events.length?data.calendar.events.slice(0,4).map((e:Row,i:number)=><div className="list-row" key={i}><span className="row-symbol mint"><CalendarDays size={17}/></span><span className="row-main"><strong>{e.title}</strong><small>{e.start?dateTime(e.start):e.date}</small></span></div>):<Empty>No hay eventos en los próximos días.</Empty>:<Empty>Conecta Google Calendar para ver tus eventos.</Empty>}</Card></div></div></details>
  </div>}
  {section==='finances'&&<><Card title="Gastos compartidos"><LifePanels api={panelApi} view="finances" onChanged={()=>refresh()}/></Card><FinanceInsights api={panelApi}/>{budgets.filter((r:Row)=>budgetState(r.spent,Number(r.budget.monthly_limit)).level!=='ok').map((r:Row)=><div key={r.budget.id} className={`budget-warning ${budgetState(r.spent,Number(r.budget.monthly_limit)).level}`} role="status"><AlertTriangle size={17} aria-hidden="true"/><span><strong>{r.budget.category}:</strong> {budgetState(r.spent,Number(r.budget.monthly_limit)).text}</span></div>)}<MarketsStrip token={token} onMore={()=>setSection('markets')}/><div className="section-toolbar"><div className="segmented" role="group" aria-label="Periodo de finanzas">{[7,30,90].map(p=><button key={p} className={period===p?'selected':''} aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p} días</button>)}</div></div><div className="summary-grid finance-metrics"><div className="metric income-tile"><span>Ingresos sin reembolsos</span><strong className="positive">{euro(totals.earned-totals.reimbursements)}</strong><small><ArrowUpRight size={14}/> En el periodo</small></div><div className="metric expense-tile"><span>Gastos</span><strong>{euro(totals.spent)}</strong><small><ArrowDownRight size={14}/> En el periodo</small></div><div className="metric balance-tile"><span>Balance de caja</span><strong className={totals.earned-totals.spent>=0?'positive':'negative'}>{euro(totals.earned-totals.spent)}</strong><small>Entradas − salidas</small></div></div><div className="bank-strip"><div><strong>{data.bank_connection?.connected?'Banco conectado':'Conecta tu banco'}</strong><p>{data.bank_connection?.connected?'Los movimientos se importan automáticamente cada día.':'Conecta tu cuenta para ver tus gastos e ingresos aquí.'}</p></div>{data.bank_connection?.connected?<button className="secondary" onClick={()=>{if(window.confirm('¿Desconectar el banco? Los movimientos importados se conservarán.'))void action('bank_connection','DELETE')}}>Desconectar</button>:<button className="primary" onClick={async()=>{try{const result=await api('bank_link',token,'POST',{});window.location.assign(result.url)}catch(e){setError(e instanceof Error?e.message:'No se pudo conectar')}}}>Conectar banco <ArrowUpRight size={17}/></button>}</div><div className="two-cols"><p className="form-hint">Reembolsos conciliados en este periodo: {euro(totals.reimbursements)}. Se separan de los ingresos; el balance de caja conserva todas las entradas y salidas reales.</p><Card title="Análisis de gastos"><SpendingChart expenses={expenses} period={period}/></Card><TobaccoCard expenses={expenses} period={period}/></div><div className="two-cols"><EnergyDrinkCard expenses={expenses} period={period}/><BizumCard expenses={expenses} incomes={incomes} period={period}/></div><Card title="Presupuestos mensuales"><form className="budget-form" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void action('budgets','POST',{category:form.get('category'),monthly_limit:Number(form.get('limit'))});e.currentTarget.reset()}}><label>Categoría<select name="category" required>{['Total','Supermercado','Restaurantes','Transporte','Hogar','Suscripciones','Ocio','Salud','Compras','Otros'].map(c=><option key={c}>{c}</option>)}</select></label><label>Límite mensual (€)<input name="limit" type="number" min="0.01" step="0.01" required placeholder="200"/></label><button className="primary" type="submit">Guardar</button></form>{budgets.length?budgets.map((r:Row)=><div className="budget-item" key={r.budget.id}><div className="between"><strong>{r.budget.category}</strong><button className="delete icon-button" aria-label={`Quitar presupuesto de ${r.budget.category}`} onClick={()=>void action('budgets','DELETE',undefined,{category:r.budget.category})}><Trash2 size={16}/></button></div><p>{euro(r.spent)} de {euro(Number(r.budget.monthly_limit))}</p><div className="track"><span className={budgetState(r.spent,Number(r.budget.monthly_limit)).level} style={{width:`${Math.min(100,r.spent/Number(r.budget.monthly_limit)*100)}%`}}/></div><p className={`budget-state ${budgetState(r.spent,Number(r.budget.monthly_limit)).level}`}>{budgetState(r.spent,Number(r.budget.monthly_limit)).text}</p></div>):<Empty>Aún no has creado presupuestos.</Empty>}</Card><MovementSearch token={token}/><Card title="Movimientos recientes"><div className="table-wrap" tabIndex={0} role="region" aria-label="Movimientos (desliza para ver todas las columnas)"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Importe</th></tr></thead><tbody>{([...(expenses.map(r=>({...r,kind:'expense'}))),...(incomes.map(r=>({...r,kind:'income'})))] as Row[]).sort((a,b)=>b.booking_date.localeCompare(a.booking_date)).slice(0,25).map((r,i)=><tr key={`${r.kind}-${r.id}-${i}`}><td>{r.booking_date}</td><td>{r.description}</td><td>{r.kind==='income'?(reimbursementIds.has(r.id)?'Reembolso':'Ingreso'):r.category}</td><td className={r.kind==='income'?'positive':''}>{r.kind==='income'?'+':'−'}{euro(Number(r.amount))}</td></tr>)}</tbody></table>{!expenses.length&&!incomes.length&&<Empty>No hay movimientos en este periodo.</Empty>}</div></Card></>}
  {section==='reminders'&&<Card title="Tus recordatorios" aside={<span className="count">{rows('reminders').length} pendientes</span>}><ReminderForm save={payload=>action('reminders','POST',payload)}/>{rows('reminders').map(r=><div className="list-row" key={r.id}><span className="row-symbol lilac"><Bell size={17}/></span><span className="row-main"><strong>{r.text}</strong><small>{dateTime(r.remind_at)} {r.repeat?`· ${r.repeat}`:''} · Aviso {r.advance_minutes===1440?'un día':'30 min'} antes</small></span><button className="delete icon-button" aria-label={`Eliminar ${r.text}`} onClick={()=>void action('reminders','DELETE',undefined,{id:String(r.id)})}><Trash2 size={17}/></button></div>)}{!rows('reminders').length&&<Empty>Añade tu primer recordatorio arriba.</Empty>}</Card>}
  {section==='shopping_items'&&<Card title="Por comprar" aside={<span className="count">{rows('shopping_items').length} productos</span>}><InlineForm label="Añadir producto" placeholder="Añadir a la lista…" onSubmit={text=>action('shopping_items','POST',{text})}/>{rows('shopping_items').map(r=><div className="list-row" key={r.id}><button className="check-button" aria-label={`Marcar ${r.text} como comprado`} onClick={()=>void action('shopping_items','DELETE',undefined,{id:String(r.id)},'Tachado de la lista.')}><Check size={16}/></button><span className="row-main"><strong>{r.text}</strong></span><button className="delete icon-button" aria-label={`Eliminar ${r.text}`} onClick={()=>void action('shopping_items','DELETE',undefined,{id:String(r.id)})}><Trash2 size={17}/></button></div>)}{!rows('shopping_items').length&&<Empty>Tu lista está vacía. Añade algo que necesites.</Empty>}</Card>}
  {section==='birthdays'&&<Card title="Cumpleaños" aside={<span className="count">{rows('birthdays').length} personas</span>}><form className="stack-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action('birthdays','POST',{name:f.get('name'),day:Number(f.get('day')),month:Number(f.get('month')),year:f.get('year')});e.currentTarget.reset()}}><div className="form-row"><label>Nombre<input name="name" required placeholder="Nombre"/></label><label>Día<input name="day" type="number" min="1" max="31" required placeholder="Día"/></label><label>Mes<select name="month">{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Intl.DateTimeFormat('es-ES',{month:'long'}).format(new Date(2024,i,1))}</option>)}</select></label><label>Año opcional<input name="year" type="number" min="1900" max="2100" placeholder="Año"/></label><button className="primary" type="submit"><Plus size={17}/> Añadir</button></div></form>{rows('birthdays').sort((a,b)=>a.month-b.month||a.day-b.day).map(r=><div className="list-row" key={r.id}><span className="row-symbol peach"><Cake size={18}/></span><span className="row-main"><strong>{r.name}</strong><small>{r.day} de {new Intl.DateTimeFormat('es-ES',{month:'long'}).format(new Date(2024,r.month-1,1))}{r.year?` · ${r.year}`:''}</small></span><button className="delete icon-button" aria-label={`Eliminar cumpleaños de ${r.name}`} onClick={()=>void action('birthdays','DELETE',undefined,{id:String(r.id)})}><Trash2 size={17}/></button></div>)}{!rows('birthdays').length&&<Empty>Añade un cumpleaños para que no se te pase.</Empty>}</Card>}
  {section==='habits'&&<HabitsSection habits={rows('habits')} checks={rows('habit_checks')} action={action}/>}
  {section==='weight'&&<WeightSection entries={rows('weight_entries')} save={payload=>action('weight_entries','POST',payload)} remove={id=>void action('weight_entries','DELETE',undefined,{id:String(id)})}/>}
  {section==='calendar'&&<AgendaSection token={token} reminders={rows('reminders')} habits={rows('habits')} checks={rows('habit_checks')} calendar={data.calendar} saveEvent={payload=>action('calendar','POST',payload,undefined,'Evento creado en tu calendario.')} goToSettings={()=>setSection('settings')}/>}
  {section==='weather'&&<WeatherSection forecasts={Array.isArray(data.weather)?data.weather:undefined} alerts={Array.isArray(data.weather_alerts)?data.weather_alerts:undefined}/>}
  {section==='news'&&<NewsSection token={token}/>}
  {section==='markets'&&<MarketsSection token={token}/>}
  {section==='prices'&&<PricesSection token={token}/>}
  {section==='notes'&&<NotesPanel key={token} api={panelApi}/>}
  {section==='settings'&&<><Card title="Preferencias del día a día"><LifePanels api={panelApi} view="settings"/></Card><SettingsSection token={token} onChange={()=>refresh()}/></>}
  {section==='memory'&&<MemorySection content={String(data.memory?.content??'')} save={content=>action('memory','POST',{content},undefined,'Memoria guardada.')}/>}
  <footer>Tu asistente personal · Datos desde Supabase</footer></main></div>
  <nav className="bottom-nav" aria-label="Accesos rápidos">{BOTTOM_NAV.map(id=>{const item=navigation.find(n=>n.id===id)!,Icon=item.icon;return <a href={sectionSearch(window.location.search,id)} key={id} className={section===id?'active':''} aria-current={section===id?'page':undefined} onClick={e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();setSection(id)}}><Icon size={20} aria-hidden="true"/><span>{item.label}</span></a>})}<button className={mobileOpen?'active':''} aria-label="Más secciones" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(true)}><Menu size={20} aria-hidden="true"/><span>Más</span></button></nav>
  <UndoTray queue={removalQueue}/>
  {isSearching&&<SearchDialog token={token} onClose={()=>setIsSearching(false)} goTo={target=>{setIsSearching(false);setSection(target);window.scrollTo({top:0})}}/>}
  {addType&&<AddDialog type={addType} setType={setAddType} token={token} isCalendarConnected={!!data.calendar?.connected} onClose={()=>setAddType(null)} onSaved={async message=>{setAddType(null);setError('');setRetry(null);setNotice(message);await refresh()}} goToSettings={()=>{setAddType(null);setSection('settings')}}/>}</div>
}

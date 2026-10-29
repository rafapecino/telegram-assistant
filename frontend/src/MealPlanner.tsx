// Menú de la semana: ideas de platos para elegir y revisión de ingredientes antes de pasarlos a la compra.
import { useEffect, useState, type FormEvent } from 'react';
import { Check, ChefHat, RefreshCw, ShoppingBasket, Sparkles, Trash2 } from 'lucide-react';

export interface Dish { id:number; name:string; description:string; ingredients:string[]; chosen:boolean; cooked:boolean }
export interface PendingIngredient { key:string; text:string; skipped:boolean }
export interface MealPlan { week_start:string; dishes:Dish[]; pending:PendingIngredient[] }
type Api = (resource:string, method?:string, payload?:object, params?:Record<string,string>) => Promise<any>;

const plural = (n:number, one:string, many:string) => `${n} ${n===1?one:many}`;

/** En la lista de la compra: pedir ideas, elegir platos y revisar sus ingredientes. */
export function MealPlanner({api,onChange}:{api:Api;onChange:()=>void}) {
  const [plan,setPlan]=useState<MealPlan|null>(null);
  const [hint,setHint]=useState('');
  const [picked,setPicked]=useState<Set<number>>(new Set());
  const [toBuy,setToBuy]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState<''|'ideas'|'choose'|'add'|'load'>('load');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  function show(next:MealPlan){
    setPlan(next);
    // Por defecto se compra todo; lo que ya tengas lo desmarcas.
    setToBuy(new Set(next.pending.map(item=>item.key)));
  }
  useEffect(()=>{let active=true;api('meal_plan').then(next=>{if(active)show(next)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy('')});return()=>{active=false}},[api]);

  async function run(kind:'ideas'|'choose'|'add', request:()=>Promise<MealPlan&{added?:string[]}>, done:(result:MealPlan&{added?:string[]})=>string){
    setBusy(kind);setError('');setMessage('');
    try{const result=await request();show(result);setMessage(done(result));onChange()}
    catch(e){setError(e instanceof Error?e.message:'No se pudo completar.')}
    finally{setBusy('')}
  }
  function askIdeas(e?:FormEvent){
    e?.preventDefault();
    setPicked(new Set());
    void run('ideas',()=>api('meal_ideas','POST',{hint:hint.trim()}),()=>'Aquí tienes ideas nuevas. Elige las que te apetezcan.');
  }
  const ideas=plan?.dishes.filter(d=>!d.chosen)??[];
  const menu=plan?.dishes.filter(d=>d.chosen)??[];
  const pending=plan?.pending??[];
  const toggle=<T,>(set:Set<T>,value:T)=>{const next=new Set(set);if(next.has(value))next.delete(value);else next.add(value);return next};

  return <section className="card meal-planner" aria-labelledby="meal-planner-title">
    <div className="card-heading"><h2 id="meal-planner-title"><ChefHat size={19} aria-hidden="true"/> Ideas para la semana</h2>{menu.length>0&&<span className="count">{plural(menu.length,'plato','platos')} en tu menú</span>}</div>
    <p className="meal-help">Te propongo platos y tú eliges. Sus ingredientes los revisas antes de que pasen a la lista.</p>
    <form className="form-row meal-ask" onSubmit={askIdeas}>
      <label className="meal-hint"><span>¿Algo en concreto? <span className="optional">(opcional)</span></span>
        <input value={hint} onChange={e=>setHint(e.target.value)} maxLength={200} placeholder="rápido, con pollo, sin horno…"/>
      </label>
      <button className="primary" type="submit" disabled={!!busy}>{busy==='ideas'?<><RefreshCw size={16} className="spin" aria-hidden="true"/> Pensando…</>:ideas.length?<><RefreshCw size={16} aria-hidden="true"/> Otras ideas</>:<><Sparkles size={16} aria-hidden="true"/> Dame ideas</>}</button>
    </form>
    {error&&<p className="error" role="alert">{error}</p>}
    <p className="sr-only" role="status">{busy==='ideas'?'Pensando ideas de platos…':message}</p>
    {message&&!error&&<p className="meal-message" aria-hidden="true">{message}</p>}

    {ideas.length>0&&<fieldset className="meal-ideas">
      <legend>Elige los que te apetezcan</legend>
      <div className="meal-grid">{ideas.map(d=><label key={d.id} className={`meal-idea ${picked.has(d.id)?'selected':''}`}>
        <input type="checkbox" checked={picked.has(d.id)} onChange={()=>setPicked(toggle(picked,d.id))}/>
        <span><strong>{d.name}</strong>{d.description&&<small>{d.description}</small>}<em>{d.ingredients.join(', ')}</em></span>
      </label>)}</div>
      <button className="primary" type="button" disabled={!picked.size||!!busy} onClick={()=>void run('choose',()=>api('meal_plan','POST',{action:'choose',ids:[...picked]}),()=>{setPicked(new Set());return 'Añadido a tu menú. Revisa los ingredientes abajo.'})}><Check size={16} aria-hidden="true"/> {picked.size?`Añadir ${plural(picked.size,'plato','platos')} al menú`:'Elige algún plato'}</button>
    </fieldset>}

    {pending.length>0&&<fieldset className="meal-ingredients">
      <legend>Ingredientes de tu menú</legend>
      <p className="meal-help">Desmarca lo que ya tengas en casa.</p>
      <div className="meal-chips">{pending.map(item=><label key={item.key} className={`meal-chip ${toBuy.has(item.key)?'':'have'}`}>
        <input type="checkbox" checked={toBuy.has(item.key)} onChange={()=>setToBuy(toggle(toBuy,item.key))}/>{item.text}
      </label>)}</div>
      <button className="primary" type="button" disabled={!!busy} onClick={()=>void run('add',()=>api('meal_plan','POST',{action:'add_ingredients',keys:[...toBuy]}),r=>r.added?.length?`Añadido a la lista: ${r.added.join(', ')}.`:'No había nada nuevo que añadir.')}><ShoppingBasket size={16} aria-hidden="true"/> {toBuy.size?`Añadir ${plural(toBuy.size,'ingrediente','ingredientes')} a la compra`:'Ya lo tengo todo'}</button>
    </fieldset>}

    {busy==='load'&&<p className="meal-help">Cargando tu menú…</p>}
    {!busy&&plan&&!ideas.length&&!menu.length&&<p className="empty">Pide ideas y elige los platos de la semana. También puedes decírselo al asistente: «dame ideas para comer».</p>}
  </section>;
}

/** En Inicio: los platos elegidos esta semana, para tacharlos al cocinarlos. */
export function WeekMenuCard({plan,onCook,onRemove,onOpen}:{plan?:MealPlan;onCook:(dish:Dish)=>void;onRemove:(dish:Dish)=>void;onOpen:()=>void}) {
  const menu=plan?.dishes.filter(d=>d.chosen)??[];
  const cooked=menu.filter(d=>d.cooked).length;
  return <section className="card meal-week" aria-labelledby="meal-week-title">
    <div className="card-heading"><h2 id="meal-week-title"><ChefHat size={19} aria-hidden="true"/> Menú de la semana</h2>{menu.length>0&&<span className="count">{cooked} de {menu.length} hechos</span>}</div>
    {menu.length?menu.map(d=><div className="list-row" key={d.id}>
      <button className={`check-button ${d.cooked?'done':''}`} aria-pressed={d.cooked} aria-label={d.cooked?`Desmarcar ${d.name} como cocinado`:`Marcar ${d.name} como cocinado`} onClick={()=>onCook(d)}><Check size={16}/></button>
      <span className="row-main"><strong className={d.cooked?'meal-cooked':''}>{d.name}</strong>{d.description&&<small>{d.description}</small>}</span>
      <button className="delete icon-button" aria-label={`Quitar ${d.name} del menú`} onClick={()=>onRemove(d)}><Trash2 size={17}/></button>
    </div>):<p className="empty">Aún no has elegido platos esta semana.</p>}
    <button className="secondary meal-open" type="button" onClick={onOpen}>{menu.length?'Pedir más ideas':'Elegir platos'}</button>
  </section>;
}

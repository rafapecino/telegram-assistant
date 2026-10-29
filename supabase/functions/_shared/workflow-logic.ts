// Pure rules shared by capture, import and review. No provider or database access.
export const CATEGORIES = ['Supermercado','Restaurantes','Transporte','Hogar','Suscripciones','Ocio','Salud','Compras','Otros'];
export const normalizeMerchant = (s:string) => s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
export type CaptureValues = {description:string;amount?:number;date:string;category:string;payment_method:'unknown'|'cash'|'card'};
const numbers:Record<string,number>={un:1,una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6};
export function expenseCapture(text:string,today:string):CaptureValues|null {
 const s=normalizeMerchant(text);
 if(!/^(anade|apunta|registra|pon|he comprado|he gastado|gaste)\b/.test(s)||/\b(compra|comprar)\b/.test(s)&&!/he comprado/.test(s))return null;
 const energy=/\b(energeticas?|energetis?|yeti|yetis)\b/.test(s),tobacco=/\b(tabaco|cajetilla)\b/.test(s);
 if(!energy&&!tobacco&&!/\b(gasto|gastado|gaste)\b/.test(s))return null;
 const quantityText=s.match(/\b(un|una|uno|dos|tres|cuatro|cinco|seis|\d+)\s+(?:energeticas?|energetis?|yetis?)\b/)?.[1];
 const quantity=quantityText?(numbers[quantityText]??Number(quantityText)):1;
 const explicit=s.match(/(?:\bde\s+|\bpor\s+|\btotal\s+)(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)?\s*$/)?.[1]
  ??s.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)/)?.[1]
  ??s.match(/(?:tabaco|gasto)\s+(\d+(?:[.,]\d{1,2})?)\s*$/)?.[1];
 const amount=explicit?Number(explicit.replace(',','.')):energy?quantity*1.2:undefined;
 // Historical dates are left to the existing language parser instead of silently becoming today.
 if(/\b(ayer|anteayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|\d{4}-\d{2}-\d{2}/.test(s))return null;
 let description=energy?`ENERGÉTICA x${quantity} (apuntado a mano)`:tobacco?'TABACO (apuntado a mano)':text.replace(/^(?:añade|apunta|registra|pon)\s+(?:un\s+)?gasto\s*(?:de\s+)?/i,'').trim();
 if(!description)description='Gasto';
 return {description,amount,date:today,category:'Otros',payment_method:/\befectivo\b/.test(s)?'cash':/\btarjeta\b/.test(s)?'card':'unknown'};
}
export function correctCapture(values:CaptureValues,text:string):CaptureValues|null {
 const s=normalizeMerchant(text), next={...values};let changed=false;
 if(/^(?:eran?|son|cantidad|cambia(?:lo)? a)\s+(un[ao]?|dos|tres|cuatro|cinco|seis|\d+)(?:\s+(?:energeticas?|latas))?[.!]?$/.test(s)&&/^ENERGÉTICA x\d+/.test(values.description)){
  const n=s.match(/(?:eran?|son|cantidad|cambia(?:lo)? a)\s+(un[ao]?|dos|tres|cuatro|cinco|seis|\d+)/)![1];const q=numbers[n]??Number(n);
  if(q<1||q>20)return null;
  const old=Number(values.description.match(/x(\d+)/)![1]);
  next.description=values.description.replace(/x\d+/,`x${q}`);if(values.amount!==undefined)next.amount=Math.round(values.amount/old*q*100)/100;changed=true;
 }
 const m=s.match(/^(?:importe\s*:?\s*|(?:eran?|son|cuesta|total)\s+)?(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?)?$/);
 if(m&&!changed){next.amount=Number(m[1].replace(',','.'));changed=true;}
 if(/^(?:en |con |pago |pagado (?:en|con) )?(?:efectivo|tarjeta)$/.test(s)){next.payment_method=s.includes('efectivo')?'cash':'card';changed=true;}
 return changed?next:null;
}
export interface ReviewExpense {id:number;account_uid:string;booking_date:string;amount:number|string;currency:string;description:string;payment_method?:string;duplicate_of?:number|null;}
export function duplicateCandidates(expenses:ReviewExpense[],dismissed:{manual_id:number;bank_id:number}[]=[]){
 const excluded=new Set(dismissed.map(x=>`${x.manual_id}:${x.bank_id}`)),used=new Set(expenses.flatMap(x=>x.duplicate_of?[x.duplicate_of]:[]));
 const bank=expenses.filter(x=>x.account_uid!=='manual'&&!x.duplicate_of&&!used.has(x.id));
 return expenses.filter(m=>m.account_uid==='manual'&&!m.duplicate_of&&m.payment_method!=='cash').flatMap(manual=>bank.filter(b=>Number(b.amount)===Number(manual.amount)&&b.currency===manual.currency&&Math.abs(Date.parse(b.booking_date)-Date.parse(manual.booking_date))<=7*86400000&&!excluded.has(`${manual.id}:${b.id}`)).map(bank=>({manual,bank,reason:normalizeMerchant(bank.description)===normalizeMerchant(manual.description)?'Mismo importe, concepto y fecha cercana':'Mismo importe y fecha cercana; comprueba el comercio'})));
}

import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.3';
import {addDaysToDate} from './madrid-time.ts';
/** Páginas pequeñas para no confundir el límite de filas de PostgREST con el total real. */
export async function loadFinanceInsightExpenses(db:SupabaseClient,today:string){
  const expenses:Record<string,unknown>[]=[],from=addDaysToDate(today,-120);
  let total:number|null=null;
  for(let offset=0;offset<2000;offset+=500){
    const {data,error,count}=await db.from('expenses').select('id,booking_date,description,amount,category',{count:'exact'})
      .gte('booking_date',from).lte('booking_date',today).order('booking_date',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
    if(error)throw error;
    if(typeof count==='number')total=count;
    const page=data??[];expenses.push(...page);
    if(page.length<500||(total!==null&&expenses.length>=total))break;
  }
  return {expenses,truncated:total===null?expenses.length>=2000:expenses.length<total};
}

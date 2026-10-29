// Isolated backend unit tests: no database, mail or Telegram calls leave this process.
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('..',import.meta.url));
await mkdir(`${project}/node_modules/.cache/qa`,{recursive:true});
await build({entryPoints:[`${project}/../supabase/functions/_shared/life_test.ts`],outfile:`${project}/node_modules/.cache/qa/life-tests.mjs`,bundle:true,format:'esm',platform:'node',plugins:[{name:'test-runtime',setup(b){
 b.onResolve({filter:/^jsr:@std\/assert/},()=>({path:'assert',namespace:'unit'}));
 b.onLoad({filter:/.*/,namespace:'unit'},()=>({contents:`import a from 'node:assert/strict'; export const assertEquals=a.deepStrictEqual;export const assertThrows=a.throws;export const assertStringIncludes=(s,v)=>a.ok(s.includes(v));`}));
 b.onResolve({filter:/^npm:@supabase\/supabase-js/},()=>({path:'supabase',namespace:'fake'}));
 b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`export const createClient=()=>{throw new Error('Unexpected real DB access in unit test')}`}));
}}]});
const tests=[];globalThis.Deno={test:(name,fn)=>tests.push({name,fn}),env:{get:k=>process.env[k],set:(k,v)=>process.env[k]=v,delete:k=>delete process.env[k]}};
await import(`${project}/node_modules/.cache/qa/life-tests.mjs`);
for(const {name,fn} of tests){await fn();console.log('PASS:',name)}

// Runs the canonical Deno tests under Node without network or real provider access.
import {build} from 'esbuild';import {readdir,mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const project=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url),folder=`${project}/../supabase/functions/_shared`,tests=[];
await mkdir(`${project}/node_modules/.cache/qa`,{recursive:true});
globalThis.fetch=async()=>{throw new Error('Unexpected network access in isolated tests')};
globalThis.Deno={test:(name,fn)=>tests.push({name,fn}),env:{get:k=>process.env[k],set:(k,v)=>process.env[k]=v,delete:k=>delete process.env[k]}};
const assertions=`import a from 'node:assert/strict';export const assertEquals=a.deepStrictEqual,assertNotEquals=a.notDeepStrictEqual,assert=a.ok,assertMatch=a.match;export const assertStringIncludes=(s,v)=>a.ok(s.includes(v));const match=(C,m)=>e=>(!C||e instanceof C)&&(!m||e.message.includes(m));export const assertThrows=(fn,C,m)=>{try{fn()}catch(e){a.ok(match(C,m)(e));return e}a.fail('Expected exception')};export const assertRejects=async(fn,C,m)=>{try{await fn()}catch(e){a.ok(match(C,m)(e));return e}a.fail('Expected rejection')};`;
for(const file of (await readdir(folder)).filter(f=>f.endsWith('_test.ts'))){
 const outfile=`${project}/node_modules/.cache/qa/all-${file}.mjs`;
 await build({entryPoints:[`${folder}/${file}`],outfile,bundle:true,format:'esm',platform:'node',plugins:[{name:'runtime',setup(b){b.onResolve({filter:/^jsr:@std\/assert/},()=>({path:'assert',namespace:'unit'}));b.onLoad({filter:/.*/,namespace:'unit'},()=>({contents:assertions}));b.onResolve({filter:/^npm:fast-xml-parser/},()=>({path:require.resolve('fast-xml-parser')}));b.onResolve({filter:/^npm:@supabase\/supabase-js/},()=>({path:'supabase',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`export const createClient=()=>{throw new Error('Unexpected DB access')}`}));}}]});await import(outfile);
}
let failures=0;for(const {name,fn} of tests){try{await fn()}catch(e){failures++;console.error('FAIL:',name,e.stack)}}console.log(`${tests.length-failures}/${tests.length} backend tests passed`);if(failures)process.exitCode=1;

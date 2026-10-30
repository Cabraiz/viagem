// erros-da-sala-dizem-o-que-fazer (auditoria-erros-cliente E5): a page outside the allowed origins hears, in pt-BR and
// in the lobby's JSON, where the game opens; the browser can read it (CORS), so it is not a raw 'Failed to fetch'.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {createRoom,lobbyErrorText} from '../../src/client/lobby.ts';
import {ORIGIN_REFUSED} from '../../multiplayer/origins.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {default:worker}=await import('../../multiplayer/worker.ts');

const env={ALLOW_LOCAL:'false'} as any;
const ENDPOINT='https://viagem-salas.viagem.workers.dev';

test('an origin outside the list: 403 JSON {error}, readable by that page, kept out of caches',async()=>{
  const r=await worker.fetch(new Request(`${ENDPOINT}/rooms`,{method:'POST',headers:{Origin:'https://copia-do-jogo.example'}}),env);
  assert.equal(r.status,403);
  assert.match(r.headers.get('Content-Type')??'',/application\/json/);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal(r.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await r.json(),{error:ORIGIN_REFUSED});
  assert.match(ORIGIN_REFUSED,/viagem\.cyou/);assert.doesNotMatch(ORIGIN_REFUSED,/Origin|allowed/);
});

test('the lobby shows the 403 as it is ("Criar sala" does not retry an answer)',async()=>{
  let calls=0;
  const fetcher=(async(url:URL,init?:RequestInit)=>{calls++;return worker.fetch(new Request(url,{...init,headers:{Origin:'http://outro-site.example'}}),env);}) as unknown as typeof fetch;
  const error=await createRoom(ENDPOINT,{},{fetcher,wait:async()=>{}}).then(()=>undefined,(e:unknown)=>e);
  assert.ok(error instanceof Error);
  assert.equal(lobbyErrorText(error),ORIGIN_REFUSED);
  assert.equal(calls,1);
});

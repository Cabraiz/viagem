/**
 * The rooms Worker's lab doors (VGM-042b review): /lab, LAB_HORDE and LAB_WORLD only exist with ALLOW_LOCAL.
 * Runs worker.ts under node with a stand-in for the `cloudflare:workers` module (only DurableObject is used).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {default:worker,GameRoom}=await import('../multiplayer/worker.ts');

let called=0;
const env=(local:string)=>({ALLOW_LOCAL:local,LAB_HORDE:'300',LAB_WORLD:'infinito',
  ROOMS:{idFromName:(n:string)=>n,get:()=>({lab:async()=>{called++;return {secret:1};}})}}) as any;
const lab=(origin?:string)=>new Request('https://viagem-salas.viagem.workers.dev/lab/ABCDEF0123',{headers:origin?{Origin:origin}:{}});

test('deployed Worker: /lab does not exist, whatever the origin',async()=>{
  for(const origin of ['https://viagem.cyou','http://127.0.0.1:4312',undefined]){
    const r=await worker.fetch(lab(origin),env('false'));
    assert.ok(r.status===404||r.status===403,`${origin} -> ${r.status}`);
  }
  assert.equal(called,0,'the room was never asked');
});
test('local Worker (ALLOW_LOCAL): /lab answers',async()=>{
  const r=await worker.fetch(lab('http://127.0.0.1:4312'),env('true'));
  assert.equal(r.status,200);assert.equal(called,1);assert.deepEqual(await r.json(),{secret:1});
});
test('deployed Worker: rooms ignore LAB_HORDE and LAB_WORLD, and the lab RPC answers nothing',()=>{
  const g=new GameRoom({storage:{}} as any,env('false')) as any,room=g.create(Date.now(),1);
  assert.equal(room.labHorde,0);assert.equal(room.sampling,false);assert.equal(room.sim.terrain.chunks,undefined,'island, not the endless world');
  g.room=room;assert.equal(g.lab(),null);
  const local=new GameRoom({storage:{}} as any,env('true')) as any,labRoom=local.create(Date.now(),1);
  assert.equal(labRoom.labHorde,300);assert.equal(labRoom.sampling,true);assert.ok(labRoom.sim.terrain.chunks,'lab room in the endless world');
});
test('/health says protocol 6 to anyone',async()=>{
  const r=await worker.fetch(new Request('https://viagem-salas.viagem.workers.dev/health'),env('false'));
  assert.equal((await r.json()).protocol,6);
});

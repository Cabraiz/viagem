// sala-rede-ruim-e-convite (auditoria multijogador 5 e 7): creating a room on a bad network and behind a shared IP, and
// the owner who leaves the app to send the invite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {DEVICE_KEY,DEVICE_PATTERN,deviceId} from '../../src/client/net/room-device.ts';
import {soloOneRetry,soloRefused,soloRetryable} from '../../src/client/ui/solo-plan.ts';
import {RunLifecycle,RUN_COUNTDOWN_TICKS,RUN_HZ,LOBBY_AWAY_TICKS} from '../../src/sim/run.ts';
import {SILENT_MS} from '../../multiplayer/room.ts';

const hooks=`export async function resolve(spec,ctx,next){
  if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}',shortCircuit:true};
  return next(spec,ctx);
}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const {default:worker,readDevice,createLimitKeys}=await import('../../multiplayer/worker.ts');
const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');

/** A RateLimit binding: `limit` per key in this test's one minute. */
const bucket=(limit:number)=>{const used=new Map<string,number>();return {used,limit:async({key}:{key:string})=>{const n=(used.get(key)??0)+1;used.set(key,n);return {success:n<=limit};}};};
function worldOf(){
  const device=bucket(5),ip=bucket(30),inits:string[]=[];
  const env={ALLOW_LOCAL:'false',CREATE_LIMIT:device,CREATE_IP_LIMIT:ip,ROOMS:{idFromName:(n:string)=>n,get:(n:string)=>({init:async()=>{inits.push(n);}})}} as any;
  const post=(from:string,body?:object)=>{const text=body&&JSON.stringify(body);
    return worker.fetch(new Request('https://viagem-salas.viagem.workers.dev/rooms',{method:'POST',headers:{Origin:'https://viagem.cyou','CF-Connecting-IP':from,...(text?{'content-length':String(Buffer.byteLength(text))}:{})},...(text?{body:text}:{})}),env);};
  return {env,device,ip,inits,post};
}

test('the device id: kept in localStorage, a valid one reused, junk replaced, no storage still answers',()=>{
  const store=new Map<string,string>(),storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
  let made=0;const make=()=>`aaaaaaaa-0000-4000-8000-00000000000${++made}`;
  const first=deviceId(storage,make);assert.match(first,DEVICE_PATTERN);assert.equal(store.get(DEVICE_KEY),first);
  assert.equal(deviceId(storage,make),first,'the same browser, the same id');assert.equal(made,1);
  store.set(DEVICE_KEY,'<script>');assert.notEqual(deviceId(storage,make),'<script>','junk in storage is replaced');
  const broken={getItem:()=>{throw new Error('SecurityError');},setItem:()=>{}};
  assert.match(deviceId(broken,make),DEVICE_PATTERN,'storage off: an id for this page');
  assert.match(deviceId(undefined,make),DEVICE_PATTERN);
});

test('the Worker reads the device id only in its shape, and keys the limits IP + device and IP alone',()=>{
  assert.equal(readDevice({device:'aaaaaaaa-0000-4000-8000-000000000001'}),'aaaaaaaa-0000-4000-8000-000000000001');
  for(const junk of [null,undefined,{},{device:1},{device:'short'},{device:'x'.repeat(41)},{device:'a b c d e f g h'},'device'])assert.equal(readDevice(junk),'');
  assert.deepEqual(createLimitKeys('1.2.3.4','dev-12345678'),{device:'1.2.3.4|dev-12345678',ip:'1.2.3.4'});
  assert.deepEqual(createLimitKeys('1.2.3.4',''),{device:'1.2.3.4',ip:'1.2.3.4'},'an old cached site: the IP, as before');
});

test('two phones behind one IP (CGNAT, school Wi-Fi) do not block each other; the IP alone still has a ceiling',async()=>{
  const {post,inits}=worldOf(),ana={device:'ana-00000001'},bia={device:'bia-00000001'};
  for(let i=0;i<5;i++)assert.equal((await post('10.0.0.1',ana)).status,201);
  const sixth=await post('10.0.0.1',ana);assert.equal(sixth.status,429,'Ana\'s sixth room in a minute: refused');
  assert.equal((await sixth.json()).error,'Aguarde um minuto antes de criar outra sala.');
  assert.equal((await post('10.0.0.1',bia)).status,201,'Bia on the same IP still creates hers');
  // The body still makes the room: map and solo next to the device id.
  assert.equal((await post('10.0.0.1',{map:'cidade-nevada',solo:true,objective:'chaveiro',device:'cid-00000001'})).status,201);
  // Thirty a minute for the IP, however many devices it claims.
  const {post:crowd}=worldOf();let created=0;
  for(let i=0;i<40;i++)created+=Number((await crowd('10.0.0.2',{device:`dev-${String(i).padStart(8,'0')}`})).status===201);
  assert.equal(created,30);
  assert.ok(inits.length>=7);
});

test('a Worker without CREATE_IP_LIMIT (tests, an old binding set) keeps the device limit',async()=>{
  const {env,post}=worldOf();delete env.CREATE_IP_LIMIT;
  for(let i=0;i<5;i++)assert.equal((await post('10.0.0.3',{device:'one-00000001'})).status,201);
  assert.equal((await post('10.0.0.3',{device:'one-00000001'})).status,429);
});

test('the create body with the device id fits the Worker\'s small-body read',()=>{
  const body=JSON.stringify({map:'cidade-nevada',solo:true,objective:'chaveiro',combat:'manual',device:crypto.randomUUID()});
  assert.match(read('multiplayer/worker.ts'),/const CREATE_BODY_MAX=256;/);assert.ok(Buffer.byteLength(body)<=256,`${body.length} bytes`);
});

test('wrangler binds both limits: 5 a minute per IP + device, 30 per IP',()=>{
  const w=read('multiplayer/wrangler.jsonc');
  assert.match(w,/"name": "CREATE_LIMIT", "namespace_id": "1001", "simple": \{ "limit": 5, "period": 60 \}/);
  assert.match(w,/"name": "CREATE_IP_LIMIT", "namespace_id": "1002", "simple": \{ "limit": 30, "period": 60 \}/);
});

test('"Criar sala": one more POST after a timeout or a dropped network, never after a refusal (4xx)',async()=>{
  const lobby=read('src/client/lobby.ts'),open=lobby.slice(lobby.indexOf('async function enter('),lobby.indexOf('export async function openSolo'));
  assert.match(open,/code=await soloOneRetry\(async\(\)=>\{const r=await fetch\(new URL\('\/rooms',endpoint\)/,'the lobby\'s POST goes through the one retry');
  assert.match(open,/throw r\.status<500\?soloRefused\(message\):new Error\(message\)/,'a 4xx is a refusal');
  assert.match(open,/device:deviceId\(\)/,'and carries the device id');
  // The same shape run here: what each answer does.
  const create=async(answers:Array<'rede'|'tempo'|'429'|'500'|'ok'>)=>{
    let n=0;const gaps:number[]=[];
    try{
      const code=await soloOneRetry(async()=>{const what=answers[n++];
        if(what==='rede')throw new TypeError('Failed to fetch');
        if(what==='tempo')throw Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
        if(what==='429')throw soloRefused('Aguarde um minuto antes de criar outra sala.');
        if(what==='500')throw new Error('Não foi possível criar a sala.');
        return 'ABCDEF1234';},error=>soloRetryable(error,false),async ms=>{gaps.push(ms);});
      return {code,posts:n,gaps};
    }catch(e){return {error:(e as Error).message,posts:n,gaps};}
  };
  assert.deepEqual(await create(['rede','ok']),{code:'ABCDEF1234',posts:2,gaps:[800]},'a 3G drop: the second try makes the room');
  assert.deepEqual(await create(['tempo','ok']),{code:'ABCDEF1234',posts:2,gaps:[800]});
  assert.deepEqual(await create(['500','ok']),{code:'ABCDEF1234',posts:2,gaps:[800]},'a cold Worker\'s 5xx');
  assert.deepEqual(await create(['429']),{error:'Aguarde um minuto antes de criar outra sala.',posts:1,gaps:[]},'the limit is not spent twice');
  assert.deepEqual(await create(['rede','rede']),{error:'Failed to fetch',posts:2,gaps:[800]},'two drops: the error, no third POST');
  assert.deepEqual(await create(['ok']),{code:'ABCDEF1234',posts:1,gaps:[]});
});

test('the owner out on the WhatsApp for 30 s (socket closed by the silence, then back) plays the run',()=>{
  // The phone froze the page: the room closed its socket after SILENT_MS; 30 s after "Convidar" it is back.
  assert.equal(LOBBY_AWAY_TICKS,45*RUN_HZ);
  const run=new RunLifecycle('room');run.join('dono');run.join('amigo');
  assert.equal(run.ready('amigo',1,true),true);
  const silent=Math.round(SILENT_MS/1000*RUN_HZ),away=30*RUN_HZ-silent;
  for(let i=0;i<silent;i++)run.step();
  run.setOnline('dono',false);
  for(let i=0;i<away;i++)assert.equal(run.step().started,false,'the friend\'s ready waits for the owner');
  assert.equal(run.snapshot().phase,'lobby');
  run.join('dono');assert.equal(run.ready('dono',1,true),true);
  let started=false;for(let i=0;i<RUN_COUNTDOWN_TICKS;i++)started||=run.step().started;
  const state=run.snapshot();assert.ok(started);assert.equal(state.phase,'combat');
  assert.equal(state.members.find(m=>m.id==='dono')?.spectator,false,'the owner plays, not watches');
});

test('a hidden tab with its socket alive is never away: only a lost socket counts',()=>{
  const run=new RunLifecycle('room');run.join('dono');run.join('amigo');run.ready('amigo',1,true);
  // No setOnline(false): the socket lives (a desktop tab in the background, a phone that keeps it).
  for(let i=0;i<LOBBY_AWAY_TICKS*3;i++)assert.equal(run.step().started,false);
  assert.equal(run.snapshot().members.find(m=>m.id==='dono')?.online,true);
  run.ready('dono',1,true);for(let i=0;i<RUN_COUNTDOWN_TICKS;i++)run.step();
  assert.equal(run.snapshot().members.find(m=>m.id==='dono')?.spectator,false);
});

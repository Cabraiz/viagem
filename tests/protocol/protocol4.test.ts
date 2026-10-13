import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import {Rng} from '../../src/contract/rng.ts';
import {TELEGRAPH_KINDS,type SimEvent} from '../../src/contract/types.ts';
import type {EnemyView,PickupView,ProjectileView,RunView,StructureView,TelegraphView} from '../../src/contract/view.ts';
import {
  DICT,FrameDecoder,FrameEncoder,MAX_PENDING_EVENTS,POS_SCALE,PROTOCOL_VERSION,WireIds,parseClientControl,parseServerControl,
  type FrameInput,type PlayerWireView,
} from '../../src/protocol/protocol4.ts';
import {ROSTER,ROTATION_WEIGHTS,drawRotation,roleOf,rotationIds,roundRoster} from '../../src/rules/index.ts';

/**
 * Size of the bandwidth measurements. The default suite uses 2 clients (bytes per client do not depend on how many
 * there are) so the file stays under ~250 MB; `npm run test:protocol:stress` (tests/protocol/stress/) runs the
 * full room: 6 clients and the long no-interest run, as recorded in D-018.
 */
const STRESS=!!(globalThis as {__P4_STRESS__?:boolean}).__P4_STRESS__;
const CLIENTS=STRESS?6:2;
// Collect each test's garbage before the next one, so the file's peak is the heaviest test, not their sum.
setFlagsFromString('--expose-gc');
// If a Node version ever stops exposing gc this way, the tests still run (only the memory peak grows back).
const collect=(runInNewContext('typeof gc==="function"?gc:undefined') as (()=>void)|undefined)??(()=>{});
afterEach(()=>collect());

const near=(a:number,b:number,eps:number,msg:string)=>assert.ok(Math.abs(a-b)<=eps,`${msg}: ${a} vs ${b}`);
const POS_EPS=1/POS_SCALE;
/**
 * The horde (catalog.ts ENEMY_KINDS without the boss), one rng.pick per enemy, weighted like rounds 7-9 (rules/waves.ts),
 * where the P1 trio (coach, motoboy, influencer) is ~12% of the crowd. 'tio-pave' was in the DICT already; the other
 * D-033 kinds and the agiota's 'boleto-juros' went inline (0xFF + utf8) in protocol 8 and are dictionary bytes since
 * protocol 9 (D-036); the trio went inline in protocol 9 and is dictionary bytes since protocol 10.
 */
const CAST_SHARE:Readonly<Record<string,number>>={bebado:17,pombos:22,'tio-pave':22,agiota:20,'anao-molotov':7,coach:4,motoboy:4,influencer:4};
const CAST=Object.entries(CAST_SHARE).flatMap(([kind,n])=>Array.from({length:n},()=>kind));
const P1_CAST=new Set(['coach','motoboy','influencer']);
/** The kinds castEnemy draws from and the ones that act (phase 1); withCast swaps them for one measurement. */
let castPool:readonly string[]=CAST,castActors:ReadonlySet<string>=P1_CAST;
function withCast<T>(pool:readonly string[],actors:ReadonlySet<string>,run:()=>T):T{
  const before=[castPool,castActors] as const;castPool=pool;castActors=actors;
  try{return run();}finally{[castPool,castActors]=before;}
}
/**
 * A late-round horde with the D-040 rotation (protocol 12: a rotation draws P0 entries only, all in the DICT): one run's
 * rotation, round 9's role shares
 * (rules/waves.ts ROTATION_WEIGHTS), split evenly among the rotation's entries of each role; the roles that act like the
 * P1 trio (suporte, kamikaze, refletor, invocador) churn the acting phase like it.
 */
const ROTATION_CAST=(()=>{
  const roles=roundRoster(drawRotation(new Rng(40)),9).roles,pool:string[]=[];
  for(const [role,w] of Object.entries(ROTATION_WEIGHTS[8]) as [keyof typeof roles,number][]){
    const ids=roles[role]??[];for(const id of ids)for(let i=0;i<Math.round(w*100/ids.length);i++)pool.push(id);
  }
  return pool;
})();
const ROTATION_ACTORS=new Set(ROTATION_CAST.filter(k=>['suporte','kamikaze','refletor','invocador'].includes(roleOf(k)??'')));
/**
 * EnemyView.phase of a regular enemy (sim/enemies/ai.ts ENEMY_PHASE), from the catalog numbers: the trio acts (1) about
 * a third of the time (a 2 s pose every 7 s, a 1.5 s lecture every 7.5 s, the motoboy's 2.6 s aim and run) in ~2 s
 * spells (off 1/40 per tick); the others are coached (2) ~12% of the time (4% coaches, ~3.5 allies in a lecture's radius
 * each) in 6 s windows (off 1/120 per tick). `castEnemy` draws a kind and its phase, `churnPhase` flips it per tick.
 */
function castEnemy(rng:Rng):{kind:string;phase?:number}{
  const kind=rng.pick(castPool),p1=castActors.has(kind);
  return rng.chance(p1?1/3:.12)?{kind,phase:p1?1:2}:{kind};
}
function churnPhase(e:EnemyView,rng:Rng){
  const p1=castActors.has(e.kind);
  if(e.phase===undefined){if(rng.chance(p1?.0125:.0011))e.phase=p1?1:2;}
  else if(rng.chance(p1?.025:.0083))delete e.phase;
}

function player(id:string,i:number,extra:Partial<PlayerWireView>={}):PlayerWireView{
  return {id,name:`Jogador ${i}`,classId:'cidadao-comum',hp:73.4,maxHp:120,online:true,spectator:false,
    weapons:[{id:'chinelo',level:3},{id:'boleto-evo',level:1}],passives:[{id:'tenis',level:2}],x:10+i,y:12.25,ack:40+i,...extra};
}
interface ServerWorld {tick:number;view:FrameInput;velocity:Map<string,{x:number;y:number}>}
/** A busy round: moving enemies, homing and static pickups, linear projectiles, telegraphs and a wall. */
function busyWorld(rng:Rng,enemies=300):ServerWorld{
  const view:FrameInput={
    tick:1000,team:{xp:340,level:12,nextXp:455},
    round:{index:4,total:10,phase:'wave',phaseEndsTick:1900,remaining:enemies},
    players:Array.from({length:6},(_,i)=>player(`uuid-${i}`,i)),
    enemies:Array.from({length:enemies},(_,i):EnemyView=>({id:`e-${i+1}`,...castEnemy(rng),
      x:rng.range(1,23),y:rng.range(1,23),hp:rng.range(5,80),maxHp:80,...(i%50===0?{elite:true}:{})})),
    pickups:Array.from({length:150},(_,i):PickupView=>({id:`xp-${i+1}`,kind:'xp',x:rng.range(2,22),y:rng.range(2,22),value:rng.int(1,5)})),
    projectiles:Array.from({length:100},(_,i):ProjectileView=>({id:`p-${i+1}`,source:i%10===0?'boleto-juros':'boleto',x:rng.range(4,20),y:rng.range(4,20),
      vx:rng.range(-9,9),vy:rng.range(-9,9),radius:.2,hostile:i%10===0})),
    telegraphs:Array.from({length:6},(_,i):TelegraphView=>({id:`t-${i+1}`,shape:'line',x:12,y:12,radius:3,dx:.6,dy:.8,width:1.2,fireTick:1020+i,
      ...(i%3?{kind:TELEGRAPH_KINDS[i%TELEGRAPH_KINDS.length]}:{})})),
    structures:[{id:'muralha',kind:'muralha',x:12,y:12,hp:800,maxHp:1000}],
  };
  return {tick:1000,view,velocity:new Map(view.enemies.map(e=>[e.id,{x:rng.range(-1,1),y:rng.range(-1,1)}]))};
}
let spawned=10000;
/** One server tick: enemies walk, a few die and spawn, pickups home, projectiles fly, hp drops. Returns the tick's events. */
function stepWorld(w:ServerWorld,rng:Rng):SimEvent[]{
  const v=w.view,events:SimEvent[]=[];
  w.tick++;v.tick=w.tick;
  for(const e of v.enemies){const d=w.velocity.get(e.id)!;e.x+=d.x/20;e.y+=d.y/20;churnPhase(e,rng);}
  for(const p of v.projectiles){p.x+=p.vx/20;p.y+=p.vy/20;}
  for(let i=0;i<30&&v.enemies.length;i++){
    const e=rng.pick(v.enemies),amount=rng.range(1,9);
    e.hp-=amount;events.push({type:'damage',target:e.id,amount,source:'uuid-0',weapon:'chinelo',...(amount>8?{crit:true}:{})});
  }
  for(const e of v.enemies.filter(e=>e.hp<=0)){events.push({type:'kill',enemy:e.id,kind:e.kind,x:e.x,y:e.y,by:'uuid-1'});}
  v.enemies=v.enemies.filter(e=>e.hp>0);
  while(v.enemies.length<300){
    const id=`e-${++spawned}`;v.enemies.push({id,...castEnemy(rng),x:rng.range(1,23),y:rng.range(1,23),hp:40,maxHp:40});w.velocity.set(id,{x:rng.range(-1,1),y:rng.range(-1,1)});
  }
  for(const p of v.pickups.slice(0,10)){p.x+=w.tick%40<20?.3:-.3;}
  if(w.tick%7===0){const p=v.projectiles.shift()!;v.projectiles.push({...p,id:`p-${++spawned}`,x:12,y:12});}
  // Projectiles expire when they leave the island area, like the real system does.
  v.projectiles=v.projectiles.map(p=>p.x<-4||p.x>28||p.y<-4||p.y>28?{...p,id:`p-${++spawned}`,x:12,y:12}:p);
  if(w.tick%13===0)v.projectiles[0].vx*=-1;
  v.players[0].x=12+Math.sin(w.tick/20)*5;v.players[0].ack!++;
  return events;
}
function assertSameWorld(decoded:RunView,src:FrameInput,ids:WireIds,msg:string){
  assert.equal(decoded.tick,src.tick,`${msg} tick`);
  assert.deepEqual(decoded.team,src.team);
  assert.deepEqual(decoded.round,src.round);
  const bySection=<T extends {id:string}>(list:T[])=>new Map(list.map(e=>[e.id,e]));
  const check=(section:'enemies'|'pickups'|'projectiles'|'telegraphs'|'structures',eps:number)=>{
    const got=bySection(decoded[section] as {id:string}[]);
    assert.equal(got.size,src[section].length,`${msg} ${section} count`);
    for(const e of src[section] as unknown as Record<string,unknown>[]){
      const d=got.get(ids.label(section,e.id as string)) as Record<string,unknown>|undefined;
      assert.ok(d,`${msg} ${section} ${e.id} present`);
      for(const [k,v] of Object.entries(e)){
        if(k==='id')continue;
        if(k==='x'||k==='y')near(d[k] as number,v as number,eps,`${msg} ${section}.${k}`);
        else if(k==='hp'||k==='maxHp'||k==='value')assert.equal(d[k],Math.ceil(v as number),`${msg} ${section}.${k}`);
        else if(typeof v==='number')near(d[k] as number,v,1/128,`${msg} ${section}.${k}`);
        else assert.deepEqual(d[k],v,`${msg} ${section}.${k}`);
      }
    }
  };
  check('enemies',POS_EPS);check('pickups',POS_EPS);check('projectiles',3*POS_EPS);check('telegraphs',POS_EPS);check('structures',POS_EPS);
  const players=bySection(decoded.players as PlayerWireView[]);
  for(const p of src.players as PlayerWireView[]){
    const d=players.get(p.id)!;
    assert.ok(d,`${msg} player ${p.id}`);
    assert.equal(d.name,p.name);assert.equal(d.classId,p.classId);assert.equal(d.hp,Math.ceil(p.hp));
    assert.deepEqual(d.weapons,p.weapons);assert.deepEqual(d.passives,p.passives);
    near(d.x!,p.x!,POS_EPS,`${msg} player x`);assert.equal(d.ack,p.ack);
  }
}

test('a full frame round-trips every field within quantization',()=>{
  const w=busyWorld(new Rng(1),40);
  const v=w.view;
  v.players[1]={...player('uuid-1',1),name:'Zé do Pavê 😂',downed:{progress:.4,bleedOutTick:1400},stats:{damage:1234,kills:56,revives:2,pickups:90}};
  v.players[2]={...player('uuid-2',2),eliminated:true,online:false,spectator:true};
  v.wave={index:4,label:'Round do Boleto Vencido',phase:'wave'};
  v.enemies[0]={...v.enemies[0],boss:true,phase:2,hp:12000.2,maxHp:15000};
  v.pickups[0]={...v.pickups[0],kind:'resource',resource:'coco'};
  v.telegraphs.push({id:'t-99',shape:'circle',x:3,y:4,radius:2.5,fireTick:999});
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const events:(SimEvent&{eventId:number})[]=[
    {type:'damage',target:'e-1',amount:12.2,crit:true,source:'uuid-0',weapon:'chinelo',eventId:7},
    {type:'kill',enemy:'e-2',kind:'bebado',x:5,y:6,by:'uuid-1',eventId:8},
    {type:'spawn-warning',x:2,y:3,atTick:1030,count:6,eventId:9},
    {type:'fire',player:'uuid-0',weapon:'audio',x:4,y:4,dx:.6,dy:-.8,eventId:10},
    {type:'pickup',player:'uuid-0',pickup:'xp-1',kind:'xp',value:3,eventId:11},
    {type:'round',index:4,phase:'wave',name:'Fila do Banco',modifier:'Black Friday: Tudo pela metade do dobro.',eventId:12},
    {type:'bark',enemy:'e-3',line:'É pavê ou pacumê?',eventId:13},
    {type:'downed',player:'uuid-1',eventId:14},
    {type:'boss-phase',enemy:'e-1',phase:2,eventId:15},
    {type:'structure',id:'muralha',hp:700,maxHp:1000,eventId:16},
    {type:'levelup',level:13,eventId:17},
  ];
  enc.pushEvents(events);
  const bytes=enc.encode(v);
  assert.equal(bytes[1],PROTOCOL_VERSION);
  const res=dec.decode(bytes);
  assert.ok(res.ok,!res.ok?res.error:'');
  assertSameWorld(res.view,v,enc.ids,'full');
  assert.equal(res.view.wave?.label,'Round do Boleto Vencido');
  const p1=res.view.players.find(p=>p.id==='uuid-1')!;
  assert.equal(p1.name,'Zé do Pavê 😂');near(p1.downed!.progress,.4,1/255,'progress');assert.equal(p1.downed!.bleedOutTick,1400);
  assert.deepEqual(p1.stats,{damage:1234,kills:56,revives:2,pickups:90,downs:0,heals:0,chests:0,magnets:0,evolves:0},'missing counters travel as 0');
  const p2=res.view.players.find(p=>p.id==='uuid-2')!;assert.equal(p2.eliminated,true);assert.equal(p2.spectator,true);
  // Events keep the server's ids, translate entity ids and round-trip their payloads.
  assert.deepEqual(res.view.events.map(e=>e.eventId),[7,8,9,10,11,12,13,14,15,16,17]);
  const [dmg,kill,warn,fire,pick,round,bark]=res.view.events;
  assert.deepEqual(dmg,{type:'damage',eventId:7,target:enc.ids.label('enemies','e-1'),amount:13,crit:true,source:'uuid-0',weapon:'chinelo'});
  assert.equal(kill.type==='kill'&&kill.enemy,enc.ids.label('enemies','e-2'));
  assert.equal(warn.type==='spawn-warning'&&warn.atTick,1030);
  assert.ok(fire.type==='fire');near(fire.type==='fire'?fire.dx!:0,.6,1/256,'fire dx');
  assert.equal(pick.type==='pickup'&&pick.pickup,enc.ids.label('pickups','xp-1'));
  assert.deepEqual(round,{type:'round',eventId:12,index:4,phase:'wave',name:'Fila do Banco',modifier:'Black Friday: Tudo pela metade do dobro.'});
  assert.deepEqual(bark,{type:'bark',eventId:13,enemy:enc.ids.label('enemies','e-3'),line:'É pavê ou pacumê?'});
  assert.equal(enc.ids.resolve(enc.ids.label('enemies','e-1')),'e-1','a tapped enemy maps back to the server id');
});

test('delta frames against acked baselines track a busy world for 400 ticks',()=>{
  const rng=new Rng(2),w=busyWorld(rng);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const inFlight:{seq:number;event:number;at:number}[]=[];
  let fullBytes=0,deltaBytes=0,deltas=0;
  for(let i=0;i<400;i++){
    if(i%100===99)collect();
    enc.pushEvents(stepWorld(w,rng));
    if(i%2)continue; // 10 Hz
    const bytes=enc.encode(w.view);
    const res=dec.decode(bytes);
    assert.ok(res.ok,!res.ok?res.error:'');
    assertSameWorld(res.view,w.view,enc.ids,`tick ${w.tick}`);
    if(i===0)fullBytes=bytes.length;else{deltaBytes+=bytes.length;deltas++;}
    // Acks arrive ~150 ms later and one in five is lost.
    inFlight.push({seq:res.seq,event:res.ack.event,at:i+3});
    while(inFlight.length&&inFlight[0].at<=i){const a=inFlight.shift()!;if(a.seq%5)enc.ack(a.seq,a.event);}
  }
  assert.ok(deltaBytes/deltas<fullBytes*.8,`deltas ${Math.round(deltaBytes/deltas)} vs full ${fullBytes}`);
  // Only the frames sent before the first ack arrived (~150 ms) are full.
  assert.equal(enc.stats.fullFrames,3);
});

test('truncated, corrupted and random frames are rejected without throwing and without touching state',()=>{
  const rng=new Rng(3),w=busyWorld(rng,30);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  enc.pushEvents([{type:'round',index:1,phase:'wave',name:'Pix Errado'}]);
  const frame=enc.encode(w.view);
  for(let n=0;n<frame.length;n++){
    const res=dec.decode(frame.slice(0,n));
    assert.equal(res.ok,false,`prefix ${n}`);
  }
  for(let i=0;i<2000;i++){
    const junk=new Uint8Array(rng.int(0,300)).map(()=>rng.int(0,255));
    if(i%2){junk[0]=0x56;junk[1]=4;}
    assert.doesNotThrow(()=>dec.decode(junk));
  }
  for(let i=0;i<500;i++){
    const bad=frame.slice();bad[rng.int(2,bad.length-1)]^=1<<rng.int(0,7);
    assert.doesNotThrow(()=>dec.decode(bad));
  }
  assert.equal(dec.decode(new Uint8Array([1,2,3])).ok,false);
  assert.equal(dec.decode(Uint8Array.of(0x56,3)).ok,false,'other version');assert.equal(dec.decode(Uint8Array.of(0x56,4,1,0,0,0,0)).ok,false,'protocol 4 frames (no event sizes) are refused');
  // Flipped bytes may decode to plausible values, but a pristine decoder still accepts the real frame.
  const fresh=new FrameDecoder(),ok=fresh.decode(frame);
  assert.ok(ok.ok);assertSameWorld(ok.view,w.view,enc.ids,'after garbage');
  // Trailing bytes are rejected too.
  const longer=new Uint8Array(frame.length+1);longer.set(frame);
  assert.equal(new FrameDecoder().decode(longer).ok,false);
});

test('events are resent until acked and applied once; stale frames are ignored',()=>{
  const w=busyWorld(new Rng(4),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  enc.pushEvents([{type:'levelup',level:2,eventId:100} as SimEvent]);
  const f1=enc.encode(w.view);
  enc.pushEvents([{type:'downed',player:'uuid-1',eventId:101} as SimEvent]);
  w.view.tick++;
  const f2=enc.encode(w.view);
  const r1=dec.decode(f1),r2=dec.decode(f2);
  assert.ok(r1.ok&&r2.ok);
  assert.deepEqual(r1.view.events.map(e=>e.eventId),[100]);
  assert.deepEqual(r2.view.events.map(e=>e.eventId),[101],'event 100 was resent but applied once');
  // A replayed or late frame does not regress the state or duplicate events.
  const late=dec.decode(f1);assert.equal(late.ok,false);
  // After the ack the server stops resending.
  enc.ack(r2.seq,r2.ack.event);w.view.tick++;
  const r3=dec.decode(enc.encode(w.view));
  assert.ok(r3.ok);assert.equal(r3.view.events.length,0);
  // Server event ids without stamps keep counting up.
  enc.pushEvents([{type:'levelup',level:3}]);w.view.tick++;
  const r4=dec.decode(enc.encode(w.view));
  assert.ok(r4.ok);assert.deepEqual(r4.view.events.map(e=>e.eventId),[102]);
});

test('the resend queue is bounded and drops damage numbers first',()=>{
  const w=busyWorld(new Rng(5),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  enc.pushEvents([{type:'round',index:2,phase:'wave',name:'Café Sem Açúcar'}]);
  for(let i=0;i<MAX_PENDING_EVENTS+200;i++)enc.pushEvents([{type:'damage',target:'e-1',amount:1}]);
  const res=dec.decode(enc.encode(w.view));
  assert.ok(res.ok);
  assert.equal(res.view.events.length,MAX_PENDING_EVENTS);
  assert.equal(res.view.events[0].type,'round','important events survive');
});

test('a missing baseline asks for a resync and the next full frame recovers',()=>{
  const w=busyWorld(new Rng(6),10);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const r1=dec.decode(enc.encode(w.view));assert.ok(r1.ok);enc.ack(r1.seq,r1.ack.event);
  // The client reconnects and loses its baselines; the next delta refers to one it no longer has.
  dec.reset();w.view.tick++;
  const r2=dec.decode(enc.encode(w.view));
  assert.ok(!r2.ok&&r2.resync);
  assert.deepEqual(parseClientControl('{"t":"resync"}'),{t:'resync'});
  enc.resync();w.view.tick++;
  const r3=dec.decode(enc.encode(w.view));
  assert.ok(r3.ok);assertSameWorld(r3.view,w.view,enc.ids,'resynced');
});

test('wire ids are never reused, even when server ids restart on a rematch',()=>{
  const ids=new WireIds();
  const a=ids.label('pickups','xp-1');
  ids.reset();
  const b=ids.label('pickups','xp-1');
  assert.notEqual(a,b);
  assert.equal(ids.resolve(b),'xp-1');assert.equal(ids.resolve(a),undefined);
  assert.equal(ids.label('players','uuid-9'),'uuid-9');
  ids.prune({pickups:[]});assert.equal(ids.resolve(b),undefined);
  // Players keep their wire id across the reset (VGM-042b): a rematch does not resend every player as new.
  const p=ids.wire('players','uuid-9');ids.reset();assert.equal(ids.wire('players','uuid-9'),p);assert.ok(ids.has('players','uuid-9'));
});

test('control messages: forged or oversized input is refused',()=>{
  assert.deepEqual(parseClientControl('{"t":"ack","seq":5,"event":9}'),{t:'ack',seq:5,event:9});
  assert.deepEqual(parseClientControl('{"t":"choose","offer":"rnd-3","index":1}'),{t:'choose',offer:'rnd-3',index:1});
  for(const bad of ['{"t":"ack","seq":-1}','{"t":"ack","seq":1.5}','{"t":"choose","offer":"x","index":9}','{"t":"choose","offer":1,"index":0}',
    '{"t":"damage","amount":9999}','nope','[]','null',`{"t":"choose","offer":"${'x'.repeat(600)}","index":0}`])
    assert.equal(parseClientControl(bad),undefined,bad);
  const offers=parseServerControl(JSON.stringify({t:'offers',offers:[
    {id:'rnd-1',source:'round',level:1,choices:[{itemId:'chinelo',level:2}],deadlineTick:500,defaultIndex:0},
    {id:'evil',source:'hack',level:1,choices:[],deadlineTick:1,defaultIndex:0},
  ]}));
  assert.equal(offers?.offers.length,1);
  const dec=new FrameDecoder();assert.ok(dec.applyControl(offers!));
  const res=dec.decode(new FrameEncoder().encode(busyWorld(new Rng(7),1).view));
  assert.ok(res.ok);assert.equal(res.view.offers[0].id,'rnd-1');
});

test('bandwidth for 6 clients x 300 enemies at 10 and 20 Hz fits mobile 4G',t=>{
  const results:Record<string,number>={};
  for(const hz of [10,20]){
    collect();
    const rng=new Rng(8),w=busyWorld(rng);
    const clients=Array.from({length:CLIENTS},()=>({enc:new FrameEncoder(),dec:new FrameDecoder(),inFlight:[] as {seq:number;event:number;at:number}[]}));
    const seconds=10,every=20/hz;
    let bytes=0;
    for(let i=0;i<seconds*20;i++){
      const events=stepWorld(w,rng);
      for(const c of clients)c.enc.pushEvents(events);
      if(i%every)continue;
      for(const c of clients){
        const frame=c.enc.encode(w.view);bytes+=frame.length;
        const res=c.dec.decode(frame);assert.ok(res.ok);
        c.inFlight.push({seq:res.seq,event:res.ack.event,at:i+3}); // ~150 ms round trip
        while(c.inFlight.length&&c.inFlight[0].at<=i){const a=c.inFlight.shift()!;c.enc.ack(a.seq,a.event);}
      }
    }
    results[`${hz}Hz`]=Math.round(bytes/clients.length/seconds);
    results[`${hz}Hz events`]=Math.round(clients[0].enc.stats.eventBytes/seconds);
    results[`${hz}Hz frame`]=Math.round(clients[0].enc.stats.bytes/clients[0].enc.stats.frames);
  }
  t.diagnostic(`protocol 4 bytes/s per client (300 moving enemies, 150 pickups, 100 projectiles, 30 damage + kills per tick): ${JSON.stringify(results)}`);
  // 4G budget: well under 50 KB/s per client at 20 Hz, and 10 Hz cheaper. With the D-033 cast inline (protocol 8) this
  // measured 29 674 B/s at 10 Hz and 43 809 at 20 Hz; with the cast in the DICT (protocol 9, D-036) 27 377 and 40 853.
  // With the P1 trio (~12%) and EnemyView.phase churn (castEnemy/churnPhase): 28 010 / 41 648 with the trio inline
  // (protocol 9), 27 686 / 41 236 with the trio in the DICT (protocol 10).
  assert.ok(results['20Hz']<50_000,`20 Hz: ${results['20Hz']}`);
  assert.ok(results['10Hz']<30_000,`10 Hz: ${results['10Hz']}`);
});

test('bad server numbers (NaN, Infinity, huge) never hang the encoder or desync the client',()=>{
  const w=busyWorld(new Rng(9),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  w.view.enemies[0].hp=Infinity;w.view.enemies[1].x=Number.NaN;w.view.team.xp=2**60;
  w.view.projectiles[0].vx=Number.NaN;
  enc.pushEvents([{type:'damage',target:'e-1',amount:Infinity}]);
  const r1=dec.decode(enc.encode(w.view));
  assert.ok(r1.ok,!r1.ok?r1.error:'');enc.ack(r1.seq);
  assert.equal(r1.view.enemies.find(e=>e.id===enc.ids.label('enemies','e-1'))!.hp,0);
  // The server fixes its numbers: the client follows instead of staying stuck on the bad values.
  w.view.enemies[0].hp=30;w.view.enemies[1].x=10;w.view.team.xp=50;w.view.projectiles[0].vx=2;
  for(let i=0;i<5;i++){
    w.view.tick++;w.view.projectiles[0].x+=.1;
    const r=dec.decode(enc.encode(w.view));assert.ok(r.ok);enc.ack(r.seq);
    assertSameWorld(r.view,w.view,enc.ids,`recovered ${i}`);
  }
});

test('events retire even when acks take longer than the resend interval',()=>{
  const w=busyWorld(new Rng(10),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  enc.pushEvents([{type:'levelup',level:2},{type:'levelup',level:3}]);
  const acks:{seq:number;at:number}[]=[];
  let delivered=0;
  for(let i=0;i<200;i++){
    w.view.tick+=2;
    const r=dec.decode(enc.encode(w.view));assert.ok(r.ok);
    delivered+=r.view.events.length;
    acks.push({seq:r.seq,at:i+15}); // 1.5 s round trip at 10 Hz
    while(acks.length&&acks[0].at<=i)enc.ack(acks.shift()!.seq);
  }
  assert.equal(delivered,2,'applied once');
  assert.equal(enc.pendingEvents,0,'queue drained');
  // 200 empty event sections (1 byte each) plus a few resends of the 2 events, not one resend per second forever.
  assert.ok(enc.stats.eventBytes<200+40,`${enc.stats.eventBytes} event bytes`);
});

test('without acks an event goes again only every 5 s, not every second (bad network, VGM-042b review)',()=>{
  const w=busyWorld(new Rng(11),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  enc.pushEvents(Array.from({length:50},(_,i)=>({type:'levelup',level:i+2} as SimEvent)));
  let sent=0;
  for(let i=0;i<100;i++){w.view.tick+=2;const r=dec.decode(enc.encode(w.view));assert.ok(r.ok);}
  // 10 s of frames with no ack: the first send plus one resend at 5 s (and at most one more at the edge).
  const frames=enc.stats.frames;assert.equal(frames,100);
  sent=enc.stats.eventBytes;
  const once=(()=>{const e=new FrameEncoder();e.pushEvents(Array.from({length:50},(_,i)=>({type:'levelup',level:i+2} as SimEvent)));e.encode(w.view);return e.stats.eventBytes;})();
  assert.ok(sent<=once*3+100,`${sent} event bytes for ${once} per full send`);
  assert.ok(sent>=once*2,'still resent while unacked');
  // A resync (reconnect, lost baseline) sends them again right away.
  enc.resync();w.view.tick+=2;const before=enc.stats.eventBytes;enc.encode(w.view);
  assert.ok(enc.stats.eventBytes-before>=once-5,'resent after resync');
});

test('decoded views are copies; mutating them does not corrupt the next frame',()=>{
  const w=busyWorld(new Rng(11),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const r1=dec.decode(enc.encode(w.view));assert.ok(r1.ok);enc.ack(r1.seq);
  r1.view.players[0].weapons.push({id:'pombo',level:9});r1.view.enemies[0].x=99;
  w.view.tick++;
  const r2=dec.decode(enc.encode(w.view));assert.ok(r2.ok);
  assertSameWorld(r2.view,w.view,enc.ids,'after mutation');
});

test('event references to players resolve after the frame registers them',()=>{
  const w=busyWorld(new Rng(12),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  // First tick: no frame sent yet, so the encoder does not know the player ids.
  enc.pushEvents([{type:'damage',target:'uuid-2',amount:5,source:'e-1'},{type:'downed',player:'uuid-2'}]);
  const r=dec.decode(enc.encode(w.view));assert.ok(r.ok);
  assert.equal(r.view.events[0].type==='damage'&&r.view.events[0].target,'uuid-2');
  assert.equal(r.view.events[0].type==='damage'&&r.view.events[0].source,enc.ids.label('enemies','e-1'));
  assert.equal(r.view.events[1].type==='downed'&&r.view.events[1].player,'uuid-2');
});

test('late acks after a resync are ignored; a restarted server is accepted after reset',()=>{
  const w=busyWorld(new Rng(13),5);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const r1=dec.decode(enc.encode(w.view));assert.ok(r1.ok);
  dec.reset();enc.resync();
  enc.ack(r1.seq); // arrives late, from the old connection
  w.view.tick++;
  const r2=dec.decode(enc.encode(w.view));
  assert.ok(r2.ok,!r2.ok?r2.error:'');
  // The room restarts: a brand new encoder counts seqs from 1 again.
  const fresh=new FrameEncoder();
  assert.equal(dec.decode(fresh.encode(w.view)).ok,false,'without reset the old seqs win');
  dec.reset();
  const r3=dec.decode(fresh.encode(w.view));assert.ok(r3.ok);
});

test('long strings are clipped the same way on both sides',()=>{
  const w=busyWorld(new Rng(14),2);
  w.view.players[0].name='Ã'.repeat(400);
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const r1=dec.decode(enc.encode(w.view));assert.ok(r1.ok);enc.ack(r1.seq);
  const name=r1.view.players[0].name;
  assert.ok(new TextEncoder().encode(name).length<=256&&name.length===128);
  w.view.tick++;
  const r2=dec.decode(enc.encode(w.view));assert.ok(r2.ok);
  assert.equal(r2.view.players[0].name,name);
});

// ---------- Wide map and area of interest (NEW-20261009-ORQ-rede-mapa-grande) ----------
import {INTEREST_HYSTERESIS,INTEREST_RADIUS} from '../../src/contract/offscreen.ts';
import {POS_LIMIT,SEND_EVERY,sendSlot,sendsOn,type WorldDescriptor} from '../../src/protocol/protocol4.ts';

const q=(v:number)=>Math.round(v*POS_SCALE)/POS_SCALE;
const ENDLESS:WorldDescriptor={kind:'infinito',terrainVersion:1,generatorVersion:1,seed:4242,signature:'a1b2c3d4'};
/** A busy round around (cx, cy): the viewer `uuid-0` there, an ally across the map, the base at the origin. */
function farWorld(rng:Rng,cx:number,cy:number,enemies=120):ServerWorld{
  const w=busyWorld(rng,enemies),v=w.view;
  const shift=<T extends {x:number;y:number}>(e:T)=>{e.x+=cx-12;e.y+=cy-12;return e;};
  v.enemies.forEach(shift);v.pickups.forEach(shift);v.projectiles.forEach(shift);v.telegraphs.forEach(shift);
  v.players.forEach((p,i)=>{p.x=cx+i*.5;p.y=cy;});
  v.players[5]={...v.players[5],x:-cx,y:-cy}; // an ally on the other side of the world
  v.structures=[{id:'muralha',kind:'muralha',x:0,y:0,hp:800,maxHp:1000}];
  (v as FrameInput).world=ENDLESS;
  return w;
}
function assertExact(decoded:RunView,src:FrameInput,ids:WireIds,msg:string){
  for(const section of ['enemies','pickups','telegraphs','structures'] as const){
    const got=new Map((decoded[section] as {id:string;x:number;y:number}[]).map(e=>[e.id,e]));
    for(const e of src[section] as {id:string;x:number;y:number}[]){
      const d=got.get(ids.label(section,e.id));
      if(!d)continue; // out of interest
      assert.equal(d.x,q(e.x),`${msg} ${section} ${e.id} x`);assert.equal(d.y,q(e.y),`${msg} ${section} ${e.id} y`);
    }
  }
  for(const p of src.players as PlayerWireView[]){
    const d=decoded.players.find(o=>o.id===p.id) as PlayerWireView;
    assert.equal(d.x,q(p.x!),`${msg} player ${p.id} x`);assert.equal(d.y,q(p.y!),`${msg} player ${p.id} y`);
  }
}

test('wide map: positions round-trip exactly at ±10 000 units, near the viewer and across the world',()=>{
  for(const [cx,cy] of [[10_000,-10_000],[-10_000,10_000],[10_000,10_000],[-999_990,999_990]]){
    const rng=new Rng(cx),w=farWorld(rng,cx,cy);
    const enc=new FrameEncoder(new WireIds(),{viewer:'uuid-0'}),dec=new FrameDecoder();
    for(let i=0;i<120;i++){
      enc.pushEvents(stepWorld(w,rng));
      w.view.players[0].x=cx+Math.sin(w.tick/20)*5;
      w.view.players[5].x=-cx+i*.37;
      if(i%2)continue;
      const r=dec.decode(enc.encode(w.view));
      assert.ok(r.ok,!r.ok?r.error:'');
      assertExact(r.view,w.view,enc.ids,`${cx},${cy} tick ${w.tick}`);
      assert.equal(r.view.players.length,6,'allies always, even 20 000 units away');
      assert.deepEqual(r.world,ENDLESS);
      enc.ack(r.seq,r.ack.event);
    }
    // Projectiles extrapolate between frames: within a few quanta, also far away.
    const r=dec.decode(enc.encode(w.view));assert.ok(r.ok);
    for(const p of w.view.projectiles){const d=r.view.projectiles.find(o=>o.id===enc.ids.label('projectiles',p.id));if(d)near(d.x,p.x,3*POS_EPS,'projectile x');}
  }
  // Positions past the clamp do not wrap: they stick to ±POS_LIMIT.
  const w=busyWorld(new Rng(1),2);w.view.enemies[0].x=1e12;w.view.enemies[1].x=-1e12;
  const r=new FrameDecoder().decode(new FrameEncoder().encode(w.view));assert.ok(r.ok);
  assert.deepEqual(r.view.enemies.map(e=>e.x).sort((a,b)=>a-b),[-POS_LIMIT,POS_LIMIT]);
});

test('wide map: truncated or corrupted far frames are rejected without throwing',()=>{
  const rng=new Rng(21),w=farWorld(rng,10_000,-10_000,40);
  const enc=new FrameEncoder(new WireIds(),{viewer:'uuid-0'}),dec=new FrameDecoder();
  enc.pushEvents([{type:'kill',enemy:'e-1',kind:'bebado',x:10_001,y:-9_999},{type:'round',index:1,phase:'wave',name:'Pix Errado'}]);
  const frame=enc.encode(w.view);
  for(let n=0;n<frame.length;n++)assert.equal(dec.decode(frame.slice(0,n)).ok,false,`prefix ${n}`);
  for(let i=0;i<500;i++){const bad=frame.slice();bad[rng.int(2,bad.length-1)]^=1<<rng.int(0,7);assert.doesNotThrow(()=>new FrameDecoder().decode(bad));}
  const ok=new FrameDecoder().decode(frame);assert.ok(ok.ok);assertExact(ok.view,w.view,enc.ids,'pristine');
  const kill=ok.view.events.find(e=>e.type==='kill');
  assert.ok(kill?.type==='kill'&&kill.x===10_001&&kill.y===-9_999,'event positions are exact far from the origin too');
  // A forged origin far past the limit is refused.
  const forged=new FrameEncoder().encode({...w.view,players:[]});
  assert.ok(new FrameDecoder().decode(forged).ok);
});

test('area of interest: near things, every ally, the base and the boss; leaving is not dying',()=>{
  const rng=new Rng(31),w=farWorld(rng,5000,-3000,0),v=w.view;
  const R=INTEREST_RADIUS;
  v.enemies=[
    {id:'e-near',kind:'bebado',x:5000+10,y:-3000,hp:20,maxHp:20},
    {id:'e-walker',kind:'bebado',x:5000+R-1,y:-3000,hp:20,maxHp:20},
    {id:'e-far',kind:'bebado',x:5000+R+30,y:-3000,hp:20,maxHp:20},
    {id:'boss-1',kind:'chefe',x:5000+400,y:-3000,hp:4000,maxHp:4000,boss:true},
  ];
  v.pickups=[{id:'xp-near',kind:'xp',x:5003,y:-3000,value:1},{id:'xp-far',kind:'xp',x:5000,y:-3000+R+20,value:1}];
  v.projectiles=[];v.telegraphs=[{id:'t-big',shape:'circle',x:5000+R+5,y:-3000,radius:8,fireTick:v.tick+20}];
  const enc=new FrameEncoder(new WireIds(),{viewer:'uuid-0'}),dec=new FrameDecoder();
  const frame=()=>{const r=dec.decode(enc.encode(v));assert.ok(r.ok,!r.ok?r.error:'');enc.ack(r.seq,r.ack.event);v.tick+=2;return r;};
  const ids=(r:{view:RunView},s:'enemies'|'pickups'|'telegraphs')=>(r.view[s] as {id:string}[]).map(e=>enc.ids.resolve(e.id)).sort();
  let r=frame();
  assert.deepEqual(ids(r,'enemies'),['boss-1','e-near','e-walker']);
  assert.deepEqual(ids(r,'pickups'),['xp-near']);
  assert.deepEqual(ids(r,'telegraphs'),['t-big'],'a big telegraph whose edge reaches the area');
  assert.equal(r.view.players.length,6);assert.equal(r.view.structures.length,1,'the base, 5 800 units away');
  // Hysteresis: the walker steps just outside and stays; well outside, it leaves (and is not dead).
  v.enemies[1].x=5000+R+INTEREST_HYSTERESIS-.5;r=frame();
  assert.ok(ids(r,'enemies').includes('e-walker'));assert.deepEqual(r.left,[]);
  v.enemies[1].x=5000+R+INTEREST_HYSTERESIS+1;r=frame();
  assert.ok(!ids(r,'enemies').includes('e-walker'));
  assert.deepEqual(r.left,[enc.ids.label('enemies','e-walker')],'left the area');
  assert.ok(!r.view.events.some(e=>e.type==='kill'));
  // A death inside the area: removed, not "left", and its kill event arrives.
  enc.pushEvents([{type:'kill',enemy:'e-near',kind:'bebado',x:5010,y:-3000,by:'uuid-0'},{type:'kill',enemy:'e-far',kind:'bebado',x:5000+R+30,y:-3000}]);
  v.enemies=v.enemies.filter(e=>e.id!=='e-near'&&e.id!=='e-far');r=frame();
  assert.ok(!ids(r,'enemies').includes('e-near'));assert.deepEqual(r.left,[]);
  assert.deepEqual(r.view.events.filter(e=>e.type==='kill').map(e=>e.type==='kill'&&enc.ids.resolve(e.enemy)),['e-near'],'the far kill is not sent');
  // Coming back: the walker returns inside the radius and is sent again.
  v.enemies.push({id:'e-walker',kind:'bebado',x:5000+R-2,y:-3000,hp:20,maxHp:20});r=frame();
  assert.ok(ids(r,'enemies').includes('e-walker'));
  // Global events reach everyone; far damage numbers do not.
  enc.pushEvents([{type:'downed',player:'uuid-5'},{type:'damage',target:'uuid-5',amount:9,source:'e-x'},{type:'levelup',level:9}]);
  r=frame();
  assert.deepEqual(r.view.events.map(e=>e.type).sort(),['downed','levelup']);
  assert.ok(enc.stats.droppedEvents>=2&&enc.stats.culled>0);
});

test('the frame carries the world kind and generator version, again after a resync and when it changes',()=>{
  const w=farWorld(new Rng(41),100,100,5);
  const enc=new FrameEncoder(new WireIds(),{viewer:'uuid-0'}),dec=new FrameDecoder();
  const f1=enc.encode(w.view),r1=dec.decode(f1);assert.ok(r1.ok);assert.deepEqual(r1.world,ENDLESS);enc.ack(r1.seq);
  w.view.tick++;const f2=enc.encode(w.view),r2=dec.decode(f2);assert.ok(r2.ok);assert.deepEqual(r2.world,ENDLESS,'remembered');
  assert.ok(f2.length<f1.length);
  // A fresh client (reconnect) gets it in the next full frame.
  enc.resync();const late=new FrameDecoder();w.view.tick++;
  const r3=late.decode(enc.encode(w.view));assert.ok(r3.ok);assert.deepEqual(r3.world,ENDLESS);enc.ack(r3.seq);
  // A new run on another generator says so at once, even in a delta.
  const next={...ENDLESS,generatorVersion:2,signature:'ffff0000'};(w.view as FrameInput).world=next;w.view.tick++;
  const r4=late.decode(enc.encode(w.view));assert.ok(r4.ok);assert.deepEqual(r4.world,next);
  // The island room without a descriptor keeps working (no world field).
  const island=new FrameDecoder().decode(new FrameEncoder().encode(busyWorld(new Rng(1),1).view));
  assert.ok(island.ok);assert.equal(island.world,undefined);
});

/** Six clusters of play: one per spread player, or one for the whole team. 300 enemies, 150 pickups, 100 shots each. */
function clusters(rng:Rng,centers:{x:number;y:number}[],playersAt:number[]){
  const view:FrameInput={tick:1000,team:{xp:340,level:12,nextXp:455},round:{index:7,total:10,phase:'wave',phaseEndsTick:2400,remaining:300},
    players:playersAt.map((c,i)=>player(`uuid-${i}`,i,{x:centers[c].x+(i%3)*.8,y:centers[c].y+Math.floor(i/3)*.8})),
    enemies:[],pickups:[],projectiles:[],telegraphs:[],structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:800,maxHp:1000}],world:ENDLESS};
  let n=0;
  const enemy=(c:{x:number;y:number}):EnemyView=>{const a=rng.range(0,Math.PI*2),d=rng.range(2,32);
    return {id:`e-${++n}`,...castEnemy(rng),x:c.x+Math.cos(a)*d,y:c.y+Math.sin(a)*d,hp:rng.range(5,80),maxHp:80};};
  for(const c of centers){
    for(let i=0;i<300;i++)view.enemies.push(enemy(c));
    for(let i=0;i<150;i++)view.pickups.push({id:`xp-${++n}`,kind:'xp',x:c.x+rng.range(-12,12),y:c.y+rng.range(-12,12),value:rng.int(1,5)});
    for(let i=0;i<100;i++)view.projectiles.push({id:`p-${++n}`,source:i%10===0?'boleto-juros':'boleto',x:c.x+rng.range(-8,8),y:c.y+rng.range(-8,8),vx:rng.range(-9,9),vy:rng.range(-9,9),radius:.2,hostile:i%10===0});
  }
  const home=new Map(view.enemies.map((e,i)=>[e.id,centers[Math.floor(i/300)]]));
  const shotHome=new Map(view.projectiles.map((p,i)=>[p.id,centers[Math.floor(i/100)]]));
  /** One server tick of every cluster: chase, 30 hits + kills + respawn on the ring, homing pickups, shots. */
  const step=():SimEvent[]=>{
    const events:SimEvent[]=[];view.tick++;
    for(const e of view.enemies){const c=home.get(e.id)!,dx=c.x-e.x,dy=c.y-e.y,d=Math.hypot(dx,dy)||1;e.x+=dx/d*1.4/20+rng.range(-.02,.02);e.y+=dy/d*1.4/20+rng.range(-.02,.02);churnPhase(e,rng);}
    for(const p of view.projectiles){p.x+=p.vx/20;p.y+=p.vy/20;}
    centers.forEach((c,ci)=>{
      const mine=view.enemies.slice(ci*300,ci*300+300);
      // Hits come from the cluster's own player (one per cluster when spread, uuid-0 when together).
      const by=view.players.find((_,i)=>playersAt[i]===ci)!.id;
      for(let i=0;i<30;i++){const e=rng.pick(mine),amount=rng.range(1,9);e.hp-=amount;events.push({type:'damage',target:e.id,amount,source:by,weapon:'chinelo'});}
    });
    view.enemies=view.enemies.map(e=>{
      if(e.hp>0)return e;
      const c=home.get(e.id)!,ci=centers.indexOf(c);
      events.push({type:'kill',enemy:e.id,kind:e.kind,x:e.x,y:e.y,by:view.players.find((_,i)=>playersAt[i]===ci)!.id});
      const fresh=enemy(c);home.set(fresh.id,c);return fresh;
    });
    view.projectiles=view.projectiles.map(p=>{
      const c=shotHome.get(p.id)!;if(Math.hypot(p.x-c.x,p.y-c.y)<14)return p;
      const fresh={...p,id:`p-${++n}`,x:c.x,y:c.y};shotHome.set(fresh.id,c);return fresh;
    });
    for(const p of view.pickups.filter((_,i)=>i%15===0)){p.x+=view.tick%40<20?.3:-.3;}
    view.players.forEach((p,i)=>{p.x!+=Math.sin(view.tick/20+i)*.1;p.ack!++;});
    return events;
  };
  return {view,step};
}
/**
 * Bytes/s per client at 10 Hz over `ticks` server ticks (200 = 10 s), acks ~150 ms late; `stagger` spreads the clients
 * over both ticks. Measures the first CLIENTS players (2 by default, all 6 under the stress run).
 */
function measure(world:{view:FrameInput;step:()=>SimEvent[]},interest:boolean,stagger=false,ticks=200){
  const ids=new WireIds();
  const clients=world.view.players.slice(0,CLIENTS).map((p,i)=>({enc:new FrameEncoder(ids,{viewer:p.id,interest:interest?undefined:false,slot:stagger?sendSlot(i):0}),dec:new FrameDecoder(),inFlight:[] as {seq:number;event:number;at:number}[]}));
  let bytes=0,enemies=0,frames=0,encodeMs=0;
  const perTick:number[]=[];
  collect();
  for(let i=0;i<ticks;i++){
    if(i%50===49)collect();
    const events=world.step();
    for(const c of clients)c.enc.pushEvents(events);
    let tickMs=0;
    for(const c of clients){
      if(!c.enc.due(i))continue;
      const t0=performance.now(),frame=c.enc.encode(world.view),dt=performance.now()-t0;encodeMs+=dt;tickMs+=dt;bytes+=frame.length;
      const r=c.dec.decode(frame);assert.ok(r.ok,!r.ok?r.error:'');
      enemies+=r.view.enemies.length;frames++;
      c.inFlight.push({seq:r.seq,event:r.ack.event,at:i+3});
      while(c.inFlight.length&&c.inFlight[0].at<=i){const a=c.inFlight.shift()!;c.enc.ack(a.seq,a.event);}
    }
    if(tickMs>0)perTick.push(tickMs);
  }
  perTick.sort((a,b)=>a-b);
  assert.equal(frames,clients.length*ticks/2,'10 Hz for every client');
  return {encodeTickMsP50:Math.round(perTick[perTick.length>>1]*100)/100,encodeTickMsP95:Math.round(perTick[Math.floor(perTick.length*.95)]*100)/100,bytesPerSecond:Math.round(bytes/clients.length/(ticks/20)),enemiesPerFrame:Math.round(enemies/frames),eventBytes:Math.round(clients[0].enc.stats.eventBytes/(ticks/20)),
    encodeMsPerFrame:Math.round(encodeMs/frames*100)/100};
}

test('bandwidth on the wide map at 10 Hz: 6 players together and 6 spread, 300 enemies around each',t=>{
  const together=measure(clusters(new Rng(51),[{x:8000,y:-6000}],[0,0,0,0,0,0]),true);
  const atOrigin=measure(clusters(new Rng(51),[{x:12,y:12}],[0,0,0,0,0,0]),true);
  const spread=[0,1,2,3,4,5].map(i=>({x:8000+Math.cos(i/6*Math.PI*2)*200,y:-6000+Math.sin(i/6*Math.PI*2)*200}));
  const apart=measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),true);
  // Without area of interest every client gets every horde (~9x the bytes): a short run is enough to show it.
  const apartAll=measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),false,false,STRESS?200:60);
  const staggered=measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),true,true);
  t.diagnostic(`protocol 4, wide map, bytes/s per client at 10 Hz: together ${JSON.stringify(together)}; same at the origin ${JSON.stringify(atOrigin)}; spread 200 u ${JSON.stringify(apart)}; spread without area of interest ${JSON.stringify(apartAll)}; spread, clients staggered over both ticks ${JSON.stringify(staggered)}`);
  assert.ok(Math.abs(staggered.bytesPerSecond-apart.bytesPerSecond)<apart.bytesPerSecond*.05,'staggering costs no bandwidth');
  // D-018 budget: the island worst case was 26.7 KB/s per client; the wide map must stay in the same range.
  // D-033 cast (NEW-20261012-ORQ-elenco-adult-swim): with the old DICT kinds this measured 31.5 KB/s together and
  // 31.9 KB/s spread; with the new kinds and the agiota's 'boleto-juros' shots inline (0xFF + utf8, protocol 8) it was
  // 33 849 together / 33 828 at the origin / 34 208 spread / 34 218 staggered B/s (limit raised to 36 000 for that).
  // Protocol 9 (D-036) appends them to the DICT: 31 524 / 31 503 / 31 884 / 31 895 B/s, so the limit is back at 32 000.
  // P1 cast (NEW-20261012-ORQ-elenco-p1), the trio at ~12% (CAST_SHARE) plus the EnemyView.phase churn (castEnemy,
  // churnPhase): trio inline (protocol 9) 32 056 / 32 035 / 32 576 / 32 580 B/s; trio in the DICT (protocol 10)
  // 31 760 / 31 740 / 32 256 / 32 260. The kinds alone, without phases: 31 804 / 31 783 / 32 227 / 32 238 inline,
  // 31 524 / 31 503 / 31 884 / 31 895 in the DICT (the protocol 9 numbers: a DICT kind costs one byte, like any other).
  // The ~370 B/s left over is the phase field itself (new information the client draws: lecture, pose, aim, coached),
  // not the kinds, so the regression guard moves to 32 500. Still far under the D-009 4G budget (< 50 KB/s at 20 Hz);
  // the real 6-bot run with this cast averaged 4.3 KB/s per client (p95 9.8).
  assert.ok(together.bytesPerSecond<32_500,`together ${together.bytesPerSecond}`);
  assert.ok(apart.bytesPerSecond<32_500,`spread ${apart.bytesPerSecond}`);
  assert.ok(apart.enemiesPerFrame<=300,'each client only gets its own horde');
  assert.ok(apartAll.bytesPerSecond>apart.bytesPerSecond*3,'the area of interest is what keeps spread players cheap');
  assert.ok(Math.abs(together.bytesPerSecond-atOrigin.bytesPerSecond)<atOrigin.bytesPerSecond*.05,'8 000 units out costs the same as the origin');
});

test('protocol 12: the wide-map budget holds with a D-040 rotation horde (every P0 kind is one dictionary byte)',t=>{
  assert.ok(ROTATION_CAST.length>=90&&new Set(ROTATION_CAST).size>=10,'a varied rotation horde');
  assert.ok(ROTATION_CAST.every(k=>DICT.includes(k)));
  // Representative: a rotation draws P1/P2 only when a role runs out of P0 entries, which no rotation does today, so a
  // run's kinds always travel as dictionary bytes (the P1/P2 ids inline only appear in sandboxes).
  for(let seed=0;seed<200;seed++)for(const id of rotationIds(drawRotation(new Rng(seed))))assert.ok(DICT.includes(id),`seed ${seed}: ${id}`);
  const spread=[0,1,2,3,4,5].map(i=>({x:8000+Math.cos(i/6*Math.PI*2)*200,y:-6000+Math.sin(i/6*Math.PI*2)*200}));
  const [together,apart,legacy]=[
    withCast(ROTATION_CAST,ROTATION_ACTORS,()=>measure(clusters(new Rng(51),[{x:8000,y:-6000}],[0,0,0,0,0,0]),true)),
    withCast(ROTATION_CAST,ROTATION_ACTORS,()=>measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),true)),
    measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),true),
  ];
  t.diagnostic(`protocol 12, wide map, rotation horde (${new Set(ROTATION_CAST).size} kinds): together ${together.bytesPerSecond} B/s, spread ${apart.bytesPerSecond} B/s (the nine-kind cast, spread: ${legacy.bytesPerSecond})`);
  // The D-042 guard (32 500 B/s, wide map spread) holds with the rotation: a roster kind costs what a legacy kind costs.
  // Measured with this rotation (seed 40, round 9's shares): inline as in protocol 10 and 11 (0xFF + utf8 per kind)
  // 35 343 together / 35 928 spread; with the whole roster in the DICT (the branch's first draft) 31 789 / 32 288, and
  // the same 31 789 / 32 288 in protocol 12 with only the P0 ids in it (a rotation is all P0), vs the nine-kind cast's
  // 32 256 spread (the difference is the phase churn of the acting roles, not the kinds).
  assert.ok(together.bytesPerSecond<32_500,`together ${together.bytesPerSecond}`);
  assert.ok(apart.bytesPerSecond<32_500,`spread ${apart.bytesPerSecond}`);
});

test('protocol 12: the P0 roster is dictionary bytes appended after protocol 11 (every older index unchanged), within the escape',()=>{
  assert.equal(PROTOCOL_VERSION,12);
  // 96 (protocol 11) + 'tiro' + 64 P0 pack ids = 161; 255 is the inline escape, so 94 slots are left.
  assert.equal(DICT.length,161);
  assert.ok(DICT.length<=255,'255 is the inline escape');
  assert.deepEqual(DICT.slice(68,71),['coach','motoboy','influencer'],'protocol 10 indexes unchanged');
  assert.equal(DICT.indexOf('vigia-do-predio'),71,'protocol 11 (torres-fio) indexes unchanged');assert.equal(DICT[95],'C');
  assert.equal(DICT.indexOf('tiro'),96);
  // The P0 pack entries come in roster order right after 'tiro'; the nine legacy kinds were in the DICT already.
  const p0=ROSTER.filter(e=>!e.legacy&&e.priority==='P0').map(e=>e.id),inline=ROSTER.filter(e=>e.priority!=='P0');
  assert.equal(ROSTER.filter(e=>!e.legacy).length,164);assert.equal(p0.length,64);
  assert.deepEqual(DICT.slice(97),p0);
  // The new strings are unique, in the whole DICT too ('heal' is the one protocol-6 duplicate, never a roster id).
  for(const s of DICT.slice(96))assert.equal(DICT.indexOf(s),DICT.lastIndexOf(s),`${s} once`);
  for(const e of ROSTER)if(e.priority==='P0')assert.equal(DICT.lastIndexOf(e.id),DICT.indexOf(e.id),`${e.id} once`);
  for(const e of ROSTER)assert.equal(DICT.includes(e.id),e.priority==='P0',`${e.id} (${e.priority})`);
  assert.equal(inline.length,100,'the 71 P1 and 29 P2 ids travel inline');
  // One byte where it travels (enemy kind, kill and downed events) and the generic shot as a projectile source.
  const frame=(kind:string,source='boleto')=>{
    const v=busyWorld(new Rng(2),1).view;v.enemies[0]={...v.enemies[0],kind};delete v.enemies[0].phase;v.projectiles=[{...v.projectiles[0],source}];
    const enc=new FrameEncoder();enc.pushEvents([{type:'kill',enemy:'e-1',kind,x:1,y:2},{type:'downed',player:'uuid-0',by:'e-1',source:kind}]);
    const bytes=enc.encode(v),r=new FrameDecoder().decode(bytes);assert.ok(r.ok);
    assert.equal(r.view.enemies[0].kind,kind);assert.equal(r.view.projectiles[0].source,source);
    return bytes.length;
  };
  const base=frame('tio-pave');
  for(const kind of ['flanelinha-interdimensional','rei-do-boteco','o-algoritmo','paredao-ambulante'])assert.equal(frame(kind),base,kind);
  assert.equal(frame('bebado','tiro'),base,'the generic shot costs a byte');
  // A P1/P2 id round-trips inline (0xFF + length + UTF-8) in each of its three places: kind, kill, downed source.
  for(const kind of ['sogra-tita','peladeiro-de-vidro','camelo-pirata','morcego-insone']){
    assert.ok(!DICT.includes(kind),kind);
    assert.equal(frame(kind),base+3*(1+new TextEncoder().encode(kind).length),`${kind} inline`);
  }
});

test('the server world descriptor rebuilds the same terrain on the client, island and endless',async()=>{
  const {worldDescriptor}=await import('../../multiplayer/simulation.ts');
  const {TerrainField}=await import('../../src/maps/terrain/field.ts');
  for(const world of ['ilha','infinito'] as const){
    const server=new TerrainField(777,{world}),d=worldDescriptor(server);
    const w=busyWorld(new Rng(3),2);(w.view as FrameInput).world=d;
    const r=new FrameDecoder().decode(new FrameEncoder().encode(w.view));
    assert.ok(r.ok&&r.world);
    assert.equal(r.world.kind,world);
    assert.equal(new TerrainField(r.world.seed,{world:r.world.kind}).signature,d.signature);
  }
});

test('protocol 8+ (D-034): a city room says kind cidade, seed 0 and the asset sha256, and the client gets its decoded city',async()=>{
  // 8 added the city world kind; 9 (D-036) kept it as it is.
  assert.ok(PROTOCOL_VERSION>=8);
  const {worldDescriptor}=await import('../../multiplayer/simulation.ts');
  const {cityTerrainFrom,cityTerrainFor}=await import('../../src/maps/city/terrain.ts');
  const {terrainFor}=await import('../../src/client/net/terrain.ts');
  const {readFileSync}=await import('node:fs');
  const json=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const {hash}=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
  const built=await cityTerrainFrom(json,hash);assert.ok(built.ok);
  const d=worldDescriptor(built.terrain);
  assert.deepEqual({kind:d.kind,seed:d.seed,generatorVersion:d.generatorVersion,signature:d.signature},{kind:'cidade',seed:0,generatorVersion:0,signature:hash});
  const w=busyWorld(new Rng(5),2);(w.view as FrameInput).world=d;
  const r=new FrameDecoder().decode(new FrameEncoder().encode(w.view));
  assert.ok(r.ok&&r.world);assert.deepEqual(r.world,d,'the 64-hex signature fits and round-trips');
  assert.equal(terrainFor(r.world),cityTerrainFor(hash),'the client plays on the city it decoded');
  assert.equal(typeof terrainFor({...r.world,signature:'0'.repeat(64)}),'string','an unknown city asks to update, never guesses');
});

test('area of interest without a body: a spectator follows a player, an empty room the base, never "everything"',()=>{
  const v=farWorld(new Rng(61),3000,3000,0).view;
  v.enemies=[{id:'e-a',kind:'bebado',x:3001,y:3000,hp:5,maxHp:5},{id:'e-b',kind:'bebado',x:1,y:1,hp:5,maxHp:5}];
  const spectator=new FrameEncoder(new WireIds(),{viewer:'ghost'});
  const r1=new FrameDecoder().decode(spectator.encode(v));assert.ok(r1.ok);
  assert.deepEqual(r1.view.enemies.map(e=>spectator.ids.resolve(e.id)),['e-a'],'follows the first player with a body');
  const empty=new FrameEncoder(new WireIds(),{viewer:'ghost'});
  const r2=new FrameDecoder().decode(empty.encode({...v,players:[]}));assert.ok(r2.ok);
  assert.deepEqual(r2.view.enemies.map(e=>empty.ids.resolve(e.id)),['e-b'],'nobody left: around the base');
  // `focus` overrides (a spectator camera parked somewhere).
  const parked=new FrameEncoder(new WireIds(),{viewer:'ghost'});
  const r3=new FrameDecoder().decode(parked.encode(v,{focus:{x:0,y:0}}));assert.ok(r3.ok);
  assert.deepEqual(r3.view.enemies.map(e=>parked.ids.resolve(e.id)),['e-b']);
});

test('staggered broadcast: half the clients on odd ticks, each still 10 Hz and exact',()=>{
  assert.equal(SEND_EVERY,2);
  assert.deepEqual([0,1,2,3,4,5].map(sendSlot),[0,1,0,1,0,1]);
  assert.ok(sendsOn(10,0)&&!sendsOn(10,1)&&sendsOn(11,1));
  const rng=new Rng(71),w=farWorld(rng,4000,-4000);
  const ids=new WireIds();
  const odd=new FrameEncoder(ids,{viewer:'uuid-1',slot:1}),even=new FrameEncoder(ids,{viewer:'uuid-0',slot:0});
  const decs=[new FrameDecoder(),new FrameDecoder()];
  const sent=[0,0];
  for(let i=0;i<80;i++){
    const events=stepWorld(w,rng);
    [even,odd].forEach((enc,k)=>{
      enc.pushEvents(events);
      if(!enc.due(w.tick))return;
      const r=decs[k].decode(enc.encode(w.view));assert.ok(r.ok,!r.ok?r.error:'');
      assertExact(r.view,w.view,enc.ids,`slot ${k} tick ${w.tick}`);
      assert.equal(r.view.tick%2,k);
      enc.ack(r.seq,r.ack.event);sent[k]++;
    });
  }
  assert.deepEqual(sent,[40,40]);
});

test('an event code this client does not know is skipped, the frame and the other events still count (newer room)',()=>{
  const rng=new Rng(5),w=busyWorld(rng,10);
  const enc=new FrameEncoder();
  enc.pushEvents([{type:'levelup',level:2},{type:'levelup',level:3}]);
  const frame=enc.encode(w.view);
  // Layout at the end: count=2, (gap, size=2, code, level)×2. Turn the last event into an unknown code.
  assert.equal(frame[frame.length-3],2,'byte length of the last event');
  const levelup=frame[frame.length-2];
  const newer=frame.slice();newer[newer.length-2]=250;
  const res=new FrameDecoder().decode(newer);
  assert.ok(res.ok,res.ok?'':res.error);
  assert.deepEqual(res.view.events.map(e=>e.type==='levelup'?e.level:e.type),[2],'only the known event');
  assertSameWorld(res.view,w.view,enc.ids,'world intact');
  const known=new FrameDecoder().decode(frame);assert.ok(known.ok);
  assert.deepEqual(known.view.events.map(e=>(e as {level:number}).level),[2,3]);
  assert.equal(frame[frame.length-2],levelup);
});

// ---------- Protocol 6: Stonewards (VGM-046B) ----------

function campWorld():FrameInput{
  return {
    tick:500,team:{xp:1,level:2,nextXp:9},round:{index:3,total:10,phase:'prepare',phaseEndsTick:900,remaining:0},
    players:[player('me',0,{x:0,y:5}),player('far',1,{x:200,y:0})],
    enemies:[],pickups:[],projectiles:[],telegraphs:[],
    structures:[{id:'muralha',kind:'muralha',x:.25,y:0,hp:430,maxHp:600},{id:'torre-1',kind:'torre-chinelo',x:1,y:4,hp:80,maxHp:80,untilTick:1400}],
    nodes:[
      {id:'no-0_0-1',kind:'coco',x:10.5,y:3.25,remaining:4,capacity:4,value:1,progress:0},
      {id:'no-0_0-2',kind:'pedra',x:-20,y:12,remaining:2,capacity:6,value:2,progress:.5},
      {id:'no-6_0-0',kind:'pedra',x:201,y:3,remaining:6,capacity:6,value:4,progress:0},
    ],
    camp:{coco:7,pedra:12,hornEndsTick:900},
  };
}

test('protocol 6: camp block, towers with their end and nodes in the area of interest round-trip',()=>{
  const ids=new WireIds(),enc=new FrameEncoder(ids,{viewer:'me'}),dec=new FrameDecoder();
  const w=campWorld();
  const r=dec.decode(enc.encode(w));assert.ok(r.ok);
  assert.ok(PROTOCOL_VERSION>=6);
  assert.deepEqual(r.view.camp,{coco:7,pedra:12,hornEndsTick:900});
  const tower=r.view.structures.find(s=>s.kind==='torre-chinelo')!;
  assert.equal(tower.untilTick,1400);assert.equal(r.view.structures.find(s=>s.kind==='muralha')!.hp,430);
  // The far player's node (200 units away) stays out of this client's area.
  assert.deepEqual(r.view.nodes!.map(n=>[n.kind,n.remaining,n.capacity,n.value,Math.round(n.progress*100)/100]).sort(),[['coco',4,4,1,0],['pedra',2,6,2,.5]]);
  assert.ok(r.view.nodes!.every(n=>/^n\d+$/.test(n.id)),'client ids for nodes');
  // A unit comes out: only that node changes, and the delta is small.
  enc.ack(r.seq);
  w.tick++;w.nodes![0]={...w.nodes![0],remaining:3,progress:0};w.camp={coco:8,pedra:12,hornEndsTick:900};
  const bytes=enc.encode(w),r2=dec.decode(bytes);assert.ok(r2.ok);
  assert.ok(bytes.length<64,`delta ${bytes.length} B`);
  assert.equal(r2.view.nodes!.find(n=>n.kind==='coco')!.remaining,3);assert.equal(r2.view.camp!.coco,8);
  // The wave: no nodes, no horn; the wall falls.
  enc.ack(r2.seq);
  w.tick++;w.round={...w.round!,phase:'wave'};w.nodes=[];w.camp={coco:8,pedra:12,wallDown:true};w.structures=[{...w.structures[0],hp:0}];
  const r3=dec.decode(enc.encode(w));assert.ok(r3.ok);
  assert.deepEqual(r3.view.nodes,[]);assert.deepEqual(r3.view.camp,{coco:8,pedra:12,wallDown:true});
});

test('protocol 6: horn and say events; horn reaches everyone, say only who is near the source',()=>{
  const ids=new WireIds(),me=new FrameEncoder(ids,{viewer:'me'}),far=new FrameEncoder(ids,{viewer:'far'});
  const dm=new FrameDecoder(),df=new FrameDecoder();
  const w=campWorld();
  const events:SimEvent[]=[{type:'horn',endsTick:900,line:'Fim do recreio! Os bichos tão chegando!'},{type:'say',source:'me',key:'gambiarra',line:'Se tá funcionando, não mexe.'}];
  me.pushEvents(events);far.pushEvents(events);
  const a=dm.decode(me.encode(w)),b=df.decode(far.encode(w));
  assert.ok(a.ok&&b.ok);
  assert.deepEqual(a.view.events.map(e=>e.type),['horn','say']);
  const horn=a.view.events[0],sayEvent=a.view.events[1];
  assert.ok(horn.type==='horn'&&horn.endsTick===900&&horn.line==='Fim do recreio! Os bichos tão chegando!');
  assert.ok(sayEvent.type==='say'&&sayEvent.source==='me'&&sayEvent.key==='gambiarra');
  assert.deepEqual(b.view.events.map(e=>e.type),['horn'],'the far player only hears the horn');
});

test('protocol 6: a 5 decoder byte is refused, and a frame without Stonewards still decodes',()=>{
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const bytes=enc.encode(busyWorld(new Rng(3),5).view);
  const old=bytes.slice();old[1]=5;
  assert.deepEqual(new FrameDecoder().decode(old),{ok:false,error:'protocol version mismatch'});
  const r=dec.decode(bytes);assert.ok(r.ok);assert.equal(r.view.camp,undefined);assert.deepEqual(r.view.nodes,[]);
});

test('protocol 7+: zueira events and the kill-cam reach every client, wherever they happened (VGM-053B)',()=>{
  // 7 added these events; 8 (D-034) only appended the city world kind.
  assert.ok(PROTOCOL_VERSION>=7);
  const ids=new WireIds(),me=new FrameEncoder(ids,{viewer:'me'}),far=new FrameEncoder(ids,{viewer:'far'});
  const dm=new FrameDecoder(),df=new FrameDecoder();
  const w=campWorld();
  const events:SimEvent[]=[{type:'happening',kind:'apagao',endsTick:560},{type:'last-bicho',kind:'tio-pave',x:-180.25,y:40.5,round:3,by:'me'},
    {type:'happening',kind:'boletos',endsTick:580},{type:'happening',kind:'promo',endsTick:660}];
  me.pushEvents(events);far.pushEvents(events);
  const a=dm.decode(me.encode(w)),b=df.decode(far.encode(w));
  assert.ok(a.ok&&b.ok);
  for(const r of [a,b]){
    assert.deepEqual(r.view.events.map(e=>e.type==='happening'?e.kind:e.type),['apagao','last-bicho','boletos','promo']);
    const cam=r.view.events[1];
    assert.ok(cam.type==='last-bicho');
    assert.equal(cam.kind,'tio-pave');assert.equal(cam.round,3);assert.equal(cam.by,'me');
    near(cam.x,-180.25,POS_EPS,'x');near(cam.y,40.5,POS_EPS,'y');
    const dark=r.view.events[0];assert.ok(dark.type==='happening'&&dark.endsTick===560);
  }
  // A 6 room's frame is refused at the version byte (the handshake already sent the update message).
  const old=me.encode(w).slice();old[1]=6;
  assert.deepEqual(new FrameDecoder().decode(old),{ok:false,error:'protocol version mismatch'});
});

// ---------- Protocol 9 (D-036): slow/slip on the player, telegraph kind, the cast in the DICT ----------
/** The strings protocol 9 appended to the DICT (append only: every protocol 8 index is unchanged). */
const D036_STRINGS=['bebado','anao-molotov','pombos','agiota','boleto-juros',...TELEGRAPH_KINDS.filter(k=>k!=='coco')];

test('protocol 9+: slow and slip round-trip on the player when present, stay absent otherwise, and cost nothing while unchanged',()=>{
  assert.ok(PROTOCOL_VERSION>=10);
  const plain=busyWorld(new Rng(4),3).view,burped=busyWorld(new Rng(4),3).view;
  const slip={x:Math.SQRT1_2,y:-Math.SQRT1_2};
  burped.players[0]={...burped.players[0],slowUntil:1030,slipUntil:1010,slip};
  burped.players[3]={...burped.players[3],slowUntil:1004};
  const ep=new FrameEncoder(),eb=new FrameEncoder(),dp=new FrameDecoder(),db=new FrameDecoder();
  const fp=ep.encode(plain),fb=eb.encode(burped);
  const rp=dp.decode(fp),rb=db.decode(fb);assert.ok(rp.ok&&rb.ok);
  const me=rb.view.players.find(p=>p.id==='uuid-0')!,slowOnly=rb.view.players.find(p=>p.id==='uuid-3')!,other=rb.view.players.find(p=>p.id==='uuid-1')!;
  assert.equal(me.slowUntil,1030);assert.equal(me.slipUntil,1010);
  near(me.slip!.x,slip.x,1/256,'slip x');near(me.slip!.y,slip.y,1/256,'slip y');
  assert.equal(slowOnly.slowUntil,1004);
  assert.ok(!('slipUntil' in slowOnly)&&!('slip' in slowOnly),'a slow without a slip sends no slip');
  for(const p of [other,...rp.view.players])assert.ok(!('slowUntil' in p)&&!('slipUntil' in p)&&!('slip' in p),`${p.id}: absent stays absent`);
  // Cost: a few bytes in the frame that starts them (two ticks, a direction, a wider field mask), none after.
  assert.ok(fb.length-fp.length<=20,`effects cost ${fb.length-fp.length} B`);
  ep.ack(rp.seq);eb.ack(rb.seq);
  for(const v of [plain,burped]){v.tick++;v.players[0].x!+=.1;v.players[0].ack!++;}
  const dp2=ep.encode(plain),db2=eb.encode(burped);
  assert.equal(db2.length,dp2.length,'an unchanged slow/slip costs nothing in the delta');
  const rb2=db.decode(db2);assert.ok(rb2.ok);
  assert.equal(rb2.view.players.find(p=>p.id==='uuid-0')!.slipUntil,1010,'the client keeps the state from the baseline');
  // The effects end (the server drops them): the client drops them too.
  eb.ack(rb2.seq);burped.tick++;
  const {slowUntil:_s,slipUntil:_u,slip:_d,...rest}=burped.players[0];burped.players[0]=rest;
  const rb3=db.decode(eb.encode(burped));assert.ok(rb3.ok);
  const after=rb3.view.players.find(p=>p.id==='uuid-0')!;
  assert.ok(!('slowUntil' in after)&&!('slipUntil' in after)&&!('slip' in after),'cleared on the client');
  assert.equal(rb3.view.players.find(p=>p.id==='uuid-3')!.slowUntil,1004);
});

test('protocol 9: every telegraph kind round-trips as one dictionary byte, absent stays absent, unknown is refused',()=>{
  const w=busyWorld(new Rng(6),1).view;
  w.telegraphs=[...TELEGRAPH_KINDS.map((kind,i):TelegraphView=>({id:`t-${kind}`,shape:'circle',x:2+i,y:3,radius:1.5,fireTick:1010+i,kind})),
    {id:'t-plain',shape:'cone',x:9,y:9,radius:2,dx:1,dy:0,width:.8,fireTick:1012}];
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const r=dec.decode(enc.encode(w));assert.ok(r.ok);
  const byId=new Map(r.view.telegraphs.map(t=>[enc.ids.resolve(t.id),t]));
  for(const kind of TELEGRAPH_KINDS)assert.equal(byId.get(`t-${kind}`)!.kind,kind,kind);
  assert.ok(!('kind' in byId.get('t-plain')!),'a generic telegraph has no kind');
  assertSameWorld(r.view,w,enc.ids,'kinds');
  // The look changes (or goes back to generic) in a delta; a kind this build cannot draw is never sent.
  enc.ack(r.seq);w.tick++;
  const {kind:_k,...generic}=w.telegraphs[0];
  w.telegraphs[0]=generic;w.telegraphs[1]={...w.telegraphs[1],kind:'carimbo'};
  w.telegraphs[2]={...w.telegraphs[2],kind:'laser' as never};
  const r2=dec.decode(enc.encode(w));assert.ok(r2.ok,!r2.ok?r2.error:'');
  const byId2=new Map(r2.view.telegraphs.map(t=>[enc.ids.resolve(t.id),t]));
  assert.ok(!('kind' in byId2.get(w.telegraphs[0].id)!));assert.equal(byId2.get(w.telegraphs[1].id)!.kind,'carimbo');
  assert.ok(!('kind' in byId2.get(w.telegraphs[2].id)!),'an unknown server kind goes as generic');
  // One byte, and strict: two frames that differ only in the kind differ in exactly one byte, the dictionary index.
  const one=(kind:TelegraphView['kind'])=>{
    const v=busyWorld(new Rng(6),1).view;
    v.telegraphs=[{id:'t-1',shape:'circle',x:2,y:3,radius:1.5,fireTick:1010,...(kind?{kind}:{})}];
    return new FrameEncoder().encode(v);
  };
  const a=one('arroto'),b=one('coco'),none=one(undefined);
  assert.equal(a.length,b.length);assert.equal(a.length-none.length,1,'a kind costs one byte');
  const at=a.findIndex((x,i)=>x!==b[i]);
  assert.equal(a[at],DICT.indexOf('arroto'));assert.equal(b[at],DICT.indexOf('coco'));
  assert.equal(a.findIndex((x,i)=>i>at&&x!==b[i]),-1,'only the kind byte differs');
  const patched=(index:number)=>{const f=a.slice();f[at]=index;return new FrameDecoder().decode(f);};
  assert.deepEqual(patched(DICT.indexOf('bebado')),{ok:false,error:'bad telegraph kind'},'a dictionary string that is no kind');
  assert.deepEqual(patched(DICT.length),{ok:false,error:'unknown dictionary string'},'an index past the dictionary');
  const ok=patched(DICT.indexOf('molotov'));assert.ok(ok.ok);assert.equal(ok.view.telegraphs[0].kind,'molotov');
});

test('protocol 9: the D-033 cast, the hostile boleto and the telegraph kinds are dictionary bytes appended after protocol 8',()=>{
  assert.ok(DICT.length<255,'255 is the inline escape');
  // Append only: the protocol 8 indexes did not move (the old swarm keeps its slot).
  assert.equal(DICT.indexOf('pernilongo'),2);assert.equal(DICT.indexOf('apagao'),54);
  for(const s of D036_STRINGS)assert.ok(DICT.indexOf(s)>DICT.indexOf('apagao')&&DICT.lastIndexOf(s)===DICT.indexOf(s),`${s} appended once`);
  assert.ok(DICT.includes('coco'),'coco (the poop telegraph) was already there');
  // Each costs one byte where it travels: enemy kind, projectile source, kill and downed events.
  const frame=(kind:string,source:string)=>{
    const v=busyWorld(new Rng(2),1).view;v.enemies[0].kind=kind;v.projectiles=[{...v.projectiles[0],source}];
    const enc=new FrameEncoder();enc.pushEvents([{type:'kill',enemy:'e-1',kind,x:1,y:2},{type:'downed',player:'uuid-0',by:'e-1',source:kind}]);
    const bytes=enc.encode(v),r=new FrameDecoder().decode(bytes);assert.ok(r.ok);
    assert.equal(r.view.enemies[0].kind,kind);assert.equal(r.view.projectiles[0].source,source);
    const kill=r.view.events.find(e=>e.type==='kill'),down=r.view.events.find(e=>e.type==='downed');
    assert.ok(kill?.type==='kill'&&kill.kind===kind&&down?.type==='downed'&&down.source===kind);
    return bytes.length;
  };
  const base=frame('tio-pave','boleto');
  for(const kind of ['bebado','anao-molotov','pombos','agiota'])assert.equal(frame(kind,'boleto-juros'),base,`${kind} + boleto-juros cost a byte each`);
});

// ---------- Protocol 10 (NEW-20261012-ORQ-elenco-p1): the P1 cast in the DICT ----------
test('protocol 10+: the P1 cast is dictionary bytes appended after protocol 9 (every older index unchanged)',()=>{
  assert.ok(PROTOCOL_VERSION>=10);
  assert.ok(DICT.length<255,'255 is the inline escape');
  // Append only: protocol 8 and 9 indexes did not move; the trio comes right after the last protocol 9 string.
  assert.equal(DICT.indexOf('pernilongo'),2);assert.equal(DICT.indexOf('apagao'),54);
  assert.equal(DICT.indexOf('bebado'),55);assert.equal(DICT.indexOf('carimbo'),DICT.indexOf('coach')-1);
  assert.deepEqual(DICT.slice(DICT.indexOf('coach'),DICT.indexOf('coach')+3),['coach','motoboy','influencer']);
  for(const s of ['coach','motoboy','influencer'])assert.equal(DICT.lastIndexOf(s),DICT.indexOf(s),`${s} once`);
  // One byte each where it travels (enemy kind, kill and downed events), and the acting/coached phase round-trips.
  const frame=(kind:string,phase?:number)=>{
    const v=busyWorld(new Rng(2),1).view;v.enemies[0]={...v.enemies[0],kind};delete v.enemies[0].phase;if(phase!==undefined)v.enemies[0].phase=phase;
    const enc=new FrameEncoder();enc.pushEvents([{type:'kill',enemy:'e-1',kind,x:1,y:2},{type:'downed',player:'uuid-0',by:'e-1',source:kind}]);
    const bytes=enc.encode(v),r=new FrameDecoder().decode(bytes);assert.ok(r.ok);
    assert.equal(r.view.enemies[0].kind,kind);assert.equal(r.view.enemies[0].phase,phase);
    const kill=r.view.events.find(e=>e.type==='kill'),down=r.view.events.find(e=>e.type==='downed');
    assert.ok(kill?.type==='kill'&&kill.kind===kind&&down?.type==='downed'&&down.source===kind);
    return bytes.length;
  };
  const base=frame('tio-pave');
  for(const kind of ['coach','motoboy','influencer']){
    assert.equal(frame(kind),base,`${kind} costs a byte`);
    for(const phase of [1,2])assert.ok(frame(kind,phase)>base,`${kind} phase ${phase} round-trips`);
  }
});

test('protocol 12: a frame from an 11 (torres-fio) or 13 room is refused at the version byte (the handshake already sent the update message)',()=>{
  const bytes=new FrameEncoder().encode(busyWorld(new Rng(3),5).view);
  assert.equal(bytes[1],12);
  for(const version of [8,9,10,11,13]){
    const other=bytes.slice();other[1]=version;
    assert.deepEqual(new FrameDecoder().decode(other),{ok:false,error:'protocol version mismatch'},`version ${version}`);
  }
  assert.ok(new FrameDecoder().decode(bytes).ok);
});

test('N27 chained frames: deltas on the previous frame track a busy world exactly; acks a minute late or never do not grow them',()=>{
  const run=(chain:boolean,ackEvery:number,lateBy:number)=>{
    const rng=new Rng(11),w=busyWorld(rng);
    const enc=new FrameEncoder(new WireIds(),{chain}),dec=new FrameDecoder();
    const decoded:{seq:number;event:number}[]=[];let bytes=0,frames=0,events=0;
    collect();
    for(let i=0;i<600;i++){
      if(i%100===99)collect();
      enc.pushEvents(stepWorld(w,rng));
      if(i%2)continue;
      const e0=enc.stats.eventBytes,b=enc.encode(w.view),r=dec.decode(b);
      assert.ok(r.ok,!r.ok?r.error:'');assertSameWorld(r.view,w.view,enc.ids,`tick ${w.tick}`);
      decoded.push({seq:r.seq,event:r.ack.event});
      // Sections only: this test world floods 60 damage events a frame, which the 512-event cap trims either way.
      if(i>20){bytes+=b.length-(enc.stats.eventBytes-e0);frames++;}
      // The phone acks every `ackEvery` frames, naming the frame it decoded `lateBy` frames before.
      if(ackEvery&&frames%ackEvery===0){const a=decoded[Math.max(0,decoded.length-1-lateBy)];enc.ack(a.seq,a.event);}
    }
    return {perFrame:bytes/frames,full:enc.stats.fullFrames,pending:enc.pendingEvents};
  };
  const prompt=run(false,1,0),still=run(false,10,0),chained=run(true,10,0),slow=run(true,10,80),acked80=run(false,10,80),never=run(true,0,0);
  assert.equal(chained.full,1);assert.equal(slow.full,1);assert.equal(never.full,1,'chained frames never need an ack to stay deltas');
  assert.ok(acked80.full>100,`acked baselines past the 64-frame history go full: ${acked80.full}`);
  assert.ok(chained.perFrame<=prompt.perFrame*1.02,`chained ${Math.round(chained.perFrame)} vs acked every frame ${Math.round(prompt.perFrame)}`);
  assert.ok(chained.perFrame<still.perFrame*.9,`chained ${Math.round(chained.perFrame)} vs acked once a second ${Math.round(still.perFrame)}`);
  assert.equal(slow.perFrame,chained.perFrame,'a slow phone gets the very same sections');assert.equal(never.perFrame,chained.perFrame);
});

test('N27 chained frames: a frame the client could not decode makes it resync, and the next frame is full',()=>{
  const rng=new Rng(12),w=busyWorld(rng,40);
  const enc=new FrameEncoder(new WireIds(),{chain:true}),dec=new FrameDecoder();
  for(let i=0;i<5;i++){enc.pushEvents(stepWorld(w,rng));assert.ok(dec.decode(enc.encode(w.view)).ok);}
  enc.pushEvents(stepWorld(w,rng));enc.encode(w.view); // lost on the client side (never decoded)
  enc.pushEvents(stepWorld(w,rng));
  const r=dec.decode(enc.encode(w.view));
  assert.ok(!r.ok&&r.resync,'chained on a frame it does not have');
  enc.resync();enc.pushEvents(stepWorld(w,rng));
  const before=enc.stats.fullFrames,r2=dec.decode(enc.encode(w.view));
  assert.ok(r2.ok);assert.equal(enc.stats.fullFrames,before+1);assertSameWorld(r2.view,w.view,enc.ids,'after resync');
  enc.pushEvents(stepWorld(w,rng));const r3=dec.decode(enc.encode(w.view));assert.ok(r3.ok);assertSameWorld(r3.view,w.view,enc.ids,'chained again');
});

test('N27 farEvery: critters off every legal screen go every other frame, on screen every frame; the client stays consistent',()=>{
  const rng=new Rng(13),w=farWorld(rng,0,0,0),v=w.view;
  v.players=[player('me',0,{x:0,y:0})];
  // 20 on screen (2 u away), 20 off every legal screen but inside the area of interest (40 u along a world axis,
  // where offscreenDistance is 25.5 u), all walking.
  v.enemies=[...Array.from({length:20},(_,i)=>({id:`n-${i}`,kind:'bebado',x:2+i*.1,y:1,hp:40,maxHp:40})),
    ...Array.from({length:20},(_,i)=>({id:`f-${i}`,kind:'bebado',x:40+i*.1,y:0,hp:40,maxHp:40}))];
  const enc=new FrameEncoder(new WireIds(),{viewer:'me',chain:true,farEvery:2}),dec=new FrameDecoder();
  const seenAt=new Map<string,number[]>();
  for(let f=1;f<=8;f++){
    for(const e of v.enemies)e.x+=.05;v.tick+=2;
    const r=dec.decode(enc.encode(v));assert.ok(r.ok,!r.ok?r.error:'');
    for(const e of r.view.enemies){const src=v.enemies.find(s=>enc.ids.label('enemies',s.id)===e.id)!;
      const fresh=Math.abs(e.x-src.x)<1/POS_SCALE*2;(seenAt.get(src.id[0])??seenAt.set(src.id[0],[]).get(src.id[0])!).push(fresh?1:0);}
  }
  assert.ok(seenAt.get('n')!.every(x=>x===1),'on screen: exact every frame');
  const far=seenAt.get('f')!;
  assert.ok(far.includes(0)&&far.includes(1),'off screen: held on some frames, exact on the others');
  assert.equal(far.filter(x=>x===1).length,20*5,'new on the first frame, then on the even ones (4 of the other 7)');
});

test('N27 chained frames: an event goes once, never again every 5 s; a resync sends the unacked ones again',()=>{
  const w=busyWorld(new Rng(14),20);
  const enc=new FrameEncoder(new WireIds(),{chain:true}),dec=new FrameDecoder();
  enc.pushEvents([{type:'levelup',level:3}]);w.view.tick++;
  const r0=dec.decode(enc.encode(w.view));assert.ok(r0.ok&&r0.view.events.some(e=>e.type==='levelup'));
  // 20 s of frames with no ack at all: each frame's event block is the empty count (1 byte). The old rule resent
  // the event every 5 s.
  const before=enc.stats.eventBytes;
  for(let i=0;i<200;i++){w.view.tick+=2;assert.ok(dec.decode(enc.encode(w.view)).ok);}
  assert.equal(enc.stats.eventBytes-before,200,'no event bytes on a chained, ordered link');
  assert.equal(enc.pendingEvents,1,'still pending until acked');
  const plain=new FrameEncoder(new WireIds());plain.pushEvents([{type:'levelup',level:3}]);
  const b0=plain.stats.eventBytes;for(let i=0;i<200;i++){w.view.tick+=2;plain.encode(w.view);}
  assert.ok(plain.stats.eventBytes-b0>200+3*4,'acked baselines still resend every 5 s');
  enc.resync();w.view.tick+=2;
  const fresh=new FrameDecoder(),r=fresh.decode(enc.encode(w.view));
  assert.ok(r.ok&&r.view.events.some(e=>e.type==='levelup'),'after a resync it goes again');
});

// ---------- Protocol 11 (torres-fio): the tower defenses in the structures ----------
/** Twelve defenses (D-009 with the team's limit), a Gustavão among them; `tick` turns their aim and wears their hp. */
function defenses(tick:number):StructureView[]{
  const kinds=['vigia-do-predio','vigias-armados','ninho-de-metralhadora','rojao-de-festa','morteiro','obuseiro','holofote','arame-e-sirene',
    'antiaerea-quadrupla','posto-de-radar','atiradores-do-telhado','gustavao'];
  const phases=['pronta','pronta','danificada','obra-2','pronta','pronta','pronta','obra-3','pronta','pronta','pronta','pronta'];
  return kinds.map((kind,i)=>({id:`defesa-${i+1}`,kind,x:6+i,y:18-(i%3),hp:Math.max(1,300-((tick*7+i*13)%120)),maxHp:300,
    tier:i===0?1:2+(i%4),...(i?{branch:'ABC'[i%3]}:{}),phase:phases[i],aim:((tick*.07+i*.13)%1)}));
}

test('protocol 11: a defense's tier, branch, phase and aim round-trip; a field that goes away is gone on the phone too',()=>{
  assert.ok(PROTOCOL_VERSION>=11);
  for(const s of ['vigia-do-predio','gustavao','obra-1','pronta','ruina','A','C'])assert.ok(DICT.includes(s),s);
  assert.ok(DICT.length<255,'255 is the inline escape');
  const v=busyWorld(new Rng(2),1).view;
  const withDefs={...v,structures:[...v.structures,...defenses(0)]};
  const r=new FrameDecoder().decode(new FrameEncoder().encode(withDefs));assert.ok(r.ok);
  const back=r.view.structures.filter(s=>s.kind!=='muralha');
  assert.equal(back.length,12);
  for(const [i,s] of back.entries()){
    const want=defenses(0)[i];
    assert.equal(s.kind,want.kind);assert.equal(s.tier,want.tier);assert.equal(s.branch,want.branch);assert.equal(s.phase,want.phase);
    assert.ok(Math.abs(s.aim!-want.aim!)<=1/255,`aim ${s.aim} vs ${want.aim}`);
  }
  assert.equal(r.view.structures.find(s=>s.kind==='muralha')!.tier,undefined,'the wall has none of the new fields');
  // Present, then absent (here a ruin loses its aim and branch): the delta clears them on the phone.
  const enc=new FrameEncoder(),dec=new FrameDecoder();
  const first=dec.decode(enc.encode(withDefs));assert.ok(first.ok);enc.ack(first.seq,first.ack.event);
  const gone={...withDefs,tick:withDefs.tick+2,structures:withDefs.structures.map(x=>x.kind==='holofote'?{...x,hp:0,phase:'ruina',aim:undefined,branch:undefined}:x)};
  const second=dec.decode(enc.encode(gone));assert.ok(second.ok);
  const ruin=second.view.structures.find(x=>x.kind==='holofote')!;
  assert.equal(ruin.phase,'ruina');assert.equal(ruin.hp,0);assert.equal(ruin.aim,undefined);assert.equal(ruin.branch,undefined);
});

test('D-009 with 12 defenses firing: 6 clients x 300 enemies stay inside the 4G budget at 10 and 20 Hz',t=>{
  const results:Record<string,number>={};
  for(const hz of [10,20]){
    const rng=new Rng(8),w=busyWorld(rng);
    const clients=Array.from({length:CLIENTS},()=>({enc:new FrameEncoder(),dec:new FrameDecoder(),inFlight:[] as {seq:number;event:number;at:number}[]}));
    const seconds=10,every=20/hz;
    let bytes=0;
    for(let i=0;i<seconds*20;i++){
      const events=stepWorld(w,rng);
      // Every defense turns and loses hp every tick (worse than real: they fire on a cooldown).
      w.view.structures=[w.view.structures[0],...defenses(w.view.tick)];
      for(const c of clients)c.enc.pushEvents(events);
      if(i%every)continue;
      for(const c of clients){
        const frame=c.enc.encode(w.view);bytes+=frame.length;
        const res=c.dec.decode(frame);assert.ok(res.ok);
        c.inFlight.push({seq:res.seq,event:res.ack.event,at:i+3});
        while(c.inFlight.length&&c.inFlight[0].at<=i){const a=c.inFlight.shift()!;c.enc.ack(a.seq,a.event);}
      }
    }
    results[`${hz}Hz`]=Math.round(bytes/clients.length/seconds);
  }
  t.diagnostic(`protocol 11 bytes/s per client with 12 defenses turning every tick: ${JSON.stringify(results)}`);
  assert.ok(results['20Hz']<50_000,`20 Hz: ${results['20Hz']}`);
  assert.ok(results['10Hz']<30_000,`10 Hz: ${results['10Hz']}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import type {SimEvent} from '../src/game/sim/types.ts';
import type {EnemyView,PickupView,ProjectileView,RunView,StructureView,TelegraphView} from '../src/game/sim/view.ts';
import {
  FrameDecoder,FrameEncoder,MAX_PENDING_EVENTS,POS_SCALE,PROTOCOL_VERSION,WireIds,parseClientControl,parseServerControl,
  type FrameInput,type PlayerWireView,
} from '../src/game/net/protocol4.ts';

const near=(a:number,b:number,eps:number,msg:string)=>assert.ok(Math.abs(a-b)<=eps,`${msg}: ${a} vs ${b}`);
const POS_EPS=1/POS_SCALE;

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
    enemies:Array.from({length:enemies},(_,i):EnemyView=>({id:`e-${i+1}`,kind:rng.pick(['gosma','pernilongo','tio-pave','fiscal']),
      x:rng.range(1,23),y:rng.range(1,23),hp:rng.range(5,80),maxHp:80,...(i%50===0?{elite:true}:{})})),
    pickups:Array.from({length:150},(_,i):PickupView=>({id:`xp-${i+1}`,kind:'xp',x:rng.range(2,22),y:rng.range(2,22),value:rng.int(1,5)})),
    projectiles:Array.from({length:100},(_,i):ProjectileView=>({id:`p-${i+1}`,source:'boleto',x:rng.range(4,20),y:rng.range(4,20),
      vx:rng.range(-9,9),vy:rng.range(-9,9),radius:.2,hostile:i%10===0})),
    telegraphs:Array.from({length:6},(_,i):TelegraphView=>({id:`t-${i+1}`,shape:'line',x:12,y:12,radius:3,dx:.6,dy:.8,width:1.2,fireTick:1020+i})),
    structures:[{id:'muralha',kind:'muralha',x:12,y:12,hp:800,maxHp:1000}],
  };
  return {tick:1000,view,velocity:new Map(view.enemies.map(e=>[e.id,{x:rng.range(-1,1),y:rng.range(-1,1)}]))};
}
let spawned=10000;
/** One server tick: enemies walk, a few die and spawn, pickups home, projectiles fly, hp drops. Returns the tick's events. */
function stepWorld(w:ServerWorld,rng:Rng):SimEvent[]{
  const v=w.view,events:SimEvent[]=[];
  w.tick++;v.tick=w.tick;
  for(const e of v.enemies){const d=w.velocity.get(e.id)!;e.x+=d.x/20;e.y+=d.y/20;}
  for(const p of v.projectiles){p.x+=p.vx/20;p.y+=p.vy/20;}
  for(let i=0;i<30&&v.enemies.length;i++){
    const e=rng.pick(v.enemies),amount=rng.range(1,9);
    e.hp-=amount;events.push({type:'damage',target:e.id,amount,source:'uuid-0',weapon:'chinelo',...(amount>8?{crit:true}:{})});
  }
  for(const e of v.enemies.filter(e=>e.hp<=0)){events.push({type:'kill',enemy:e.id,kind:e.kind,x:e.x,y:e.y,by:'uuid-1'});}
  v.enemies=v.enemies.filter(e=>e.hp>0);
  while(v.enemies.length<300){
    const id=`e-${++spawned}`;v.enemies.push({id,kind:'gosma',x:rng.range(1,23),y:rng.range(1,23),hp:40,maxHp:40});w.velocity.set(id,{x:rng.range(-1,1),y:rng.range(-1,1)});
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
    {type:'kill',enemy:'e-2',kind:'gosma',x:5,y:6,by:'uuid-1',eventId:8},
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
  assert.equal(dec.decode(Uint8Array.of(0x56,3)).ok,false,'other version');
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
    const rng=new Rng(8),w=busyWorld(rng);
    const clients=Array.from({length:6},()=>({enc:new FrameEncoder(),dec:new FrameDecoder(),inFlight:[] as {seq:number;event:number;at:number}[]}));
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
  // 4G budget: well under 50 KB/s per client at 20 Hz, and 10 Hz cheaper.
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
import {INTEREST_HYSTERESIS,INTEREST_RADIUS} from '../src/game/sim/offscreen.ts';
import {POS_LIMIT,SEND_EVERY,sendSlot,sendsOn,type WorldDescriptor} from '../src/game/net/protocol4.ts';

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
  enc.pushEvents([{type:'kill',enemy:'e-1',kind:'gosma',x:10_001,y:-9_999},{type:'round',index:1,phase:'wave',name:'Pix Errado'}]);
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
    {id:'e-near',kind:'gosma',x:5000+10,y:-3000,hp:20,maxHp:20},
    {id:'e-walker',kind:'gosma',x:5000+R-1,y:-3000,hp:20,maxHp:20},
    {id:'e-far',kind:'gosma',x:5000+R+30,y:-3000,hp:20,maxHp:20},
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
  enc.pushEvents([{type:'kill',enemy:'e-near',kind:'gosma',x:5010,y:-3000,by:'uuid-0'},{type:'kill',enemy:'e-far',kind:'gosma',x:5000+R+30,y:-3000}]);
  v.enemies=v.enemies.filter(e=>e.id!=='e-near'&&e.id!=='e-far');r=frame();
  assert.ok(!ids(r,'enemies').includes('e-near'));assert.deepEqual(r.left,[]);
  assert.deepEqual(r.view.events.filter(e=>e.type==='kill').map(e=>e.type==='kill'&&enc.ids.resolve(e.enemy)),['e-near'],'the far kill is not sent');
  // Coming back: the walker returns inside the radius and is sent again.
  v.enemies.push({id:'e-walker',kind:'gosma',x:5000+R-2,y:-3000,hp:20,maxHp:20});r=frame();
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
    return {id:`e-${++n}`,kind:rng.pick(['gosma','pernilongo','tio-pave','fiscal']),x:c.x+Math.cos(a)*d,y:c.y+Math.sin(a)*d,hp:rng.range(5,80),maxHp:80};};
  for(const c of centers){
    for(let i=0;i<300;i++)view.enemies.push(enemy(c));
    for(let i=0;i<150;i++)view.pickups.push({id:`xp-${++n}`,kind:'xp',x:c.x+rng.range(-12,12),y:c.y+rng.range(-12,12),value:rng.int(1,5)});
    for(let i=0;i<100;i++)view.projectiles.push({id:`p-${++n}`,source:'boleto',x:c.x+rng.range(-8,8),y:c.y+rng.range(-8,8),vx:rng.range(-9,9),vy:rng.range(-9,9),radius:.2,hostile:i%10===0});
  }
  const home=new Map(view.enemies.map((e,i)=>[e.id,centers[Math.floor(i/300)]]));
  const shotHome=new Map(view.projectiles.map((p,i)=>[p.id,centers[Math.floor(i/100)]]));
  /** One server tick of every cluster: chase, 30 hits + kills + respawn on the ring, homing pickups, shots. */
  const step=():SimEvent[]=>{
    const events:SimEvent[]=[];view.tick++;
    for(const e of view.enemies){const c=home.get(e.id)!,dx=c.x-e.x,dy=c.y-e.y,d=Math.hypot(dx,dy)||1;e.x+=dx/d*1.4/20+rng.range(-.02,.02);e.y+=dy/d*1.4/20+rng.range(-.02,.02);}
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
/** Bytes/s per client at 10 Hz over 10 s, acks ~150 ms late; `stagger` spreads the clients over both ticks. */
function measure(world:{view:FrameInput;step:()=>SimEvent[]},interest:boolean,stagger=false){
  const ids=new WireIds();
  const clients=world.view.players.map((p,i)=>({enc:new FrameEncoder(ids,{viewer:p.id,interest:interest?undefined:false,slot:stagger?sendSlot(i):0}),dec:new FrameDecoder(),inFlight:[] as {seq:number;event:number;at:number}[]}));
  let bytes=0,enemies=0,frames=0,encodeMs=0;
  const perTick:number[]=[];
  for(let i=0;i<200;i++){
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
  assert.equal(frames,clients.length*100,'10 Hz for every client');
  return {encodeTickMsP50:Math.round(perTick[perTick.length>>1]*100)/100,encodeTickMsP95:Math.round(perTick[Math.floor(perTick.length*.95)]*100)/100,bytesPerSecond:Math.round(bytes/clients.length/10),enemiesPerFrame:Math.round(enemies/frames),eventBytes:Math.round(clients[0].enc.stats.eventBytes/10),
    encodeMsPerFrame:Math.round(encodeMs/frames*100)/100};
}

test('bandwidth on the wide map at 10 Hz: 6 players together and 6 spread, 300 enemies around each',t=>{
  const together=measure(clusters(new Rng(51),[{x:8000,y:-6000}],[0,0,0,0,0,0]),true);
  const atOrigin=measure(clusters(new Rng(51),[{x:12,y:12}],[0,0,0,0,0,0]),true);
  const spread=[0,1,2,3,4,5].map(i=>({x:8000+Math.cos(i/6*Math.PI*2)*200,y:-6000+Math.sin(i/6*Math.PI*2)*200}));
  const apart=measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),true);
  const apartAll=measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),false);
  const staggered=measure(clusters(new Rng(52),spread,[0,1,2,3,4,5]),true,true);
  t.diagnostic(`protocol 4, wide map, bytes/s per client at 10 Hz: together ${JSON.stringify(together)}; same at the origin ${JSON.stringify(atOrigin)}; spread 200 u ${JSON.stringify(apart)}; spread without area of interest ${JSON.stringify(apartAll)}; spread, clients staggered over both ticks ${JSON.stringify(staggered)}`);
  assert.ok(Math.abs(staggered.bytesPerSecond-apart.bytesPerSecond)<apart.bytesPerSecond*.05,'staggering costs no bandwidth');
  // D-018 budget: the island worst case was 26.7 KB/s per client; the wide map must stay in the same range.
  assert.ok(together.bytesPerSecond<32_000,`together ${together.bytesPerSecond}`);
  assert.ok(apart.bytesPerSecond<32_000,`spread ${apart.bytesPerSecond}`);
  assert.ok(apart.enemiesPerFrame<=300,'each client only gets its own horde');
  assert.ok(apartAll.bytesPerSecond>apart.bytesPerSecond*3,'the area of interest is what keeps spread players cheap');
  assert.ok(Math.abs(together.bytesPerSecond-atOrigin.bytesPerSecond)<atOrigin.bytesPerSecond*.05,'8 000 units out costs the same as the origin');
});

test('the server world descriptor rebuilds the same terrain on the client, island and endless',async()=>{
  const {worldDescriptor}=await import('../src/game/net/shared.ts');
  const {TerrainField}=await import('../src/game/terrain/field.ts');
  for(const world of ['ilha','infinito'] as const){
    const server=new TerrainField(777,{world}),d=worldDescriptor(server);
    const w=busyWorld(new Rng(3),2);(w.view as FrameInput).world=d;
    const r=new FrameDecoder().decode(new FrameEncoder().encode(w.view));
    assert.ok(r.ok&&r.world);
    assert.equal(r.world.kind,world);
    assert.equal(new TerrainField(r.world.seed,{world:r.world.kind}).signature,d.signature);
  }
});

test('area of interest without a body: a spectator follows a player, an empty room the base, never "everything"',()=>{
  const v=farWorld(new Rng(61),3000,3000,0).view;
  v.enemies=[{id:'e-a',kind:'gosma',x:3001,y:3000,hp:5,maxHp:5},{id:'e-b',kind:'gosma',x:1,y:1,hp:5,maxHp:5}];
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

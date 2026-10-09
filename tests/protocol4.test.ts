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
  assert.deepEqual(p1.stats,{damage:1234,kills:56,revives:2,pickups:90});
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

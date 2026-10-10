import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../multiplayer/room.ts';
import {JsonRunFeed,FrameRunFeed,DamageTally,MAX_FEED_EVENTS} from '../src/game/net/run-feed.ts';
import {delta,applyDelta,ROOM_PROTOCOL,type Snapshot} from '../src/game/net/shared.ts';
import {createEnemy} from '../src/game/sim/enemies/catalog.ts';


/** JSON control messages in `messages`, protocol 4 frames in `frames`. */
function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[],closes:any[]=[];
  return {messages,frames,closes,read:0,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:(code:number,reason:string)=>closes.push({code,reason})};
}
type TestPeer=ReturnType<typeof peer>;
const join=(r:Room,p:Peer,n='Amigo',classId='cidadao-comum',now=1000)=>{r.connect(p,now);r.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:n,classId}),now);};
const command=(room:Room,p:Peer,message:object,now=1100)=>room.receive(p,JSON.stringify(message),now);
const idOf=(p:TestPeer)=>p.messages.find(m=>m.t==='welcome').id as string;
let clock=1200;
const rooms=new Map<Room,TestPeer[]>();
/** One server tick at 50 ms; peers ping now and then, as the client heartbeat does, so the room keeps them. */
function step(room:Room){
  clock+=50;
  if(clock%2000===0)for(const p of rooms.get(room)??[])command(room,p,{t:'ping',at:clock},clock);
  room.advance(clock);
}
function startRun(room:Room,peers:TestPeer[]){
  clock=1200;rooms.set(room,peers);
  for(const p of peers)command(room,p,{t:'ready',round:room.run.snapshot().round,ready:true});
  for(let i=0;i<60;i++)step(room);
  assert.equal(room.run.snapshot().phase,'combat');
}
/** Decodes the peer's new frames into the feed and acks the last one, as client.ts does; offers go to setOffers. */
function pump(room:Room,feed:FrameRunFeed,p:TestPeer,offersFrom={n:0}){
  let last=0;
  for(;p.read<p.frames.length;p.read++){const r=feed.decode(p.frames[p.read]);assert.ok(r.ok,r.ok?'':r.error);last=r.seq;}
  if(last)command(room,p,{t:'ack',seq:last},clock);
  for(;offersFrom.n<p.messages.length;offersFrom.n++){const m=p.messages[offersFrom.n];if(m.t==='offers')feed.setOffers(m.offers);}
}
/** Advances until the peer got a frame taken after this tick's step. */
function advanceToFrame(room:Room,p:TestPeer){
  for(let i=0;i<3;i++){const before=p.frames.length;step(room);if(p.frames.length>before)return;}
  assert.fail('no frame');
}
const near=(a:number,b:number,q=.002)=>Math.abs(a-b)<=q;

test('the protocol 4 feed rebuilds the server run view from the room frames',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  for(let i=0;i<220;i++){step(room);pump(room,feed,a);}
  advanceToFrame(room,a);pump(room,feed,a);
  const id=idOf(a),server=room.sim.view(id),view=feed.take(),server_=(clientId:string)=>room.ids.resolve(clientId);
  assert.ok(server.enemies.length>0,'the director spawned critters');
  assert.equal(view.tick,server.tick);
  assert.deepEqual(view.round,server.round);assert.deepEqual(view.team,server.team);
  assert.deepEqual(view.enemies.map(e=>server_(e.id)).sort(),server.enemies.map(e=>e.id).sort(),'every critter, under its client id');
  for(const e of server.enemies){
    const mine=view.enemies.find(m=>server_(m.id)===e.id)!;
    assert.match(mine.id,/^e\d+$/);assert.equal(feed.enemies.get(mine.id),mine);
    assert.equal(mine.kind,e.kind);assert.equal(mine.hp,Math.ceil(e.hp-1e-9));assert.equal(mine.maxHp,Math.ceil(e.maxHp-1e-9));
    assert.ok(near(mine.x,e.x)&&near(mine.y,e.y));assert.equal(!!mine.elite,!!e.elite);assert.equal(!!mine.boss,!!e.boss);
  }
  assert.deepEqual(view.pickups.map(p=>server_(p.id)).sort(),server.pickups.map(p=>p.id).sort());
  assert.deepEqual(view.projectiles.map(p=>server_(p.id)).sort(),server.projectiles.map(p=>p.id).sort());
  assert.equal(view.telegraphs.length,server.telegraphs.length);
  for(const p of server.players){
    const mine=view.players.find(q=>q.id===p.id)! as any,sp=room.sim.players.get(p.id)!;
    assert.equal(mine.name,p.name);assert.equal(mine.classId,p.classId);assert.equal(mine.maxHp,Math.ceil(p.maxHp-1e-9));
    assert.deepEqual(mine.weapons,p.weapons);assert.deepEqual(mine.passives,p.passives);
    assert.equal(!!mine.downed,!!p.downed);assert.equal(!!mine.eliminated,!!p.eliminated);
    assert.ok(near(mine.x,sp.x)&&near(mine.y,sp.y));assert.equal(mine.ack,sp.ack);
    assert.equal(mine.attackTick??0,sp.attackTick??0,'attack swing tick');assert.equal(mine.skillReadyTick??0,sp.skillReadyTick??0);
  }
});

test('events reach the view once each, in order, also across a reconnection',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const ids:number[]=[];
  for(let i=0;i<500;i++){step(room);pump(room,feed,a);if(i%7===0)ids.push(...feed.take().events.map(e=>e.eventId));}
  ids.push(...feed.take().events.map(e=>e.eventId));
  assert.ok(ids.length>10,`only ${ids.length} events`);
  assert.deepEqual(ids,[...new Set(ids)].sort((x,y)=>x-y),'no repeats and ascending');
  // Reconnection: a new socket, a fresh encoder; the client resets its decoder (D-018) and nothing is replayed.
  const token=a.messages.find(m=>m.t==='welcome').token;room.disconnect(a,clock);
  const again=peer();room.connect(again,clock);command(room,again,{t:'join',protocol:ROOM_PROTOCOL,token},clock);rooms.get(room)![0]=again;
  feed.reset();pump(room,feed,again);
  for(let i=0;i<60;i++){step(room);pump(room,feed,again);}
  const after=feed.take().events.map(e=>e.eventId);
  assert.ok(after.length>0,'events flow again');assert.ok(after.every(e=>e>ids.at(-1)!),'nothing old comes back');
  assert.deepEqual(after,[...new Set(after)].sort((x,y)=>x-y));
  assert.equal(feed.take().events.length,0,'a second take has nothing new');
});

test('a downed player shows its fall, the critter behind it, revive progress and build to every client',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,b);
  const victim=room.sim.players.get(idOf(a))!;victim.invulnerableUntil=0;
  // Sturdy, so the starting weapon does not kill it before it hits.
  const hitter=createEnemy(room.sim.world,'pernilongo',{x:victim.x+1,y:victim.y});hitter.hp=hitter.maxHp=1e6;
  advanceToFrame(room,b);pump(room,feed,b);feed.take();
  room.sim.world.damagePlayer(victim.id,1e6,hitter.id);
  advanceToFrame(room,b);pump(room,feed,b);
  const view=feed.take(),fallen=view.players.find(p=>p.id===victim.id)!;
  assert.ok(fallen.downed,'downed reaches the ally');assert.equal(fallen.downed!.bleedOutTick,victim.downed!.bleedOutTick);
  assert.equal(fallen.hp,0);assert.ok(fallen.maxHp>0);assert.ok(fallen.weapons.length>0,'starting weapon');
  const downed=view.events.find(e=>e.type==='downed') as any;
  assert.ok(downed,'downed event');assert.equal(downed.player,victim.id);assert.equal(downed.source,'pernilongo','what got you travels in protocol 4');
  assert.equal(room.ids.resolve(downed.by),hitter.id,'by is the client id of the hitter');
  // JSON reference (protocol 3, tests only): deltas carry the extras only when they change.
  const before=room.sim.snapshot(),after=room.sim.snapshot();
  assert.deepEqual(delta(before,after).x!.players,[]);
  assert.deepEqual(applyDelta(before,delta(before,after)).x!.players,after.x!.players);
});

test('tombstones leave the map and boss phase follows its event',()=>{
  const feed=new JsonRunFeed();
  const base=(tick:number,full:boolean,enemies:Snapshot['enemies'],events:any[]=[]):Snapshot=>({t:'state',tick,full,players:[],enemies,removed:[],victory:false,
    x:{round:{index:10,total:10,phase:'wave',phaseEndsTick:0,remaining:1,name:'x'} as any,team:{xp:0,level:1,nextXp:5},pickups:[],projectiles:[],telegraphs:[],events}});
  feed.apply(base(10,true,[['e1',1,1,30,'gosma',30,0],['boss',5,5,900,'chefe',1000,2]]));
  assert.equal(feed.enemies.get('boss')?.phase,1);
  feed.apply(base(12,false,[['e1',1.5,1,12],['boss',5,5,400]],[{eventId:7,type:'boss-phase',enemy:'boss',phase:2}]));
  assert.deepEqual({kind:feed.enemies.get('e1')!.kind,maxHp:feed.enemies.get('e1')!.maxHp,hp:feed.enemies.get('e1')!.hp},{kind:'gosma',maxHp:30,hp:12},'a short delta keeps kind and maxHp');
  assert.equal(feed.enemies.get('boss')?.phase,2);assert.equal(feed.take().enemies.find(e=>e.boss)?.phase,2);
  feed.apply(base(14,false,[['e1',1.5,1,0,'gosma',30,0]]));
  assert.equal(feed.enemies.has('e1'),false);
  // Next round's full snapshot keeps the boss phase it already learned.
  feed.apply(base(16,true,[['boss',5,5,380,'chefe',1000,2]]));
  assert.equal(feed.enemies.get('boss')?.phase,2);
});

test('a restarted room (older full snapshot) accepts event ids from the start again',()=>{
  const feed=new JsonRunFeed();
  const snap=(tick:number,full:boolean,eventId:number):Snapshot=>({t:'state',tick,full,players:[],enemies:[],removed:[],victory:false,
    x:{round:{} as any,team:{xp:0,level:1,nextXp:5},pickups:[],projectiles:[],telegraphs:[],events:[{eventId,type:'levelup',level:2}]}});
  feed.apply(snap(500,true,90));assert.equal(feed.take().events.length,1);
  feed.apply(snap(502,false,3));assert.equal(feed.take().events.length,0,'same room: an old id is a repeat');
  feed.apply(snap(4,true,3));assert.equal(feed.take().events.length,1,'restarted room: ids start over');
});

test('offers map to the HUD view and bump only the offers version (no horde push); the event buffer is bounded',()=>{
  const feed=new JsonRunFeed(),state=feed.stateVersion,offers=feed.offersVersion;
  feed.apply({t:'state',tick:5,full:true,players:[],enemies:[],removed:[],victory:false,x:{round:{} as any,team:{xp:0,level:1,nextXp:5},pickups:[],projectiles:[],telegraphs:[],events:[{eventId:1,type:'levelup',level:2} as any]}});
  assert.equal(feed.stateVersion,state+1);assert.equal(feed.offersVersion,offers);
  feed.setOffers([{id:'lvl-2-p',playerId:'p',source:'level',level:2,choices:[{itemId:'chinelo',level:2}],deadlineTick:300,defaultIndex:0} as any]);
  assert.equal(feed.stateVersion,state+1,'an offers push is not a new tick');assert.equal(feed.offersVersion,offers+1);
  assert.equal(feed.peek().events.length,0,'peek leaves the events for the next take');assert.equal(feed.peek().offers.length,1);
  assert.equal(feed.take().events.length,1);
  const offer=feed.take().offers[0];
  assert.deepEqual(offer,{id:'lvl-2-p',source:'level',level:2,choices:[{itemId:'chinelo',level:2}],deadlineTick:300,defaultIndex:0});
  const events=Array.from({length:MAX_FEED_EVENTS+50},(_,i)=>({eventId:i+1,type:'levelup',level:2}));
  feed.apply({t:'state',tick:1,full:true,players:[],enemies:[],removed:[],victory:false,x:{round:{} as any,team:{xp:0,level:1,nextXp:5},pickups:[],projectiles:[],telegraphs:[],events:events as any}});
  const taken=feed.take().events;
  assert.equal(taken.length,MAX_FEED_EVENTS);assert.equal(taken.at(-1)!.eventId,MAX_FEED_EVENTS+50,'the newest are kept');
});

test('damage tally counts hits on critters once and ignores hits taken',()=>{
  const tally=new DamageTally(),players=new Set(['p','q']);
  const view={events:[
    {eventId:1,type:'damage',target:'e1',amount:10,source:'p'},{eventId:2,type:'damage',target:'p',amount:8,source:'e1'},
    {eventId:3,type:'damage',target:'e2',amount:4.6,source:'q'},{eventId:4,type:'damage',target:'e1',amount:5}]} as any;
  tally.add(view,id=>players.has(id));tally.add(view,id=>players.has(id));
  assert.equal(tally.of('p'),10);assert.equal(tally.of('q'),5);assert.equal(tally.of('e1'),0);
  tally.reset();assert.equal(tally.of('p'),0);
  tally.add(view,id=>players.has(id));assert.equal(tally.of('p'),0,'old events stay de-duplicated after a reset');
});

test('a choose command shaped like the client\'s reaches the simulation',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  // Offers go out with each client's frame (every other tick).
  step(room);step(room);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const offer=feed.take().offers[0];assert.ok(offer,'offer pushed to the client');
  const before=a.messages.length;
  command(room,a,{t:'choose',offer:offer.id,index:offer.defaultIndex,round:room.run.snapshot().round},clock);
  const answer=a.messages.slice(before).find(m=>m.t==='offers');
  assert.ok(answer);assert.ok(!answer.offers.some((o:any)=>o.id===offer.id),'the picked offer is gone');
});

test('an entity that leaves the area of interest disappears without a kill (no poof)',()=>{
  const room=new Room(1000,undefined,{world:'infinito'}),a=peer();join(room,a);startRun(room,[a]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const p=room.sim.players.get(idOf(a))!;
  const far=createEnemy(room.sim.world,'gosma',{x:p.x+20,y:p.y});
  advanceToFrame(room,a);pump(room,feed,a);
  const label=[...feed.enemies.keys()].find(id=>room.ids.resolve(id)===far.id)!;assert.ok(label,'sent while near');
  feed.take();
  far.x=p.x+200;
  advanceToFrame(room,a);pump(room,feed,a);
  assert.equal(feed.enemies.has(label),false,'gone from the view');assert.ok(room.sim.world.enemies.has(far.id),'it still exists');
  assert.ok(feed.left.includes(label),'reported as left');
  assert.ok(!feed.take().events.some(e=>e.type==='kill'),'no kill, so the renderer plays no poof');
});

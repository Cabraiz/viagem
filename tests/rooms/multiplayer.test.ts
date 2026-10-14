import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {STEP,reconcile,simulate} from '../../src/maps/prediction.ts';
import {delta,ROOM_PROTOCOL,GRACE_MS,type Input} from '../../src/protocol/room.ts';
import {Room,LAB_REACH,ROOM_LIFETIME_MS,RUN_START_WINDOW_MS,ROOM_CLOSING_NOTICE,VERSION_REFUSED,type Peer} from '../../multiplayer/room.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';
import {PROTOCOL_VERSION} from '../../src/protocol/protocol4.ts';
import {walkable,worldBase,heroSpeed} from '../../src/maps/world.ts';
/** The island hero's walk (u/s): 2 × the base world.ts SPEED since velocidade-heroi-e-projetil. */
const WALK=heroSpeed();
import {SOS_COOLDOWN_MS,SOS_SLACK_MS} from '../../src/rules/sos.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';

/** Test peer: JSON control messages parsed in `messages`, protocol 4 frames in `frames` (in arrival order in `log`). */
function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[],closes:any[]=[],log:any[]=[];
  return {messages,frames,closes,log,send:(s:string|Uint8Array)=>{if(typeof s==='string'){const m=JSON.parse(s);messages.push(m);log.push(m);}else{frames.push(s);log.push(s);}},close:(code:number,reason:string)=>closes.push({code,reason})};
}
const join=(r:Room,p:Peer,n='Amigo',now=1000)=>{r.connect(p,now);r.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:n,classId:'cidadao-comum'}),now);};
test('six slots, seventh refused, and rooms isolated',()=>{
  const r=new Room(1000),peers=Array.from({length:7},()=>peer());peers.forEach((p,i)=>join(r,p,`Amigo ${i}`));
  assert.equal(r.sim.players.size,6);assert.equal(peers[6].closes[0].code,4003);
  const other=new Room(1000),p=peer();join(other,p);assert.equal(other.sim.players.size,1);assert.equal(r.sim.players.size,6);
});
test('a class this build no longer has (old client with tia-festa) plays as the default class, a non-string is refused',()=>{
  const r=new Room(1000),old=peer();r.connect(old,1000);
  r.receive(old,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Tia Cleide',classId:'tia-festa'}),1000);
  const w=old.messages.find(m=>m.t==='welcome');
  assert.ok(w,'joined without an error');assert.equal(r.sim.players.get(w.id)?.classId,'cidadao-comum');
  const bad=peer();r.connect(bad,1000);r.receive(bad,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Zé',classId:42}),1000);
  assert.equal(bad.closes[0]?.code,4003);
});
test('reconnect preserves identity, health, score, enemies and refuses stolen display name',()=>{
  const r=new Room(1000),a=peer();join(r,a);const w=a.messages.find(m=>m.t==='welcome');
  const original=r.sim.players.get(w.id)!;original.hp=64;original.score=10;
  const enemy=createEnemy(r.sim.world,'bebado',{x:original.x+8,y:original.y});enemy.hp=2;
  r.disconnect(a,1500);const b=peer();r.connect(b,1600);r.receive(b,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,token:w.token}),1600);
  assert.equal(b.messages[0].id,w.id);assert.equal(r.sim.players.size,1);assert.equal(original.hp,64);assert.equal(original.score,10);
  assert.equal(r.sim.world.enemies.get(enemy.id)?.hp,2);
  // Same token again while b is still connected: the newest connection takes the character (VGM-047), b is told and closed with 4009.
  const duplicate=peer();r.connect(duplicate,1600);r.receive(duplicate,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,token:w.token}),1600);
  assert.equal(duplicate.messages[0].t,'welcome');assert.equal(duplicate.messages[0].id,w.id);assert.deepEqual(duplicate.closes,[]);
  assert.equal(b.closes[0].code,4009);assert.equal(b.messages.at(-1).t,'replaced');assert.equal(r.sim.players.size,1);assert.equal(original.online,true);
  // b's socket closing afterwards does not take the character offline.
  r.disconnect(b,1650);assert.equal(original.online,true);
  const fake=peer();r.connect(fake,1600);r.receive(fake,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,token:'invalid',name:'Amigo'}),1600);assert.equal(fake.closes[0].code,4003);
});
test('expired token cannot reclaim a slot or create a duplicate',()=>{
  const r=new Room(1000),p=peer();join(r,p);const token=p.messages[0].token;r.disconnect(p,1100);
  const late=1100+GRACE_MS+1000;
  const back=peer();r.connect(back,late);r.receive(back,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,token}),late);assert.equal(back.closes[0].code,4003);assert.equal(r.sim.players.size,0);
});
test('movement ignores position/hp/damage fields and is capped per server tick',()=>{
  const s=new Simulation();const p=s.add('p','Tester','cidadao-comum');s.resetRun();const start={...p},maxHp=p.hp;
  assert.equal(s.input('p',{seq:1,x:Infinity,y:0,attack:false}),false);
  assert.equal(s.input('p',{seq:1,x:1000,y:1000,attack:false}),false);
  assert.equal(s.input('p',{seq:1,x:0,y:0,attack:false,target:{id:'forged'}}),false);
  for(let seq=1;seq<=30;seq++)s.input('p',{seq,x:1,y:1,attack:false,hp:99999,position:{x:50,y:50},damage:100000});
  s.step();assert.ok(Math.hypot(p.x-start.x,p.y-start.y)<=WALK*STEP+.000001);assert.ok(Math.hypot(p.x-start.x,p.y-start.y)>0);
  // A burst far ahead of the room is not queued for later (input-10hz): the room skips to the latest steps, still one per tick.
  assert.equal(p.hp,maxHp);assert.ok(p.ack>=1&&p.ack<=30);
  assert.equal(s.input('p',{seq:1,x:1,y:0,attack:false}),false);
  for(let i=0;i<400;i++){s.input('p',{seq:Math.max(p.ack+1,i+31),x:1,y:1,attack:false});s.step();assert.ok(walkable(p));}
});
test('prediction replay produces same state after delayed acknowledgement',()=>{
  const s=new Simulation();const p=s.add('p','Tester','cidadao-comum');s.resetRun();
  const inputs:Input[]=Array.from({length:12},(_,i)=>({seq:i+1,x:i<6?1:0,y:i<6?0:1,attack:false}));
  const predicted=inputs.reduce((p,i)=>simulate(p,i),{x:p.x,y:p.y});
  for(const i of inputs.slice(0,5)){s.input('p',i);s.step();}
  const replay=reconcile(p,inputs.filter(i=>i.seq>p.ack));assert.deepEqual(replay,predicted);
});
test('every kill rewards each active player once and never spectators',()=>{
  const s=new Simulation(),p=s.add('p','Tester','cidadao-comum'),q=s.add('q','Ally','mendigo'),watcher=s.add('w','Watcher','cidadao-comum');
  watcher.spectator=true;s.resetRun();
  const enemy=createEnemy(s.world,'bebado',{x:p.x+8,y:p.y});
  assert.equal(s.world.damageEnemy(enemy.id,1e6,p.id),true);s.step();
  assert.equal(p.score,10);assert.equal(q.score,10);assert.equal(watcher.score,0);
  assert.equal(s.world.damageEnemy(enemy.id,1e6,p.id),false);s.step();
  assert.equal(p.score,10);assert.equal(q.score,10);
});
test('delta can reconstruct full state and removes departed players',()=>{
  const s=new Simulation();s.add('a','A','cidadao-comum');s.add('b','B','mendigo');s.resetRun();const before=s.snapshot();s.remove('b');s.input('a',{seq:1,x:1,y:0,attack:false});s.step();const after=s.snapshot(),patch=delta(before,after);
  const players=new Map(before.players.map(p=>[p[0],p]));for(const p of patch.players)players.set(p[0],p);for(const id of patch.removed)players.delete(id);
  assert.deepEqual([...players.values()],after.players);assert.ok(JSON.stringify(patch).length<JSON.stringify(after).length+100);
});
test('message flooding and oversized payloads close connection',()=>{
  const r=new Room(1000),a=peer();join(r,a);for(let i=0;i<50;i++)r.receive(a,'{"t":"ping","at":1}',1000);assert.equal(a.closes[0].code,4008);
  const b=peer();join(r,b,'B',1000);r.receive(b,'a'.repeat(1025),1000);assert.equal(b.closes[0].code,1009);
});


test('older clients are rejected before joining a procedural room',()=>{
  const room=new Room(1000,42);
  // Protocol 3 is the JSON room before VGM-042b, 4 the frames without event sizes (before E7) and 5 the frames without
  // Stonewards (before VGM-046B), 6 the frames without the zueira events (before VGM-053B), 7 the frames without the
  // city world (before D-034), 8 the frames without the slow/slip state and telegraph kinds (before D-036), 9 the frames
  // without the P1 cast in the DICT (before NEW-20261012-ORQ-elenco-p1), 10 the frames without the tower defenses in the
  // structures (before torres-fio), 11 the frames without the D-040 roster in the DICT (before
  // NEW-20261013-ORQ-papeis-de-inimigo), 13 the frames without the volley counter, 14 the frames without the chaveiro
  // objective (before D-047) and 16 a newer page: a tab left open across the release gets a readable refusal,
  // no frames.
  // Every older version from 3 (and 1) and the next one (the number is the integration queue's, tools/fila.mjs).
  for(const version of [1,...Array.from({length:PROTOCOL_VERSION-3},(_,i)=>i+3),PROTOCOL_VERSION+1]){
    const old=peer();room.connect(old,1000);
    room.receive(old,JSON.stringify({t:'join',protocol:version,name:'Old',classId:'cidadao-comum'}),1000);
    assert.equal(room.sim.players.size,0);assert.equal(old.closes[0].code,4003);
    assert.deepEqual(old.messages,[{t:'error',message:VERSION_REFUSED}]);assert.match(old.messages[0].message,/Atualiza a página pra entrar/);
    assert.equal(old.frames.length,0,'never a binary frame');
  }
  assert.equal(ROOM_PROTOCOL,PROTOCOL_VERSION,'the handshake and the frame byte agree');
});

const command=(room:Room,p:Peer,message:object,now=1100)=>room.receive(p,JSON.stringify(message),now);
const idOf=(p:ReturnType<typeof peer>)=>p.messages.find(m=>m.t==='welcome').id as string;
const results=(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='result');
function startRun(room:Room,peers:ReturnType<typeof peer>[]){
  for(const p of peers)command(room,p,{t:'ready',round:room.run.snapshot().round,ready:true});
  for(let i=0;i<60;i++)room.advance(1200+i*50);
  assert.equal(room.run.snapshot().phase,'combat');
}
/** Knocks every active player down through the simulation, as enemy hits would. */
function downAll(room:Room){
  for(const p of room.sim.players.values())if(!p.spectator){p.invulnerableUntil=0;room.sim.world.damagePlayer(p.id,1e6,'test');}
}
test('room gates input by phase and round; duplicate rematch resets only once',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');
  const p=room.sim.players.get(idOf(a))!,original={x:p.x,y:p.y};
  command(room,a,{t:'input',round:1,seq:1,x:1,y:0,attack:true});room.advance(1150);
  assert.equal(room.sim.tick,0);assert.deepEqual({x:p.x,y:p.y},original);
  startRun(room,[a,b]);const spawn={x:p.x,y:p.y};
  command(room,a,{t:'input',round:999,seq:1,x:1,y:0,attack:true},4300);room.advance(4350);assert.equal(p.ack,0);
  command(room,a,{t:'input',round:1,seq:1,x:1,y:0,attack:true},4400);room.advance(4450);assert.equal(p.ack,1);
  assert.notDeepEqual({x:p.x,y:p.y},spawn);
  p.score=30;downAll(room);room.advance(4500);
  const result=room.run.snapshot();assert.equal(result.outcome,'defeat');assert.ok(result.resultId);
  room.advance(4550);assert.equal(room.run.snapshot().resultId,result.resultId);
  command(room,b,{t:'rematch',round:1},4600);command(room,b,{t:'rematch',round:1},4600);
  assert.equal(room.run.snapshot().round,2);assert.equal(room.run.snapshot().phase,'lobby');
  assert.equal(p.score,0);assert.equal(p.hp,p.stats.maxHp);assert.equal(p.ack,0);assert.equal(room.sim.tick,0);
  assert.equal(p.downed,undefined);assert.equal(room.sim.outcome,undefined);
  assert.equal(room.sim.world.enemies.size,0);assert.equal(p.attackTick,0);
  command(room,a,{t:'ready',round:1,ready:true},4700);assert.ok(room.run.snapshot().members.every(m=>!m.ready));
});
test('late arrival is spectator; original member reconnects without restarting combat',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const token=a.messages.find(m=>m.t==='welcome').token;
  room.disconnect(a,4300);room.advance(4350);assert.equal(room.run.snapshot().phase,'combat');
  const late=peer();join(room,late,'Late',4400);const spectator=room.sim.players.get(idOf(late))!;
  assert.equal(spectator.spectator,true);const pos={x:spectator.x,y:spectator.y};
  command(room,late,{t:'input',round:1,seq:1,x:1,y:0,attack:true},4450);room.advance(4500);
  assert.deepEqual({x:spectator.x,y:spectator.y},pos);assert.equal(spectator.ack,0);
  const elapsed=room.run.snapshot().elapsed,back=peer();room.connect(back,4550);
  command(room,back,{t:'join',protocol:ROOM_PROTOCOL,token},4550);
  assert.equal(idOf(back),idOf(a));assert.equal(room.sim.players.get(idOf(a))!.spectator,false);
  assert.equal(room.run.snapshot().elapsed,elapsed);assert.equal(room.sim.players.size,3);
  // Spectators cannot keep an otherwise defeated team alive.
  downAll(room);room.advance(4600);
  assert.equal(room.sim.outcome,'defeat');assert.equal(room.run.snapshot().outcome,'defeat');assert.equal(spectator.score,0);
});
test('disconnect cancels countdown and explicitly leaving the room needs no host',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');
  command(room,a,{t:'ready',round:1,ready:true});command(room,b,{t:'ready',round:1,ready:true});
  room.advance(1200);room.disconnect(a,1250);assert.equal(room.run.snapshot().phase,'lobby');
  // Expired participant frees its slot; the remaining ready player can start.
  command(room,b,{t:'ping'},1250+GRACE_MS+750);room.advance(1250+GRACE_MS+750);
  assert.equal(room.run.snapshot().phase,'countdown');assert.equal(room.sim.players.size,1);
});
test('boss kill sends one result message to every player and stays stable',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  room.advance(4200);assert.equal(results(a).length,0);
  const p=room.sim.players.get(idOf(a))!,boss=createEnemy(room.sim.world,'chefe',{x:p.x+12,y:p.y});
  // Outcomes count only inside a simulation tick, so the kill happens within the next world step.
  const world=room.sim.world,step=world.step.bind(world);
  world.step=()=>{world.damageEnemy(boss.id,1e6,p.id);return step();};
  for(let i=0;i<10;i++)room.advance(4250+i*50);
  const state=room.run.snapshot();assert.equal(state.phase,'result');assert.equal(state.outcome,'victory');
  for(const viewer of [a,b]){
    assert.deepEqual(results(viewer),[{t:'result',outcome:'victory',resultId:state.resultId,round:1}]);
    // The run state announcing the result reaches the client before the result message.
    const at=viewer.messages.findIndex(m=>m.t==='result'),before=viewer.messages.slice(0,at).filter(m=>m.t==='run').at(-1);
    assert.equal(before?.run?.phase,'result');assert.equal(before?.run?.outcome,'victory');
  }
});
test('victory or defeat on the last tick beats the timeout; otherwise the timeout is announced once',()=>{
  const duration=8;
  const race=new Room(1000,undefined,{durationTicks:duration}),a=peer();join(race,a);startRun(race,[a]);
  for(let i=0;i<duration-1;i++)race.advance(4200+i*50);
  assert.equal(race.run.snapshot().phase,'combat');assert.equal(race.run.snapshot().remaining,1);
  downAll(race);race.advance(5000);
  assert.equal(race.run.snapshot().outcome,'defeat');assert.deepEqual(results(a).map(m=>m.outcome),['defeat']);
  const idle=new Room(1000,undefined,{durationTicks:duration}),b=peer();join(idle,b);startRun(idle,[b]);
  for(let i=0;i<duration+5;i++)idle.advance(4200+i*50);
  assert.equal(idle.run.snapshot().outcome,'timeout');assert.deepEqual(results(b).map(m=>m.outcome),['timeout']);
});

/** Starts a two-player run and queues two level offers for each player through the run's progression. */
function offerRoom(){
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const progression=room.sim.run.progression;
  progression.grantLevelOffers(room.sim.world,2);progression.grantLevelOffers(room.sim.world,3);
  let calls=0;const choose=room.sim.choose.bind(room.sim);
  room.sim.choose=(id,offer,index)=>{calls++;return choose(id,offer,index);};
  room.advance(4200);room.advance(4250);
  return {room,a,b,calls:()=>calls,offers:(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='offers')};
}
test('pending offers are pushed once per change on broadcast ticks',()=>{
  const {room,a,b,offers}=offerRoom(),id=idOf(a);
  assert.equal(offers(a).length,1);assert.equal(offers(b).length,1);
  assert.deepEqual(offers(a)[0].offers.map((o:any)=>o.id),[`lvl-2-${id}`,`lvl-3-${id}`]);
  assert.ok(offers(a)[0].offers.every((o:any)=>o.playerId===id));
  for(let i=0;i<6;i++)room.advance(4300+i*50);
  assert.equal(offers(a).length,1);
});
test('choose applies only the oldest real offer once; forged, repeated and out-of-order picks are refused',()=>{
  const {room,a,b,calls,offers}=offerRoom(),id=idOf(a),p=room.sim.players.get(id)!;
  const build=()=>JSON.stringify(p.build),initial=build();
  // Another player's offer, a later offer and an unknown level reach the simulation and are refused there.
  for(const offer of [`lvl-2-${idOf(b)}`,`lvl-3-${id}`,`lvl-9-${id}`]){
    command(room,a,{t:'choose',round:1,offer,index:0},4300);
    assert.equal(offers(a).at(-1).offers.length,2);assert.equal(build(),initial);
  }
  assert.equal(calls(),3);
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0},4300);
  assert.equal(calls(),4);assert.deepEqual(offers(a).at(-1).offers.map((o:any)=>o.id),[`lvl-3-${id}`]);
  assert.notEqual(build(),initial);const afterPick=build();
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0},4300);
  assert.equal(calls(),5);assert.equal(offers(a).at(-1).offers.length,1);assert.equal(build(),afterPick);
  assert.equal(room.sim.offers(idOf(b)).length,2);
});
test('choose drops malformed ids, bad indexes and stale rounds before the simulation',()=>{
  const {room,a,calls}=offerRoom(),id=idOf(a),head=`lvl-2-${id}`;
  const bad:object[]=[
    {t:'choose',round:2,offer:head,index:0},{t:'choose',offer:head,index:0},
    {t:'choose',round:1,offer:head,index:4},{t:'choose',round:1,offer:head,index:-1},{t:'choose',round:1,offer:head,index:1.5},{t:'choose',round:1,offer:head,index:'0'},
    {t:'choose',round:1,offer:'boss-1',index:0},{t:'choose',round:1,offer:`lvl-2-${'x'.repeat(41)}`,index:0},{t:'choose',round:1,offer:`lvl-2-${id}~`,index:0},
    {t:'choose',round:1,offer:{id:head},index:0},{t:'choose',round:1,offer:`lvl-2-${id}\n`,index:0},
  ];
  for(const message of bad)command(room,a,message,4300);
  assert.equal(calls(),0);assert.equal(room.sim.offers(id).length,2);
});
test('choose outside combat is refused (lobby and result)',()=>{
  const room=new Room(1000),a=peer();join(room,a);const id=idOf(a);
  let calls=0;const choose=room.sim.choose.bind(room.sim);room.sim.choose=(pid,offer,index)=>{calls++;return choose(pid,offer,index);};
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0});assert.equal(calls,0);
  startRun(room,[a]);room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  downAll(room);room.advance(4200);assert.equal(room.run.snapshot().phase,'result');
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0},4300);assert.equal(calls,0);
});
/** baseSeq of a frame header (magic, version, uvar seq, uvar baseSeq): 0 means a full frame. */
function baseOf(frame:Uint8Array){
  let pos=2;const uvar=()=>{let v=0,mul=1;for(;;){const b=frame[pos++];v+=(b&127)*mul;if(b<128)return v;mul*=128;}};
  uvar();return uvar();
}
/** A protocol 4 client for one test peer: decodes its frames in order and acks each, as client.ts does. */
function client(room:Room,p:ReturnType<typeof peer>){
  const feed=new FrameRunFeed();let read=0;const decoded:{seq:number;base:number;bytes:number;tick:number}[]=[];
  // Like client.ts, one ack for whatever arrived since the last one (acks coalesce, they never burst).
  const pump=(now=1100,ack=true)=>{
    let last=0;
    for(;read<p.frames.length;read++){
      const frame=p.frames[read],r=feed.decode(frame);assert.ok(r.ok,r.ok?'':r.error);
      decoded.push({seq:r.seq,base:baseOf(frame),bytes:frame.length,tick:r.view.tick});last=r.seq;
    }
    if(ack&&last)command(room,p,{t:'ack',seq:last},now);
  };
  return {feed,pump,decoded};
}
test('protocol 4: full frame on join, deltas against the acked frame, 10 Hz per client in two staggered slots',()=>{
  const room=new Room(1000),peers=Array.from({length:6},()=>peer());peers.forEach((p,i)=>join(room,p,`Amigo ${i}`));
  const clients=peers.map(p=>client(room,p));
  for(const p of peers){assert.equal(p.log[0].t,'welcome');assert.ok(p.log[1] instanceof Uint8Array,'the full frame follows the welcome');}
  for(const c of clients)c.pump();
  assert.ok(clients.every(c=>c.decoded[0].base===0),'first frame is full');
  const slots=[...room.connections.values()].map(c=>c.encoder!.slot).sort();
  assert.deepEqual(slots,[0,0,0,1,1,1],'three clients per slot');
  startRun(room,peers);for(const c of clients)c.pump(4150);
  const before=clients.map(c=>c.decoded.length),perTick:number[]=[];
  for(let i=0;i<40;i++){
    const sent=peers.reduce((n,p)=>n+p.frames.length,0);
    command(room,peers[0],{t:'ping',at:0},4200+i*50);room.advance(4200+i*50);
    perTick.push(peers.reduce((n,p)=>n+p.frames.length,0)-sent);
    for(const c of clients)c.pump(4200+i*50);
  }
  assert.ok(perTick.every(n=>n===3),`3 encodes per tick, got ${perTick}`);
  clients.forEach((c,i)=>assert.equal(c.decoded.length-before[i],20,'10 Hz over 2 s'));
  const later=clients[0].decoded.slice(-10);
  assert.ok(later.every(d=>d.base!==0),'acked client gets deltas');
  // Every client knows all six players, their names, classes and positions.
  for(const c of clients){
    assert.equal(c.feed.players.size,6);
    for(const [id,p] of room.sim.players){const mine=c.feed.players.get(id)!;assert.equal(mine.name,p.name);assert.ok(Math.abs(mine.x!-p.x)<.01&&Math.abs(mine.y!-p.y)<.01);}
  }
});
test('protocol 4: room frames are chained on the previous one (N27): no acks, still deltas; resync gives a full frame, no run JSON per tick',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const ca=client(room,a);ca.pump(4150);
  const runMessages=a.messages.filter(m=>m.t==='run').length;
  let t=4200;const tick=(ack:boolean)=>{if((t/50)%20===0)command(room,a,{t:'ping',at:0},t);room.advance(t);ca.pump(t,ack);t+=50;};
  for(let i=0;i<20;i++)tick(false);
  assert.ok(ca.decoded.slice(-10).every(d=>d.base===d.seq-1),'every delta is against the frame sent just before');
  // Before N27 the acked frame aged out of the 64-frame history here and every frame went full.
  for(let i=0;i<140;i++)tick(false);
  assert.ok(ca.decoded.slice(-5).every(d=>d.base===d.seq-1),'no acks for 8 s: still deltas');
  assert.equal(a.messages.filter(m=>m.t==='run').length,runMessages,'combat ticks do not resend the run state');
  for(let i=0;i<6;i++)tick(true);
  assert.ok(ca.decoded.at(-1)!.base!==0,'acks change nothing for the frames');
  command(room,a,{t:'resync'},t);
  for(let i=0;i<3;i++)tick(true);
  assert.ok(ca.decoded.slice(-2).some(d=>d.base===0),'resync answered with a full frame');
});
test('protocol 4: tap targets travel as client ids and reach the simulation as server ids',()=>{
  const room=new Room(1000),a=peer();join(room,a);startRun(room,[a]);
  const ca=client(room,a),p=room.sim.players.get(idOf(a))!;
  const enemy=createEnemy(room.sim.world,'bebado',{x:p.x+3,y:p.y});
  for(let i=0;i<3;i++){room.advance(4200+i*50);ca.pump(4200+i*50);}
  const label=[...ca.feed.enemies.keys()].find(id=>room.ids.resolve(id)===enemy.id)!;
  assert.match(label,/^e\d+$/);assert.notEqual(label,enemy.id);
  command(room,a,{t:'input',round:1,seq:1,x:0,y:0,attack:false,target:label,ack:ca.decoded.at(-1)!.seq},4400);room.advance(4400);
  assert.equal(p.target,enemy.id);
  command(room,a,{t:'input',round:1,seq:2,x:0,y:0,attack:false,target:'e999999'},4450);room.advance(4450);
  assert.equal(p.ack,2,'an unknown target only drops the target');assert.equal(p.target,undefined);
});

test('a run with no participant left ends in defeat right away (review 1)',()=>{
  const room=new Room(1000),a=peer();join(room,a);startRun(room,[a]);
  const token=a.messages.find(m=>m.t==='welcome').token;
  room.advance(4200);room.disconnect(a,4250);
  // The session grace (GRACE_MS) runs out: the member leaves the run.
  room.advance(4250+GRACE_MS+1000);
  assert.equal(room.run.snapshot().phase,'result');assert.equal(room.run.snapshot().outcome,'defeat');
  assert.deepEqual(results(a),[],'the departed peer gets nothing');
  // Coming back afterwards is a fresh join into the result screen, not a stuck combat.
  const after=4250+GRACE_MS+6000;
  const b=peer();room.connect(b,after);command(room,b,{t:'join',protocol:ROOM_PROTOCOL,token},after);
  const c=peer();join(room,c,'Atrasado',after);
  room.advance(after+50);assert.equal(room.run.snapshot().phase,'result');
  assert.equal(room.run.snapshot().outcome,'defeat');
});

test('a late spectator alone does not keep an empty combat alive (review 1)',()=>{
  const room=new Room(1000),a=peer(),late=peer();join(room,a);startRun(room,[a]);
  join(room,late,'Atrasado',4200);assert.equal(room.sim.players.get(idOf(late))!.spectator,true);
  command(room,a,{t:'leave'},4250);room.advance(4300);
  assert.equal(room.run.snapshot().outcome,'defeat');assert.deepEqual(results(late).map(m=>m.outcome),['defeat']);
});

test('no new run starts without time for a whole run; a run near the room end is closed as a timeout (review 2)',()=>{
  const created=1000,lateAt=created+ROOM_LIFETIME_MS-RUN_START_WINDOW_MS+1;
  const room=new Room(created),a=peer(),b=peer();join(room,a);join(room,b,'B');
  command(room,a,{t:'ready',round:1,ready:true},lateAt);
  assert.ok(room.run.snapshot().members.every(m=>!m.ready),'ready refused');
  assert.deepEqual(a.messages.filter(m=>m.t==='notice').map(m=>m.message),[ROOM_CLOSING_NOTICE]);
  assert.equal(a.closes.length,0,'a notice never closes the connection');
  command(room,a,{t:'ready',round:1,ready:false},lateAt);assert.equal(a.messages.filter(m=>m.t==='notice').length,1,'un-ready is always fine');
  // Inside the window everything works, and a run still going near the end gets a result before the 4004.
  const ok=new Room(created),c=peer();join(ok,c);startRun(ok,[c]);
  // Pings keep the peer fresh across the jump in time (a stale peer would be dropped and the run lost instead).
  const at=(t:number)=>{command(ok,c,{t:'ping',at:t},t);ok.advance(t);};
  at(created+ROOM_LIFETIME_MS-60_000);assert.equal(ok.run.snapshot().phase,'combat');
  at(created+ROOM_LIFETIME_MS-29_000);
  assert.equal(ok.run.snapshot().outcome,'timeout');assert.deepEqual(results(c).map(m=>m.outcome),['timeout']);
  command(ok,c,{t:'rematch',round:1},created+ROOM_LIFETIME_MS-28_000);
  assert.equal(ok.run.snapshot().phase,'result','rematch refused too');
  assert.equal(c.messages.filter(m=>m.t==='notice').length,1);
});

test('each event reaches the client exactly once, with rounded numbers (review 3)',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const sent:number[]=[],world=room.sim.world,step=world.step.bind(world);
  world.step=()=>{const events=step();sent.push(...events.map(e=>e.eventId));return events;};
  const p=room.sim.players.get(idOf(a))!;
  for(let i=0;i<10;i++)createEnemy(world,'bebado',{x:p.x+.6+i*.1,y:p.y+.4},1);
  const ca=client(room,a);ca.pump();ca.feed.take();
  const received:any[]=[];
  for(let i=0;i<400;i++){if(i%40===0)command(room,a,{t:'ping',at:0},4200+i*50);room.advance(4200+i*50);ca.pump(4200+i*50);if(i%7===0)received.push(...ca.feed.take().events);}
  received.push(...ca.feed.take().events);
  const ids=received.map((e:any)=>e.eventId);
  assert.ok(sent.length>20,`events happened (${sent.length})`);
  assert.equal(new Set(ids).size,ids.length,'no duplicate');
  const last=Math.max(...ids),expected=sent.filter(id=>id<=last);
  assert.deepEqual(ids,expected,'none lost, in order');
  // Protocol 4 quantizes on the wire (positions 1/512, velocities 1/256, counts as integers).
for(const e of received)for(const v of Object.values(e))if(typeof v==='number')assert.equal(v,Math.round(v*512)/512);
});

test('reconnect drops stale inputs and accepts the client sequence restarting at ack (review 4)',()=>{
  const room=new Room(1000),a=peer();join(room,a);startRun(room,[a]);
  const id=idOf(a),token=a.messages.find(m=>m.t==='welcome').token,p=room.sim.players.get(id)!;
  for(let seq=1;seq<=8;seq++)command(room,a,{t:'input',round:1,seq,x:1,y:0,attack:false},4200);
  room.advance(4250);const ack=p.ack;assert.equal(ack,1);
  room.disconnect(a,4300);
  const again=peer();room.connect(again,4400);command(room,again,{t:'join',protocol:ROOM_PROTOCOL,token},4400);
  const welcome=again.messages.find(m=>m.t==='welcome');assert.equal(welcome.id,id);
  const at={x:p.x,y:p.y};
  room.advance(4450);assert.deepEqual({x:p.x,y:p.y},at,'no stale input replayed after reconnect');assert.equal(p.ack,ack);
  // The client restarts at its last ack (client.ts: seq = ack from welcome).
  command(room,again,{t:'input',round:1,seq:ack+1,x:0,y:1,attack:false},4460);
  room.advance(4500);assert.equal(p.ack,ack+1,'restarted sequence accepted');assert.notDeepEqual({x:p.x,y:p.y},at);
});

test('the client accepts only the room\'s exact terrain from the welcome descriptor',async()=>{
  const {worldDescriptor}=await import('../../multiplayer/simulation.ts');const {terrainFor}=await import('../../src/client/net/terrain.ts');
  const room=new Room(1000,4242),a=peer();join(room,a);
  const welcome=a.messages.find(m=>m.t==='welcome');
  assert.equal(welcome.protocol,ROOM_PROTOCOL);assert.deepEqual(welcome.world,worldDescriptor(room.sim.terrain));
  const terrain=terrainFor(welcome.world);assert.ok(typeof terrain!=='string');assert.equal(terrain.signature,room.sim.terrain.signature);
  assert.match(String(terrainFor({...welcome.world,signature:'x'})),/Atualiza a página/);
  assert.match(String(terrainFor({...welcome.world,terrainVersion:999})),/Atualiza a página/);
  assert.match(String(terrainFor(undefined)),/Atualiza a página/);
});
test('"Me salva" (UX-resgate-e-ping): only a caído pings, the room relays its own position once to everyone, 3 s anti-spam',()=>{
  const room=new Room(1000),peers=[peer(),peer(),peer()];peers.forEach((p,i)=>join(room,p,`P${i}`));
  const sos=(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='sos');
  const id=idOf(peers[0]);
  command(room,peers[0],{t:'sos',round:1},1150);assert.equal(sos(peers[1]).length,0,'no ping in the lobby');
  startRun(room,peers);
  const me=room.sim.players.get(id)!;
  command(room,peers[0],{t:'sos',round:1},5000);assert.equal(sos(peers[1]).length,0,'standing players do not ping');
  me.invulnerableUntil=0;room.sim.world.damagePlayer(id,1e6,'test');assert.ok(me.downed);
  command(room,peers[0],{t:'sos',round:999,x:99,y:99},5000);assert.equal(sos(peers[1]).length,0,'stale round dropped');
  command(room,peers[0],{t:'sos',round:1,x:99,y:99},5000);
  for(const p of peers){const got=sos(p);assert.equal(got.length,1,'once on every client, the sender included');
    assert.equal(got[0].id,id);assert.equal(got[0].x,Math.round(me.x*100)/100);assert.equal(got[0].y,Math.round(me.y*100)/100);assert.ok(Number.isSafeInteger(got[0].tick));}
  command(room,peers[0],{t:'sos',round:1},6000);command(room,peers[0],{t:'sos',round:1},5000+SOS_COOLDOWN_MS-SOS_SLACK_MS-1);
  assert.equal(sos(peers[2]).length,1,'anti-spam: a flood inside the window is dropped');
  // Two honest taps 3 s apart on the phone may land 2.75 s apart in the room (jitter): the second one goes through.
  command(room,peers[0],{t:'sos',round:1},7750);assert.equal(sos(peers[2]).length,2,'the second honest tap is not lost');
  command(room,peers[0],{t:'sos',round:1},8000);assert.equal(sos(peers[2]).length,2,'and the window starts again from it');
  // Another player's fall has its own clock; a non-caído never relays.
  command(room,peers[1],{t:'sos',round:1},8001);assert.equal(sos(peers[2]).length,2);
});
test('lab commands (down, move) only work in a lab room and only in combat',()=>{
  const prod=new Room(1000),a=peer();join(prod,a);startRun(prod,[a]);
  const p=prod.sim.players.get(idOf(a))!,at={x:p.x,y:p.y};
  command(prod,a,{t:'lab',down:true,to:{x:p.x+1,y:p.y}},4000);assert.equal(p.downed,undefined);assert.deepEqual({x:p.x,y:p.y},at);
  const lab=new Room(1000,undefined,{lab:true}),b=peer();join(lab,b);
  command(lab,b,{t:'lab',down:true},1150);assert.equal(lab.sim.players.get(idOf(b))!.downed,undefined,'not in the lobby');
  startRun(lab,[b]);const q=lab.sim.players.get(idOf(b))!,start={x:q.x,y:q.y};
  command(lab,b,{t:'lab',to:{x:start.x+.5,y:start.y}},4000);assert.ok(Math.abs(q.x-(start.x+.5))<1e-9);
  command(lab,b,{t:'lab',to:{x:1e6,y:0}},4000);assert.ok(q.x<100,'never into the void');
  command(lab,b,{t:'lab',down:true},4000);assert.ok(q.downed);
});

test('VGM-046B: forge taps through the room respect the balance, the camp and a resent request; frames carry the camp',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');
  startRun(room,[a,b]);
  const sw=room.sim.run.stonewards.state,round=room.run.snapshot().round;
  assert.equal(room.sim.world.round.phase,'prepare','the opening countdown is an intermission too');
  sw.balance={coco:3,pedra:4};sw.wall.hp=100;
  const forged=(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='forged');
  // Two taps in the same tick, money for one repair: the first one wins, the second hears why.
  command(room,a,{t:'forge',round,recipe:'reparo',req:1});command(room,b,{t:'forge',round,recipe:'reparo',req:1});
  assert.deepEqual(forged(a).at(-1),{t:'forged',req:1,recipe:'reparo',ok:true});
  assert.deepEqual(forged(b).at(-1),{t:'forged',req:1,recipe:'reparo',ok:false,reason:'balance'});
  assert.deepEqual(sw.balance,{coco:1,pedra:1});assert.equal(sw.wall.hp,100+150);
  // The same request again (a resend after a reconnect) applies once.
  sw.balance={coco:9,pedra:9};
  command(room,a,{t:'forge',round,recipe:'reparo',req:1});
  assert.deepEqual(forged(a).at(-1),{t:'forged',req:1,recipe:'reparo',ok:false,reason:'duplicate'});
  // Forged or stale commands never reach the forge.
  const before=forged(a).length;
  for(const bad of [{recipe:'__proto__',req:2},{recipe:'reparo',req:-1},{recipe:'reparo',req:'x'},{recipe:'reparo',req:3,round:round+1}])command(room,a,{t:'forge',round,...bad});
  assert.equal(forged(a).length,before);
  // Out of the camp: refused with the reason.
  const pa=room.sim.players.get(idOf(a))!;pa.x=sw.wall.x+20;
  command(room,a,{t:'forge',round,recipe:'reparo',req:4});
  assert.equal(forged(a).at(-1).reason,'away');
  // The next frames carry the camp block and the wall.
  const c=client(room,a);room.advance(5000);room.advance(5050);c.pump();
  const view=c.feed.peek();
  assert.deepEqual(view.camp,{coco:9,pedra:9});
  assert.equal(view.structures.find(s=>s.kind==='muralha')!.hp,250);
});
test('lab move reach is measured from the lab base (base + LAB_OFFSET): 199 u accepted, 201 u refused',()=>{
  const room=new Room(1000,undefined,{lab:true,labOffset:{x:1000,y:0}}),a=peer();join(room,a);startRun(room,[a]);
  const p=room.sim.players.get(idOf(a))!,b=worldBase(room.sim.terrain),c={x:b.x+1000,y:b.y};
  assert.equal(LAB_REACH,200);
  // An angle where both spots are walkable ground (the endless world has lakes).
  let angle=0;for(let i=0;i<72;i++){const a2=i*Math.PI/36,at=(r:number)=>({x:c.x+Math.cos(a2)*r,y:c.y+Math.sin(a2)*r});if(walkable(at(199),room.sim.terrain)&&walkable(at(201),room.sim.terrain)){angle=a2;break;}}
  const at=(r:number)=>({x:c.x+Math.cos(angle)*r,y:c.y+Math.sin(angle)*r});
  command(room,a,{t:'lab',to:at(199)},4000);assert.ok(Math.hypot(p.x-at(199).x,p.y-at(199).y)<1e-9,'199 u from the lab base: accepted');
  command(room,a,{t:'lab',to:at(201)},4000);assert.ok(Math.hypot(p.x-at(199).x,p.y-at(199).y)<1e-9,'201 u: refused');
});

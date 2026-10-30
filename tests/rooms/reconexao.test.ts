// VGM-047: reconnection on phones, the old socket still open, two tabs, and a restart of the room's Durable Object.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,CHECKPOINT_FROM_ROUND,CHECKPOINT_V,type Peer,type RoomCheckpoint,type RoomRoster} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL,GRACE_MS,REPLACED_MESSAGE,restartedNotice,resumedNotice} from '../../src/protocol/room.ts';
import {sha256Hex} from '../../src/protocol/sha256.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[],closes:{code:number;reason:string}[]=[];
  return {messages,frames,closes,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:(code:number,reason:string)=>{closes.push({code,reason});}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number,token?:string)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',...(token?{token}:{})},now);};
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');
function combat(room:Room,peers:TestPeer[],from=1100){
  let t=from;for(const p of peers)say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  return t;
}

test('the old socket still open: the new connection with the token takes the character, the old one gets 4009',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const id=welcome(a).id,token=welcome(a).token,p=room.sim.players.get(id)!;
  // Phone changes network: the room still sees a's socket; the same phone comes back on a new one.
  const again=peer();join(room,again,'Ana',t+=50,token);
  assert.equal(welcome(again).id,id);assert.equal(room.sim.players.size,2);assert.equal(p.online,true);
  assert.deepEqual(a.closes.map(c=>c.code),[4009]);assert.equal(a.messages.at(-1).t,'replaced');assert.equal(a.messages.at(-1).message,REPLACED_MESSAGE);
  assert.equal(room.run.snapshot().phase,'combat');assert.ok(again.frames.length>=1,'a full frame right away');
  // The dead socket's close arrives later: the character stays online, its input still counts.
  room.disconnect(a,t+=50);assert.equal(p.online,true);
  say(room,again,{t:'input',round:1,seq:welcome(again).ack+1,steps:[[welcome(again).ack+1,1,0,0]]},t);
  for(let i=0;i<4;i++)room.advance(t+=50);
  assert.ok(p.ack>welcome(again).ack);
});

test('two real tabs with one token: each explicit join moves the character once, nothing bounces on its own',()=>{
  const room=new Room(1000),one=peer();join(room,one,'Ana',1000);
  const token=welcome(one).token;
  const two=peer();join(room,two,'Ana',1100,token);
  assert.deepEqual(one.closes.map(c=>c.code),[4009]);assert.deepEqual(two.closes,[]);
  for(let t=1150;t<3000;t+=50)room.advance(t);
  // The replaced tab does not come back by itself (the client never retries 4009): the newest one stays.
  assert.deepEqual(two.closes,[]);assert.equal(room.connections.size,1);
  // A tap on "Atualizar" in the first tab takes it back, once.
  const back=peer();join(room,back,'Ana',3000,token);
  assert.deepEqual(two.closes.map(c=>c.code),[4009]);assert.deepEqual(back.closes,[]);assert.equal(room.sim.players.size,1);
});

test('drops of 5 s and 20 s in the middle of combat: same character, offers kept (clock paused), no double counting',()=>{
  for(const seconds of [5,20]){
    const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
    let t=combat(room,[a,b]);
    const id=welcome(a).id,token=welcome(a).token,p=room.sim.players.get(id)!;
    // Every damage event of the run, to check the server counter against.
    let dealt=0;const step=room.sim.step.bind(room.sim);
    room.sim.step=(now?:number)=>{const events=step(now);for(const e of events)if(e.type==='damage'&&e.source===id&&!room.sim.players.has(e.target))dealt+=e.amount;return events;};
    room.sim.run.progression.grantLevelOffers(room.sim.world,2);
    // Ana's weapon hits a critter next to her before and while she is away.
    for(let i=0;i<4;i++)createEnemy(room.sim.world,'bebado',{x:p.x+1.2,y:p.y+(i-1.5)*.4});
    for(let i=0;i<10;i++)room.advance(t+=50);
    const offers=room.sim.offers(id).map(o=>({id:o.id,deadline:o.deadlineTick})),tickAtDrop=room.sim.tick;
    assert.equal(offers.length,1);
    // Network gone: the room hears nothing; after 12 s of silence it closes the socket itself (5 s: it does not).
    const end=t+seconds*1000;
    for(;t<end;t+=50){if(t%1000===0)say(room,b,{t:'ack',seq:0},t);room.advance(t);}
    assert.equal(p.online,seconds<12,`${seconds} s: the room ${seconds<12?'still holds':'dropped'} the silent socket`);
    const back=peer();join(room,back,'Ana',t,token);
    assert.equal(welcome(back).id,id);assert.equal(room.sim.players.size,2);assert.equal(p.online,true);
    // The offer is still there, its deadline moved by the time offline (12 s+ of a 20 s drop), never lost.
    const pushed=back.messages.find(m=>m.t==='offers');
    assert.deepEqual(pushed.offers.map((o:any)=>o.id),offers.map(o=>o.id));
    // Held offers (combat chip) keep their far deadline; clocked ones are pushed back tick by tick while she is offline.
    if(seconds>=12)assert.ok(room.sim.offers(id)[0].deadlineTick>=offers[0].deadline,'the deadline never ran while offline');
    // Server counters: the damage dealt equals the sum of her damage events, each counted once.
    for(let i=0;i<10;i++)room.advance(t+=50);
    const stats=room.sim.statsOf(id);
    assert.ok(room.sim.tick>tickAtDrop);assert.ok(dealt>0,'she hit something');
    assert.ok(Math.abs(stats.damage-dealt)<1e-6,'each hit counted once across the drop and the rejoin');
    say(room,back,{t:'choose',round:1,offer:offers[0].id,index:0},t);room.advance(t+=50);
    assert.deepEqual(back.messages.findLast(m=>m.t==='offers').offers,[]);
  }
});

test('the seat survives the mobile grace (held through the run while someone plays, 3g); the last one standing who dropped keeps the run alive meanwhile',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const ana=welcome(a),bia=room.sim.players.get(welcome(b).id)!;
  // Bia falls; Ana switches apps for 90 s. The run waits for Ana instead of a defeat after 5 s.
  bia.invulnerableUntil=0;room.sim.world.damagePlayer(bia.id,1e6,'test');
  room.disconnect(a,t);
  const away=t+90_000;
  for(;t<away;t+=50){say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  assert.equal(room.run.snapshot().phase,'combat','not lost while Ana may come back');
  const back=peer();join(room,back,'Ana',t,ana.token);assert.equal(welcome(back).id,ana.id);
  // Gone for longer than the grace while Bia is still in the room: the run waits the grace for Ana and ends (042a R1),
  // but her seat is held through the run and for GRACE_MS after it (3g-rede-sem-teleporte); then it is free.
  room.disconnect(back,t);
  for(const end=t+GRACE_MS+1000;t<end;t+=50){say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  assert.equal(room.run.snapshot().phase,'result');
  const held=peer();join(room,held,'Ana',t,ana.token);assert.equal(welcome(held).id,ana.id,'the seat outlived the grace during the run');
  room.disconnect(held,t);
  for(const end=t+GRACE_MS+1000;t<end;t+=50){say(room,b,{t:'ack',seq:0},t);room.advance(t);}
  const late=peer();join(room,late,'Ana',t,ana.token);
  assert.equal(late.closes[0].code,4003);assert.equal(late.messages[0].message,'Você ficou fora mais de 2 minutos e sua vaga foi liberada. Entra de novo pela sala.');
});

test('restart of the room before any checkpoint (round 1): the roster comes back from storage, the run is lost honestly, each player hears it once',()=>{
  const writes:RoomRoster[]=[];
  const room=new Room(1000,4242,{onRoster:r=>writes.push(structuredClone(r))}),a=peer(),b=peer();
  join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  assert.equal(writes.length,2,'one row per join');
  let t=combat(room,[a,b]);
  assert.equal(writes.at(-1)!.running,true);
  const before=writes.length,rounds=new Set<number>([room.sim.world.round.index]);
  for(let i=0;i<100;i++){room.advance(t+=50);rounds.add(room.sim.world.round.index);}
  assert.equal(writes.length-before,rounds.size-1,'combat ticks write nothing; only a new round does');
  // The object restarts (deploy, eviction): a new Room from the same storage.
  const roster=writes.at(-1)!,restarted=new Room(1000,4242,{onRoster:r=>writes.push(structuredClone(r))});
  // Storage never sees a token: only its hash. What was lost (round, level) goes with it.
  assert.ok(!JSON.stringify(writes).includes(welcome(a).token),'no plain token in storage');
  assert.equal(roster.players.find(p=>p.id===welcome(a).id)!.tokenHash,sha256Hex(welcome(a).token));
  assert.equal(roster.lost?.round,room.sim.world.round.index);assert.equal(roster.lost?.level,room.sim.world.team.level);
  assert.equal(roster.checkpoint,undefined,'round 1 is never checkpointed');
  restarted.restore(roster,t);assert.equal(restarted.resume(undefined),false);
  assert.equal(restarted.sim.players.size,2);assert.equal(restarted.run.snapshot().phase,'lobby');
  assert.ok([...restarted.sim.players.values()].every(p=>!p.online));
  const back=peer();join(restarted,back,'Ana',t+100,welcome(a).token);
  assert.equal(welcome(back).id,welcome(a).id);assert.equal(welcome(back).run.phase,'lobby');
  const news=back.messages.filter(m=>m.t==='notice');
  assert.deepEqual(news.map(m=>[m.kind,m.title,m.body]),[['restarted',restartedNotice(roster.lost).title,restartedNotice(roster.lost).body]]);
  assert.match(news[0].title,/rodada \d+ se perdeu/);assert.match(news[0].body,/Não foi ninguém da turma/);assert.doesNotMatch(news[0].message,/servidor/i);
  // Back again later (another drop): no second notice.
  restarted.disconnect(back,t+200);const again=peer();join(restarted,again,'Ana',t+300,welcome(a).token);
  assert.deepEqual(again.messages.filter(m=>m.t==='notice'),[]);
  // Bia too, and a new run starts normally; a forged token is still refused.
  const bia=peer();join(restarted,bia,'Bia',t+400,welcome(b).token);assert.equal(welcome(bia).id,welcome(b).id);
  const fake=peer();join(restarted,fake,'Eu',t+400,'not-a-token');assert.equal(fake.closes[0].code,4003);
  combat(restarted,[again,bia],t+500);
  assert.equal(restarted.sim.players.size,2);
  // Restarted outside a run: back in the lobby without any notice.
  const quiet=new Room(1000,4242);quiet.restore({...roster,running:false},t);
  const q=peer();join(quiet,q,'Ana',t+100,welcome(a).token);assert.deepEqual(q.messages.filter(m=>m.t==='notice'),[]);
});

/**
 * E5-checkpoint-por-round: Ana, Bia and two room bots play into the round-2 intermission, with the room's storage (the
 * roster rows and the checkpoints, as JSON like the Durable Object keeps them). Played once, read by the tests below.
 */
function playToRound2(){
  const writes:RoomRoster[]=[],checkpoints:RoomCheckpoint[]=[];
  const room=new Room(1000,4242,{onRoster:r=>writes.push(structuredClone(r)),onCheckpoint:c=>checkpoints.push(JSON.parse(JSON.stringify(c)))}),a=peer(),b=peer();
  join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  say(room,a,{t:'bot-add',round:1},1000);say(room,a,{t:'bot-add',round:1},1400);
  let t=combat(room,[a,b],1500);
  const w=room.sim.world;
  for(let i=0;i<20*180&&!(w.round.index===CHECKPOINT_FROM_ROUND&&w.round.phase==='prepare');i++){
    room.advance(t+=50);if(i%20===0){say(room,a,{t:'ack',seq:0},t);say(room,b,{t:'ack',seq:0},t);}
  }
  assert.equal(room.run.snapshot().phase,'combat');assert.equal(w.round.index,CHECKPOINT_FROM_ROUND);assert.equal(w.round.phase,'prepare');
  return {room,a,b,writes,checkpoints,t};
}
let round2:ReturnType<typeof playToRound2>|undefined;
const buildsOf=(room:Room)=>Object.fromEntries([...room.sim.players.values()].map(p=>[p.id,JSON.stringify(p.build)]));

test('restart of the room mid-run: everyone comes back to the start of the round that was going, same level, weapons and wall; each player hears it once',()=>{
  const f=round2??=playToRound2(),{room,a,b,writes,checkpoints}=f,w=room.sim.world;
  let t=f.t;
  assert.equal(checkpoints.length,1,'one checkpoint so far: the round-2 intermission (round 1 has none)');
  const cp=checkpoints[0],roster=writes.at(-1)!;
  assert.equal(cp.v,CHECKPOINT_V);assert.equal(cp.round,2);assert.equal(cp.tick,w.tick);
  assert.deepEqual(roster.checkpoint,{round:2,tick:cp.tick,run:cp.run.round},'the roster row of the new round links it (no extra roster row)');
  assert.ok(!JSON.stringify(cp).includes(welcome(a).token),'no plain token in the checkpoint either');
  const level=w.team.level,builds=buildsOf(room),wall=room.sim.run.stonewards.state.wall.hp,run=room.run.snapshot();
  assert.ok(level>1,'the team levelled up in round 1');
  // The object restarts (deploy, eviction): a new Room from the same storage, the checkpoint applied once the map is in.
  const rows:RoomRoster[]=[],restarted=new Room(1000,4242,{onRoster:r=>rows.push(structuredClone(r))});
  restarted.restore(roster,t);
  assert.equal(restarted.resume(cp),true);
  const s=restarted.run.snapshot(),rw=restarted.sim.world;
  assert.equal(s.phase,'combat');assert.equal(s.round,run.round);assert.equal(s.elapsed,run.elapsed);
  assert.deepEqual(s.members.map(m=>[m.id,m.spectator,!!m.bot]).sort(),run.members.map(m=>[m.id,m.spectator,!!m.bot]).sort());
  assert.equal(rw.tick,cp.tick);assert.equal(rw.round.index,2);assert.equal(rw.round.phase,'prepare');assert.equal(rw.round.phaseEndsTick,w.round.phaseEndsTick);
  assert.equal(rw.team.level,level);assert.deepEqual(buildsOf(restarted),builds);assert.equal(restarted.sim.run.stonewards.state.wall.hp,wall);
  assert.equal(rw.enemies.size,0,'the round-1 stragglers are not part of it');
  assert.ok([...restarted.sim.players.values()].every(p=>p.online===restarted.sim.bots.has(p.id)),'people come back offline (their hero on autopilot), bots online');
  // Ana is back: in combat, told once what happened.
  const back=peer();join(restarted,back,'Ana',t+=100,welcome(a).token);
  assert.equal(welcome(back).id,welcome(a).id);assert.equal(welcome(back).run.phase,'combat');assert.equal(welcome(back).tick,cp.tick);
  const news=back.messages.filter(m=>m.t==='notice');
  assert.deepEqual(news.map(m=>[m.kind,m.title,m.body]),[['resumed',resumedNotice(2).title,resumedNotice(2).body]]);
  assert.match(news[0].title,/recomeçando a rodada 2/);assert.doesNotMatch(news[0].message,/se perdeu/);
  assert.equal(rows.at(-1)?.running,true);assert.deepEqual(rows.at(-1)?.checkpoint,{round:2,tick:cp.tick,run:cp.run.round},'the roster says running again, same link');
  restarted.disconnect(back,t+=50);const again=peer();join(restarted,again,'Ana',t+=50,welcome(a).token);
  assert.deepEqual(again.messages.filter(m=>m.t==='notice'),[],'said once');
  const bia=peer();join(restarted,bia,'Bia',t+=50,welcome(b).token);assert.equal(bia.messages.filter(m=>m.t==='notice')[0]?.kind,'resumed');
  // The run goes on from there: the round-2 wave starts, nobody is sent back to the lobby.
  for(let i=0;i<20*120&&rw.round.phase==='prepare';i++){restarted.advance(t+=50);if(i%20===0){say(restarted,again,{t:'ack',seq:0},t);say(restarted,bia,{t:'ack',seq:0},t);}}
  assert.equal(rw.round.index,2);assert.equal(rw.round.phase,'wave');assert.equal(restarted.run.snapshot().phase,'combat');
});

test('restart with a checkpoint that does not fit (none, another version, map or shape, an older or unlinked row, a broken sim part): lobby and the restarted notice, as before',()=>{
  const f=round2??=playToRound2(),cp=f.checkpoints[0],roster=f.writes.at(-1)!;
  const variants:[string,RoomRoster,unknown][]=[
    ['missing',roster,undefined],
    ['version',roster,{...cp,v:CHECKPOINT_V+1}],
    ['map',roster,{...cp,map:{id:'cidade-nevada',version:1,hash:'0'.repeat(64)}}],
    ['stale',{...roster,checkpoint:{round:2,tick:cp.tick-1}},cp],
    ['no-link',{...roster,checkpoint:undefined},cp],
    // Written by a build whose run state had another shape (shape fingerprint), or a sim part that does not check out.
    ['shape',roster,{...cp,sim:{...cp.sim,shape:'0badc0de'}}],
    ['sim',roster,{...cp,sim:{...cp.sim,runs:cp.sim.runs+1}}],
  ];
  for(const [why,row,value] of variants){
    const logs:any[]=[],restarted=new Room(1000,4242,{log:line=>logs.push(JSON.parse(line))});
    restarted.restore(row,f.t);
    assert.equal(restarted.resume(value),false,why);assert.equal(restarted.run.snapshot().phase,'lobby',why);
    assert.deepEqual(logs.filter(l=>l.ev==='checkpoint').map(l=>l.fallback),[why]);
    const back=peer();join(restarted,back,'Ana',f.t+100,welcome(f.a).token);
    assert.equal(welcome(back).run.phase,'lobby',why);
    assert.deepEqual(back.messages.filter(m=>m.t==='notice').map(m=>[m.kind,m.title]),[['restarted',restartedNotice(roster.lost).title]],why);
  }
});

test('roster rows per run stay small (free plan: 100k rows written per day)',()=>{
  let rows=0;
  const room=new Room(1000,undefined,{onRoster:()=>{rows++;}});
  const peers=Array.from({length:6},()=>peer());peers.forEach((p,i)=>join(room,p,`P${i}`,1000));
  let t=combat(room,peers);
  for(const p of room.sim.players.values()){p.invulnerableUntil=0;room.sim.world.damagePlayer(p.id,1e6,'test');}
  for(let i=0;i<20*35&&room.run.snapshot().phase==='combat';i++)room.advance(t+=50);
  assert.equal(room.run.snapshot().phase,'result');
  say(room,peers[0],{t:'rematch',round:1},t);room.advance(t+=50);
  for(const p of peers)say(room,p,{t:'leave'},t);
  // 6 joins + combat start + result + 6 leaves; the rematch's lobby has the same roster as the result.
  assert.ok(rows<=14,`${rows} rows`);
});

test('a restored roster ignores junk and never seats more than six',()=>{
  const room=new Room(1000);
  room.restore({v:2,running:true,players:[
    ...Array.from({length:8},(_,i)=>({id:`p${i}`,name:`P${i}`,classId:'cidadao-comum',tokenHash:sha256Hex(`t${i}`),until:null})),
  ]},1000);
  assert.equal(room.sim.players.size,6);
  const other=new Room(1000);
  other.restore({v:2} as unknown as RoomRoster,1000);other.restore({v:1,running:true,players:[]} as unknown as RoomRoster,1000);
  other.restore({v:2,running:true,players:[{id:'x',name:'X',classId:'nada',tokenHash:sha256Hex('t'),until:null},{id:'y',name:'Y',classId:'cidadao-comum',tokenHash:'plain-token',until:null}]},1000);
  assert.equal(other.sim.players.size,0);
});

test('restore keeps the seat expiry a player already had, and the restored seat accepts only the right token',()=>{
  const room=new Room(1000);
  room.restore({v:2,running:false,players:[
    {id:'away',name:'Away',classId:'cidadao-comum',tokenHash:sha256Hex('tok-away'),until:5000},
    {id:'gone',name:'Gone',classId:'cidadao-comum',tokenHash:sha256Hex('tok-gone'),until:500},
    {id:'here',name:'Here',classId:'cidadao-comum',tokenHash:sha256Hex('tok-here'),until:null},
  ]},1000);
  assert.deepEqual([...room.sim.players.keys()].sort(),['away','here'],'an already expired seat is not restored');
  // 'away' keeps its old deadline (5 s), 'here' gets a fresh grace from the restart.
  const late=peer();join(room,late,'Away',6000,'tok-away');assert.equal(late.closes[0]?.code,4003);
  const ok=peer();join(room,ok,'Here',1000+GRACE_MS-100,'tok-here');assert.equal(welcome(ok).id,'here');assert.equal(welcome(ok).token,'tok-here');
  const wrong=peer();join(room,wrong,'X',1100,'tok-gone');assert.equal(wrong.closes[0].code,4003);
});

test('the roster is written only when it changes, never per message or tick',()=>{
  let rows=0;const room=new Room(1000,undefined,{onRoster:()=>{rows++;}}),a=peer();join(room,a,'Ana',1000);
  assert.equal(rows,1);
  let t=1100;for(let i=0;i<100;i++){say(room,a,{t:'ping',at:i},t);room.advance(t+=50);}
  assert.equal(rows,1,'pings and lobby ticks write nothing');
  room.disconnect(a,t);room.advance(t+=50);assert.equal(rows,2,'the seat expiry changed');
});

test('checkpoint review: after a restart the event ids start above anything the crashed room handed out; a map switch carries them on',()=>{
  const f=round2??=playToRound2(),{room,writes,checkpoints}=f,before=room.sim.world.lastEventId;
  assert.ok(before>0);
  const t=f.t,restarted=new Room(1000,4242,{});
  restarted.restore(writes.at(-1)!,t);assert.equal(restarted.resume(checkpoints[0]),true);
  restarted.afterRestart(t);
  assert.ok(restarted.sim.world.lastEventId>=before,'raised past the last id of the crashed room');
  assert.ok(restarted.sim.world.lastEventId>=(t-1000)*50,'by the age of the room: whatever the crashed room emitted after its checkpoint');
  // Lobby fallback too: a restart with no checkpoint raises them the same way.
  const lobby=new Room(1000,4242,{});lobby.restore(writes.at(-1)!,t);lobby.resume(undefined);lobby.afterRestart(t);
  assert.ok(lobby.sim.world.lastEventId>=before);
});

test('checkpoint review: a resume that throws on the stored data ends in the lobby, never half-loaded',()=>{
  const f=round2??=playToRound2(),{writes,checkpoints}=f;
  const restarted=new Room(1000,4242,{});restarted.restore(writes.at(-1)!,f.t);
  (restarted.sim as any).resume=()=>{throw new Error('bad state');};
  assert.equal(restarted.resume(checkpoints[0]),false);
  assert.equal(restarted.run.snapshot().phase,'lobby');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../multiplayer/room.ts';
import {FrameRunFeed} from '../src/game/net/run-feed.ts';
import {ROOM_PROTOCOL,reconcile,type Input} from '../src/game/net/shared.ts';
import {createEnemy} from '../src/game/sim/enemies/catalog.ts';
import {kitFor} from '../src/game/sim/kits.ts';
import {SIM_HZ} from '../src/game/sim/types.ts';
import {SkillPress,skillState,skillLabel,PRESS_TTL_MS,NO_CAST_MS} from '../src/game/hud/skill.ts';
import {DICE_LINE,SKILL_BUBBLE_GAP_MS,skillBubbleLine} from '../src/game/render/jokes.ts';

// Same harness as run-feed.test.ts: JSON control messages, protocol 4 frames, a 50 ms clock.
function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,read:0,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
let clock=1200;
const command=(room:Room,p:Peer,message:object,now=clock)=>room.receive(p,JSON.stringify(message),now);
const join=(r:Room,p:Peer,n:string,classId:string)=>{r.connect(p,1000);r.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:n,classId}),1000);};
const idOf=(p:TestPeer)=>p.messages.find(m=>m.t==='welcome').id as string;
function step(room:Room,peers:TestPeer[]){clock+=50;if(clock%2000===0)for(const p of peers)command(room,p,{t:'ping',at:clock});room.advance(clock);}
function startRun(room:Room,peers:TestPeer[]){
  clock=1200;
  for(const p of peers)command(room,p,{t:'ready',round:room.run.snapshot().round,ready:true});
  for(let i=0;i<60;i++)step(room,peers);
  assert.equal(room.run.snapshot().phase,'combat');
}
function pump(room:Room,feed:FrameRunFeed,p:TestPeer){
  let last=0;
  for(;p.read<p.frames.length;p.read++){const r=feed.decode(p.frames[p.read]);assert.ok(r.ok,r.ok?'':r.error);last=r.seq;}
  if(last)command(room,p,{t:'ack',seq:last});
}
/** Steps until the feed holds a view after the current server tick; returns every event seen on the way. */
function settle(room:Room,feed:FrameRunFeed,p:TestPeer,peers:TestPeer[],ticks=4){
  const events:any[]=[];
  for(let i=0;i<ticks;i++){step(room,peers);pump(room,feed,p);events.push(...feed.take().events);}
  return events;
}
const input=(room:Room,p:TestPeer,seq:number,extra:Partial<Input>={})=>command(room,p,{t:'input',round:room.run.snapshot().round,seq,x:0,y:0,attack:false,...extra});

test('a skill input casts inside the tick and the caster line, dice and cooldown reach the client (protocol 4)',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana','viciado-em-bet');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const me=room.sim.players.get(idOf(a))!;
  const critter=createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y});critter.hp=critter.maxHp=1e6;
  input(room,a,1,{skill:true});
  const events=settle(room,feed,a,[a,b]);
  const cast=events.filter(e=>e.type==='skill');
  assert.equal(cast.length,1,'one cast, one event');
  const e=cast[0];
  assert.equal(e.player,idOf(a));assert.equal(e.skill,'viciado-em-bet');
  assert.ok(kitFor('viciado-em-bet')!.lines.includes(e.line),'the line is one of the kit lines');
  assert.ok(e.outcome in DICE_LINE,'the dice result rides along');
  assert.equal(e.x,undefined,'the dice do not move the caster');
  const mine=feed.players.get(idOf(a))!;
  assert.ok(mine.skillReadyTick! > room.sim.tick,'the cooldown reached the client');
  assert.equal(mine.skillReadyTick,me.skillReadyTick);assert.equal(mine.skillTick,me.skillTick);
  const state=skillState(mine,feed.take().tick);
  assert.equal(state.mode,'cooling');assert.equal(state.seconds,Math.ceil((me.skillReadyTick!-room.sim.tick)/SIM_HZ));
  // The PlayerRunView of the server (sandboxes, tests) carries the same fields.
  const view=room.sim.view(idOf(a)).players.find(p=>p.id===idOf(a))!;
  assert.equal(view.skillReadyTick,me.skillReadyTick);
});

test('a dash lands where the server says: the event carries the landing and the client reconciles from it',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Moto','motogirl');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const moto=room.sim.players.get(idOf(a))!,ally=room.sim.players.get(idOf(b))!;
  ally.x=moto.x+5;ally.y=moto.y;
  // The ally may stand on water after the nudge; only a walkable spot counts for the landing check below.
  ally.hp=10;
  const before={x:moto.x,y:moto.y};
  input(room,a,1,{skill:true});
  const events=settle(room,feed,a,[a,b]);
  const e=events.find(x=>x.type==='skill');
  assert.ok(e,'the dash cast');
  assert.ok(Math.hypot(moto.x-before.x,moto.y-before.y)>3,'the server moved the caster');
  assert.ok(Math.abs(e.x-moto.x)<.01&&Math.abs(e.y-moto.y)<.01,'landing spot in the event');
  const self=feed.players.get(idOf(a))!;
  assert.ok(Math.abs(self.x!-moto.x)<.01&&Math.abs(self.y!-moto.y)<.01,'authoritative position in the frame');
  // client.ts: predicted = reconcile(frame position, inputs the frame did not ack). The dash input is acked, so the
  // pre-dash prediction is gone; only later inputs replay on top of the landing spot.
  assert.equal(self.ack,1);
  const later:Input[]=[{seq:2,x:1,y:0,attack:false}];
  const predicted=reconcile({x:self.x!,y:self.y!},later.filter(i=>i.seq>self.ack!),room.sim.terrain);
  assert.ok(Math.hypot(predicted.x-moto.x,predicted.y-moto.y)<.2,'prediction starts from the landing, not from before the dash');
  assert.ok(Math.hypot(predicted.x-before.x,predicted.y-before.y)>3);
});

test('one tap is one cast: inputs without the flag never recast, even when the cooldown is over',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana','viciado-em-bet');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const me=room.sim.players.get(idOf(a))!;
  const critter=createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y});critter.hp=critter.maxHp=1e6;
  const press=new SkillPress();press.press(0);
  let seq=0,casts=0;
  for(let i=0;i<20*SIM_HZ;i++){
    me.hp=me.stats.maxHp;me.invulnerableUntil=room.sim.tick+100;
    input(room,a,++seq,{skill:press.take(i*50,true)});
    step(room,[a,b]);pump(room,feed,a);
    casts+=feed.take().events.filter(e=>e.type==='skill').length;
  }
  assert.equal(casts,1,'20 s of walking after one tap: one cast');
});

test('the rematch clears the cooldown: the first tap of the new run casts',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana','viciado-em-bet');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const me=room.sim.players.get(idOf(a))!;
  createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y}).hp=1e6;
  input(room,a,1,{skill:true});settle(room,feed,a,[a,b]);
  assert.ok(me.skillReadyTick!>room.sim.tick);
  for(const p of room.sim.players.values()){p.invulnerableUntil=0;room.sim.world.damagePlayer(p.id,1e6,'test');}
  settle(room,feed,a,[a,b]);
  assert.equal(room.run.snapshot().phase,'result');
  command(room,b,{t:'rematch',round:room.run.snapshot().round});
  settle(room,feed,a,[a,b]);
  assert.equal(me.skillReadyTick,0,'wire cooldown cleared');assert.equal((me as any).skillReady,undefined,'skill state cleared (resetSkill)');
  startRun(room,[a,b]);pump(room,feed,a);
  const critter=createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y});critter.hp=critter.maxHp=1e6;
  input(room,a,1,{skill:true});
  assert.equal(settle(room,feed,a,[a,b]).filter(e=>e.type==='skill').length,1,'casts at once in the new run');
});

test('SkillPress: once per tap, only when the input can go out, stale taps expire, a silent tap is reported once',()=>{
  const p=new SkillPress();
  assert.equal(p.take(0,true),false,'nothing pressed');
  p.press(0);
  assert.equal(p.take(10,false),false,'not connected: kept');assert.ok(p.pending);
  assert.equal(p.take(20,true),true);assert.equal(p.take(70,true),false,'one input per tap');
  assert.equal(p.unanswered(20+NO_CAST_MS-1),false);assert.equal(p.unanswered(20+NO_CAST_MS),true,'no cast came back');
  assert.equal(p.unanswered(20+NO_CAST_MS+50),false,'reported once');
  p.press(1000);assert.equal(p.take(1000+PRESS_TTL_MS+1,true),false,'a tap from a second ago never fires');
  p.press(3000);p.take(3000,true);p.answered();assert.equal(p.unanswered(9000),false,'answered taps are quiet');
});

test('skillState: ready without a number, then whole seconds counting down and the share paid',()=>{
  assert.deepEqual(skillState(undefined,100),{mode:'ready',seconds:0,progress:1});
  assert.deepEqual(skillState({skillTick:100,skillReadyTick:100+15*SIM_HZ},100+15*SIM_HZ),{mode:'ready',seconds:0,progress:1});
  const s=skillState({skillTick:100,skillReadyTick:100+15*SIM_HZ},100+5*SIM_HZ+1);
  assert.equal(s.mode,'cooling');assert.equal(s.seconds,10,'rounded up: 9.95 s left shows 10');
  assert.ok(Math.abs(s.progress-(5*SIM_HZ+1)/(15*SIM_HZ))<1e-9);
  assert.equal(skillLabel('motogirl'),'Habilidade: Entrega Expressa');assert.equal(skillLabel('nobody'),'Habilidade da classe');
  assert.ok(SKILL_BUBBLE_GAP_MS>=2000,'D-013: one line per caster every ~2 s');
  assert.equal(skillBubbleLine({line:'Calculei tudo de cabeça.',outcome:'miracle'}),'Calculei tudo de cabeça.\nMilagre!');
  assert.equal(skillBubbleLine({line:'Opa'}),'Opa');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../multiplayer/room.ts';
import {FrameRunFeed} from '../src/game/net/run-feed.ts';
import {ROOM_PROTOCOL,reconcile,type Input} from '../src/game/net/shared.ts';
import {createEnemy} from '../src/game/sim/enemies/catalog.ts';
import {kitFor} from '../src/game/sim/kits.ts';
import {SIM_HZ} from '../src/game/sim/types.ts';
import {SkillTaps,skillState,skillLabel,ANSWER_MS} from '../src/game/hud/skill.ts';
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
/** A skill tap as CoopClient.cast sends it (input-10hz): {t:'cast',round,id}, answered with {t:'cast',seq,ok,readyTick}. */
const tap=(room:Room,p:TestPeer,id:number)=>command(room,p,{t:'cast',round:room.run.snapshot().round,id});
const answers=(p:TestPeer)=>p.messages.filter(m=>m.t==='cast');

test('a skill tap casts inside the tick; the line, dice, cooldown and the tap answer reach the client (protocol 4)',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana','viciado-em-bet');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const me=room.sim.players.get(idOf(a))!;
  const critter=createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y});critter.hp=critter.maxHp=1e6;
  tap(room,a,1);
  const events=settle(room,feed,a,[a,b]);
  assert.deepEqual(answers(a).map(m=>[m.seq,m.ok]),[[1,true]],'the room answers the tap once');
  assert.equal(answers(a)[0].readyTick,me.skillReadyTick,'with the readyTick the button can show at once');
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
  tap(room,a,1);
  const events=settle(room,feed,a,[a,b]);
  const e=events.find(x=>x.type==='skill');
  assert.ok(e,'the dash cast');
  assert.ok(Math.hypot(moto.x-before.x,moto.y-before.y)>3,'the server moved the caster');
  assert.ok(Math.abs(e.x-moto.x)<.01&&Math.abs(e.y-moto.y)<.01,'landing spot in the event');
  const self=feed.players.get(idOf(a))!;
  assert.ok(Math.abs(self.x!-moto.x)<.01&&Math.abs(self.y!-moto.y)<.01,'authoritative position in the frame');
  // client.ts: predicted = reconcile(frame position, inputs the frame did not ack). The tap moves no step (it is its
  // own message), so the prediction restarts from the landing; only inputs after the frame's ack replay on top of it.
  const acked=self.ack??0;
  const later:Input[]=[{seq:acked+1,x:1,y:0,attack:false}];
  const predicted=reconcile({x:self.x!,y:self.y!},later.filter(i=>i.seq>acked),room.sim.terrain);
  assert.ok(Math.hypot(predicted.x-moto.x,predicted.y-moto.y)<.2,'prediction starts from the landing, not from before the dash');
  assert.ok(Math.hypot(predicted.x-before.x,predicted.y-before.y)>3);
});

test('one tap is one cast: walking afterwards never recasts, even when the cooldown is over',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana','viciado-em-bet');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const me=room.sim.players.get(idOf(a))!;
  const critter=createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y});critter.hp=critter.maxHp=1e6;
  const taps=new SkillTaps();let id=0;
  assert.equal(taps.tap(false,()=>{tap(room,a,++id);return id;},0),'sent');
  let seq=0,casts=0;
  for(let i=0;i<20*SIM_HZ;i++){
    me.hp=me.stats.maxHp;me.invulnerableUntil=room.sim.tick+100;
    if(i%2===0)input(room,a,++seq,{x:i%40<20?.3:-.3});
    step(room,[a,b]);pump(room,feed,a);
    casts+=feed.take().events.filter(e=>e.type==='skill').length;
  }
  assert.equal(casts,1,'20 s of walking after one tap: one cast');
  assert.deepEqual(answers(a).map(m=>m.ok),[true]);
});

test('the rematch clears the cooldown: the first tap of the new run casts',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana','viciado-em-bet');join(room,b,'Bia','mendigo');startRun(room,[a,b]);
  const feed=new FrameRunFeed();pump(room,feed,a);
  const me=room.sim.players.get(idOf(a))!;
  createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y}).hp=1e6;
  tap(room,a,1);settle(room,feed,a,[a,b]);
  assert.ok(me.skillReadyTick!>room.sim.tick);
  for(const p of room.sim.players.values()){p.invulnerableUntil=0;room.sim.world.damagePlayer(p.id,1e6,'test');}
  settle(room,feed,a,[a,b]);
  assert.equal(room.run.snapshot().phase,'result');
  command(room,b,{t:'rematch',round:room.run.snapshot().round});
  settle(room,feed,a,[a,b]);
  assert.equal(me.skillReadyTick,0,'wire cooldown cleared');assert.equal((me as any).skillReady,undefined,'skill state cleared (resetSkill)');
  startRun(room,[a,b]);pump(room,feed,a);
  const critter=createEnemy(room.sim.world,'gosma',{x:me.x+1.5,y:me.y});critter.hp=critter.maxHp=1e6;
  tap(room,a,2);
  assert.equal(settle(room,feed,a,[a,b]).filter(e=>e.type==='skill').length,1,'casts at once in the new run');
});

test('SkillTaps: a tap during the cooldown sends nothing; a tap that cannot go out sends nothing; answers by id',()=>{
  const t=new SkillTaps();let sent=0;const send=()=>++sent;
  assert.equal(t.tap(true,send,0),'cooling','cooling: "ainda não", no message');assert.equal(sent,0);
  assert.equal(t.tap(false,()=>undefined,0),'off','offline, out of combat or watching (CoopClient.cast refused)');assert.ok(!t.pending);
  assert.equal(t.tap(false,send,10),'sent');assert.equal(sent,1);
  assert.equal(t.tap(false,send,15),'waiting','a second tap before the answer sends nothing');assert.equal(sent,1);
  assert.equal(t.answer({seq:0,ok:false,readyTick:0},20),undefined,'an answer to an older tap is not ours');
  assert.equal(t.answer({seq:1,ok:false,readyTick:0},30),'none','ok:false: "sem alvo"');
  assert.equal(t.answer({seq:1,ok:false,readyTick:0},40),undefined,'answered once');
  t.tap(false,send,100);assert.equal(t.answer({seq:2,ok:true,readyTick:500},3100),'cast','a slow answer still counts');
  t.tap(false,send,200);assert.equal(t.answer({seq:3,ok:false,readyTick:0},200+ANSWER_MS+1),undefined,'a lost tap is forgotten quietly');
});

test('skillState: ready without a number, then whole seconds counting down and the share paid',()=>{
  assert.deepEqual(skillState(undefined,100),{mode:'ready',seconds:0,progress:1});
  assert.deepEqual(skillState({skillTick:100,skillReadyTick:100+15*SIM_HZ},100+15*SIM_HZ),{mode:'ready',seconds:0,progress:1});
  const s=skillState({skillTick:100,skillReadyTick:100+15*SIM_HZ},100+5*SIM_HZ+1);
  assert.equal(s.mode,'cooling');assert.equal(s.seconds,10,'rounded up: 9.95 s left shows 10');
  assert.ok(Math.abs(s.progress-(5*SIM_HZ+1)/(15*SIM_HZ))<1e-9);
  const answered=skillState({skillTick:0,skillReadyTick:0},100,{castTick:100,readyTick:100+12*SIM_HZ});
  assert.equal(answered.mode,'cooling','the tap answer starts the ring before the frame');assert.equal(answered.seconds,12);
  assert.equal(skillState({skillTick:100,skillReadyTick:100+6*SIM_HZ},101,{castTick:100,readyTick:100+12*SIM_HZ}).seconds,12,'the later readyTick wins');
  assert.equal(skillLabel('motogirl'),'Habilidade: Entrega Expressa');assert.equal(skillLabel('nobody'),'Habilidade da classe');
  assert.ok(SKILL_BUBBLE_GAP_MS>=2000,'D-013: one line per caster every ~2 s');
  assert.equal(skillBubbleLine({line:'Calculei tudo de cabeça.',outcome:'miracle'}),'Calculei tudo de cabeça.\nMilagre!');
  assert.equal(skillBubbleLine({line:'Opa'}),'Opa');
});

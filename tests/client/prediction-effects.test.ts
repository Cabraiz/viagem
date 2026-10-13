/**
 * D-036 prediction with the burp's slow and the poop's slip, end to end: a real Room (input-10hz batches, protocol 4
 * frames, the owner's confirmed position) and the phone's prediction exactly as CoopClient runs it (client.ts input()
 * and frame(): pending steps replayed with maps/prediction.ts on ticks frameTick+1+k with the frame's effects).
 * Latency both ways; the hits are 0-damage telegraphs of each kind dropped on the player.
 * Pass: after every frame the replayed position equals the one predicted before it (no snap-back beyond the wire's
 * 1/512 position grid), except on the frame that first reports a new hit (that news is late by nature); and every
 * step the phone predicted after it knew the effect lands exactly where the room put it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';
import {reconcile,simulate,type MoveEffects} from '../../src/maps/prediction.ts';
import {InputBatcher,ROOM_PROTOCOL,type PlayerWireView} from '../../src/protocol/index.ts';
import {addTelegraph} from '../../src/sim/index.ts';
import {heroSpeed} from '../../src/maps/world.ts';
/** The island hero's walk (u/s): 2 × the base world.ts SPEED since velocidade-heroi-e-projetil. */
const WALK=heroSpeed();
import {STEP} from '../../src/maps/prediction.ts';
import type {PlayerInput,Point,TelegraphKind} from '../../src/contract/index.ts';

const EPS=2/512;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

function peer(){
  const messages:any[]=[],frames:{at:number;data:Uint8Array}[]=[];
  let now=0;
  return {messages,frames,setNow:(t:number)=>{now=t;},send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push({at:now,data:s});},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;

interface Scenario {
  latencyMs:number;hits:{atStep:number;kind:TelegraphKind}[];stick:(step:number)=>Point;steps:number;
  /** Extra delay of the i-th input batch, ms (kept in order, like a TCP stream that stalls). */
  inputJitter?:(i:number)=>number;
  /** The room's tick timer drifts ±this many ms (the Durable Object's alarms), a fixed pseudo-random sequence. */
  tickJitterMs?:number;
}

function play(s:Scenario){
  let clock=1000;
  const room=new Room(clock),a=peer(),b=peer();
  const say=(p:TestPeer,m:object,at=clock)=>room.receive(p as unknown as Peer,JSON.stringify(m),at);
  for(const [p,n] of [[a,'Ana'],[b,'Bia']] as const){room.connect(p as unknown as Peer,clock);say(p,{t:'join',protocol:ROOM_PROTOCOL,name:n,classId:'cidadao-comum'});}
  const id=a.messages.find(m=>m.t==='welcome').id as string;
  let seed=7;
  const drift=()=>{if(!s.tickJitterMs)return 0;seed=(seed*1103515245+12345)%2147483648;return Math.round((seed/2147483648-.5)*2*s.tickJitterMs);};
  let combat=false;
  const advance=()=>{clock+=50+(combat?drift():0);a.setNow(clock);b.setNow(clock);room.advance(clock);};
  for(const p of [a,b])say(p,{t:'ready',round:room.run.snapshot().round,ready:true});
  for(let i=0;i<80&&room.run.snapshot().phase!=='combat';i++)advance();
  assert.equal(room.run.snapshot().phase,'combat');
  combat=true;
  const me=room.sim.players.get(id)!;
  const round=room.run.snapshot().round;

  // The phone: CoopClient's prediction state, stepped like client.ts input() and frame().
  const feed=new FrameRunFeed(),batcher=new InputBatcher();
  let tick=0,effects:MoveEffects={},predicted:Point={x:me.x,y:me.y},pending:PlayerInput[]=[];
  let read=0;
  const outbox:{at:number;m:object}[]=[];let batches=0,lastAt=0;
  const snaps:{tick:number;snap:number;news:boolean;ack:number}[]=[];
  // Hits counted on both ends (each new slowUntil / slipUntil value is one): a step is compared when the phone had heard
  // every hit the room had fired by the time it took that step.
  let heard=0,fired=0;
  const mine=new Map<number,{at:Point;heard:number}>();
  const taken=new Map<number,{at:Point;fired:number}>();
  const fresh=(next:number|undefined,old:number|undefined)=>next!==undefined&&next!==old?1:0;

  const deliverFrames=()=>{
    for(;read<a.frames.length&&a.frames[read].at+s.latencyMs<=clock;read++){
      const r=feed.decode(a.frames[read].data);assert.ok(r.ok,r.ok?'':r.error);
      outbox.push({at:Math.max(lastAt,clock),m:{t:'ack',seq:r.seq}});lastAt=Math.max(lastAt,clock);
      tick=r.view.tick;
      const self=r.view.players.find(p=>p.id===id) as PlayerWireView|undefined;
      if(!self)continue;
      const next:MoveEffects={slowUntil:self.slowUntil,slipUntil:self.slipUntil,slip:self.slip};
      const news=fresh(next.slowUntil,effects.slowUntil)+fresh(next.slipUntil,effects.slipUntil);
      heard+=news;effects=next;
      batcher.catchUp(self.ack??0);pending=pending.filter(i=>i.seq>(self.ack??0));
      const before=predicted;
      predicted=self.hp?reconcile({x:self.x!,y:self.y!},pending,room.sim.terrain,{tick,effects}):{x:self.x!,y:self.y!};
      snaps.push({tick,snap:dist(before,predicted),news:news>0,ack:self.ack??0});
    }
  };
  const phoneStep=(n:number)=>{
    const {input,active}=batcher.step(s.stick(n),false);
    if(active){pending.push(input);predicted=simulate(predicted,input,room.sim.terrain,tick+pending.length,effects);}
    mine.set(input.seq,{at:predicted,heard});
    const batch=batcher.take(clock);
    if(batch){lastAt=Math.max(lastAt,clock+(s.inputJitter?.(batches++)??0));outbox.push({at:lastAt,m:{t:'input',round,seq:batch.seq,steps:batch.steps}});}
  };
  // Acks and input batches share one ordered stream (an ack waits behind a late batch, like on a socket).
  const deliverInputs=()=>{while(outbox.length&&outbox[0].at+s.latencyMs<=clock){const {at,m}=outbox.shift()!;say(a,m,at+s.latencyMs);}};

  for(let n=0;n<s.steps;n++){
    deliverInputs();
    for(const p of room.sim.players.values())p.hp=p.stats.maxHp;
    for(const h of s.hits)if(h.atStep===n)addTelegraph(room.sim.world,{shape:'circle',x:me.x,y:me.y,radius:8,damage:0,owner:'env:test',kind:h.kind},0);
    const slow=me.slowUntil,slip=me.slipUntil,ack=me.ack;
    advance();
    fired+=fresh(me.slowUntil,slow)+fresh(me.slipUntil,slip);
    if(me.ack!==ack)taken.set(me.ack,{at:{x:me.x,y:me.y},fired});
    deliverFrames();
    phoneStep(n);
  }
  return {snaps,mine,taken,fired,heard};
}

function check(r:ReturnType<typeof play>,label:string,hits:number){
  assert.equal(r.fired,hits,`${label}: the room applied every hit`);
  assert.equal(r.heard,hits,`${label}: the phone heard every hit`);
  const bad=r.snaps.filter(x=>!x.news&&x.snap>EPS);
  assert.deepEqual(bad,[],`${label}: snap-back without news`);
  let compared=0,effected=0;
  for(const [seq,p] of r.mine){
    const at=r.taken.get(seq);
    if(!at||p.heard<at.fired)continue;
    compared++;if(at.fired>0)effected++;
    assert.ok(dist(at.at,p.at)<=EPS,`${label}: step ${seq} predicted ${p.at.x},${p.at.y}, room ${at.at.x},${at.at.y}`);
  }
  assert.ok(compared>100&&effected>40,`${label}: steps compared ${compared} (${effected} after a hit)`);
}

test('walking straight: a burp slow and a poop slip in the middle, no snap-back and exact steps',()=>{
  for(const latencyMs of [0,50,100,150]){
    const hits=[{atStep:40,kind:'arroto' as const},{atStep:60,kind:'coco' as const},{atStep:120,kind:'arroto' as const},{atStep:125,kind:'coco' as const}];
    check(play({latencyMs,steps:220,stick:()=>({x:1,y:.25}),hits}),`${latencyMs} ms`,hits.length);
  }
});

test('turning and stopping around the hits: still no snap-back from the effects',()=>{
  const hits=[{atStep:30,kind:'arroto' as const},{atStep:70,kind:'coco' as const},{atStep:140,kind:'coco' as const}];
  // Turns every 0.75 s, stands still for a while (a slide needs a step: standing, the poop moves nobody), walks again.
  const stick=(n:number)=>n>=150&&n<170?{x:0,y:0}:[{x:1,y:0},{x:0,y:1},{x:-1,y:.3},{x:.2,y:-1}][Math.floor(n/15)%4];
  check(play({latencyMs:60,steps:240,stick,hits}),'turning',hits.length);
});

const HITS4=[{atStep:40,kind:'arroto' as const},{atStep:60,kind:'coco' as const},{atStep:120,kind:'arroto' as const},{atStep:125,kind:'coco' as const}];
const straight=()=>({x:1,y:.25});
const ackGoesBack=(r:ReturnType<typeof play>)=>r.snaps.filter((x,i)=>i>0&&x.ack<r.snaps[i-1].ack).map(x=>x.tick);

test('review B1: late input batches around the hits: the owner ack never goes back and nothing snaps without news',()=>{
  // Every 5th batch 150 ms late (in order): before the fix the frame went live (ack = the room's step) during the
  // effect and back to the older confirmed ack after it, a 0.3 u snap back.
  const r=play({latencyMs:60,steps:220,stick:straight,hits:HITS4,inputJitter:i=>i%5===4?150:0});
  assert.deepEqual(ackGoesBack(r),[],'ack monotone');
  check(r,'every 5th batch +150 ms',HITS4.length);
  // One batch 450 ms late: the room waits past its guess horizon for a tick, a one-step correction that happens with or
  // without effects (the baseline below); the effects add nothing to it (before the fix: 2 u back).
  const late=(i:number)=>i===4?450:0;
  const base=play({latencyMs:60,steps:220,stick:straight,hits:[],inputJitter:late});
  const hit=play({latencyMs:60,steps:220,stick:straight,hits:HITS4,inputJitter:late});
  assert.deepEqual(ackGoesBack(hit),[],'ack monotone');
  assert.equal(hit.fired,HITS4.length);assert.equal(hit.heard,HITS4.length);
  const quiet=(x:ReturnType<typeof play>)=>x.snaps.filter(y=>!y.news&&y.snap>EPS);
  assert.ok(quiet(hit).length<=quiet(base).length,`snaps ${quiet(hit).length} vs ${quiet(base).length} without hits`);
  for(const x of quiet(hit))assert.ok(x.snap<=WALK*STEP+EPS,`at most one walking step (${x.snap})`);
});

test('review R1: a room whose ticks drift ±10–20 ms: no correction without hits, at most ~one step per hit with them',()=>{
  // The prediction assumes one room step per tick; a drifting timer sometimes takes a step a tick late, which moves an
  // effect boundary by one step (a slide or slowed step instead of a walk). Bounded, documented, not removed.
  const hits=[...HITS4,{atStep:170,kind:'coco' as const}];
  for(const tickJitterMs of [10,20]){
    const calm=play({latencyMs:60,steps:220,stick:straight,hits:[],tickJitterMs});
    assert.deepEqual(calm.snaps.filter(x=>x.snap>EPS),[],`±${tickJitterMs} ms, no hits: no correction`);
    const r=play({latencyMs:60,steps:220,stick:straight,hits,tickJitterMs});
    assert.deepEqual(ackGoesBack(r),[]);
    const quiet=r.snaps.filter(x=>!x.news&&x.snap>EPS);
    assert.ok(quiet.length<=hits.length,`±${tickJitterMs} ms: ${quiet.length} corrections for ${hits.length} hits`);
    for(const x of quiet)assert.ok(x.snap<=.4,`±${tickJitterMs} ms: correction ${x.snap} ≤ 0.4 u`);
  }
});

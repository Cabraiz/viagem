// N1-choose-no-tick: offer commands (pick, "Pular", "Rolar de novo") wait for the room's next tick and land there in
// arrival order (Simulation.queueOffer/applyOffers), and each accepted one is logged with its tick (offerLog). So the
// run is a function of the seed, the seat ids (RoomOptions.newId), the inputs and that log: where between two ticks a
// pick came in, what came with it, and whether it is delivered live or replayed from the log do not change a tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import type {AppliedOffer} from '../../multiplayer/simulation.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number,token?:string)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',...(token?{token}:{})},now);};
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');

/** Level offers handed out on these sim ticks (the script follows the sim's tick: a pause holds it, D-050). */
const GRANTS=new Map([[20,2],[30,3],[260,4],[420,5]]);
/** Bia's phone drops (the socket closes) on this tick and rejoins with her token on the next one: offers held meanwhile. */
const DROP_FROM=240,DROP_TO=300;
const TICKS=500;

type Mode='early'|'late'|'replay';
/**
 * Ana and Bia (two people, no room bots: a bot's pick in a pause is on the wall clock) play up to sim tick TICKS.
 * 'early': each pick, skip or reroll goes out right after the tick that showed the offer; 'late': just before the next
 * tick, behind pings, a forged pick and a stale one; 'replay': `log` (an earlier run's offerLog) delivered on its ticks.
 * Returns the state hash after every room tick and the run's offerLog.
 */
function play(mode:Mode,log:readonly AppliedOffer[]=[]){
  let n=0;
  const room=new Room(1000,4242,{newId:()=>`pessoa-${++n}`});
  const a=peer();let b=peer();
  join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=1100;
  for(const p of [a,b])say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const ana=welcome(a).id as string,bia=welcome(b).id as string,token=welcome(b).token as string;
  assert.deepEqual([ana,bia],['pessoa-1','pessoa-2'],'pinned seat ids');
  const sim=room.sim,round=()=>room.run.snapshot().round,sent=new Set<AppliedOffer>();
  // What each person does with their head offer: Ana rerolls her first one, then picks; Bia skips her second one.
  let anaOffers=0,biaOffers=0;
  const decide=(id:string)=>{
    const head=sim.offers(id)[0];if(!head)return;
    const k=id===ana?anaOffers++:biaOffers++;
    const t=id===ana&&k===0?'reroll':id===bia&&k===1?'skip':'choose';
    return {t,round:round(),offer:head.id,...(t==='choose'?{index:k%head.choices.length}:{})};
  };
  /** Each person's commands for this tick: one per offer seen, sent once (a reroll's new id is a new offer). */
  const seen=new Set<string>();
  const commands=(online:boolean)=>{
    const out:[TestPeer,object][]=[];
    for(const [id,p] of [[ana,a],[bia,b]] as const){
      if(id===bia&&!online)continue;
      const head=sim.offers(id)[0];if(!head||seen.has(head.id))continue;
      seen.add(head.id);const m=decide(id);if(m)out.push([p,m]);
    }
    return out;
  };
  const hashes:string[]=[],granted=new Set<number>();let dropped=false,back=false;
  for(let i=0;sim.tick<TICKS;i++){
    assert.ok(i<TICKS*2,'the run moves');
    const grant=GRANTS.get(sim.tick);if(grant&&!granted.has(sim.tick)){granted.add(sim.tick);sim.run.progression.grantLevelOffers(sim.world,grant);}
    if(!dropped&&sim.tick>=DROP_FROM){dropped=true;room.disconnect(b,t);assert.equal(sim.players.get(bia)!.online,false);}
    if(!back&&sim.tick>=DROP_TO){back=true;b=peer();join(room,b,'Bia',t,token);assert.equal(welcome(b).id,bia,'Bia keeps her seat');}
    const online=!dropped||back;
    if(mode==='replay'){
      for(const e of log)if(!sent.has(e)&&e.tick===sim.tick){
        sent.add(e);
        say(room,e.id===ana?a:b,{t:e.t,round:round(),offer:e.offer,...(e.index!==undefined?{index:e.index}:{})},t);
      }
    }
    if(online&&i%5===0)say(room,b,{t:'ping',at:t},t);
    say(room,a,{t:'ping',at:t},t);
    if(mode!=='replay'){
      const out=commands(online);
      if(mode==='early')for(const [p,m] of out)say(room,p,m,t);
      if(mode==='late'){
        // Refused at the tick (an unknown offer, a stale round): reach the sim or not, they change nothing. Every
        // 4th tick: the room closes a socket past 45 messages a second.
        if(i%4===0){
          say(room,a,{t:'choose',round:round(),offer:`lvl-9-${ana}`,index:0},t);
          say(room,a,{t:'choose',round:round()+1,offer:`lvl-2-${ana}`,index:0},t);
        }
        for(const [p,m] of out.reverse())say(room,p,m,t);
      }
    }
    t+=50;room.advance(t);
    hashes.push(`${i} t${sim.tick} ${sim.stateHash()}`);
  }
  assert.equal(room.run.snapshot().phase,'combat','still fighting');
  return {hashes,log:[...sim.offerLog],ana,bia};
}

/**
 * The hash after each room tick that stepped the sim, keyed by tick: a level-up pause (D-050) holds the sim for room
 * ticks the replay does not need (it lands the commands on their tick at once), and the test's out-of-band grants show
 * up only in the step after them.
 */
function stepped(hashes:string[]){
  const out:string[]=[];let last='';
  for(const h of hashes){const [,tick,hash]=h.split(' ');if(tick!==last)out.push(`${tick} ${hash}`);last=tick!;}
  return out;
}
function same(first:string[],again:string[],what:string){
  const k=first.findIndex((h,i)=>h!==again[i]);
  assert.equal(k,-1,`${what}: step ${k} differs (${first[k]} vs ${again[k]})`);
  assert.equal(again.length,first.length,`${what}: same length`);
}

test('picks, skips and rerolls with a reconnection: the same hash every tick whenever between ticks they arrive, and replayed from the log',()=>{
  const early=play('early');
  const kinds=early.log.map(e=>`${e.id===early.ana?'ana':'bia'}:${e.t}`);
  assert.ok(kinds.includes('ana:reroll')&&kinds.includes('bia:skip')&&kinds.filter(k=>k.endsWith(':choose')).length>=4,kinds.join(' '));
  assert.ok(early.log.every(e=>e.ok&&Number.isInteger(e.tick)),'only accepted commands, each with its tick');
  // Bia's offers while she was away wait for her: she answers them after the rejoin.
  assert.ok(early.log.some(e=>e.id===early.bia&&e.tick>early.log.find(x=>x.id===early.ana&&x.offer.startsWith('lvl-4-'))!.tick),'Bia picks after the rejoin');
  const late=play('late');
  same(early.hashes,late.hashes,'late in the gap, behind refused commands');
  // Arrival order between two people is theirs (late sends Bia's first); each person's own order is kept.
  const byPlayer=(log:AppliedOffer[])=>[...log].sort((x,y)=>x.tick-y.tick||(x.id<y.id?-1:x.id>y.id?1:0));
  assert.deepEqual(byPlayer(late.log),byPlayer(early.log));
  // The replay lands each command on the first room tick of its sim tick, so a pause closes sooner (live, it waited
  // for Bia's silent phone): compared step by step.
  const replay=play('replay',early.log);
  const live=stepped(early.hashes);
  same(live,stepped(replay.hashes).slice(0,live.length),'replayed from offerLog');
  assert.deepEqual(replay.log,early.log);
});

test('a queued pick is not applied between ticks, and is dropped when the run leaves combat',()=>{
  const room=new Room(1000,7,{newId:(()=>{let n=0;return ()=>`p-${++n}`;})()}),a=peer();
  join(room,a,'Ana',1000);let t=1100;
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const id=welcome(a).id as string;
  room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  const offer=room.sim.offers(id)[0]!.id;
  say(room,a,{t:'choose',round:room.run.snapshot().round,offer,index:0},t);
  assert.equal(room.sim.offers(id)[0]?.id,offer,'still there until the tick');
  assert.equal(room.sim.queuedOffers.length,1);
  room.advance(t+=50);
  assert.notEqual(room.sim.offers(id)[0]?.id,offer,'taken on the tick');
  assert.equal(a.messages.findLast(m=>m.t==='offers').offers.some((o:any)=>o.id===offer),false,'and answered');
  // Queued, then the run ends before the tick: nothing applied, nothing kept for the next run.
  room.sim.run.progression.grantLevelOffers(room.sim.world,3);
  const next=room.sim.offers(id)[0]!.id;
  say(room,a,{t:'choose',round:room.run.snapshot().round,offer:next,index:0},t);
  room.run.finish('defeat');
  room.advance(t+=50);
  assert.equal(room.sim.queuedOffers.length,0);
  assert.equal(room.sim.offers(id)[0]?.id,next,'the pick did not land after the run ended');
});

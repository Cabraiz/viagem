// D-047, the chaveiro objective in the city room (the default since NEW-20261013-ORQ-objetivo-chaveiro, pass 2):
//  1. ACCEPTANCE: a city Room (the real Cidade Nevada asset) with one scripted person and three room bots plays to the end
//     or SIM_SECONDS of simulation without an exception or a bot stuck > STUCK_SECONDS (as city-room-bots counts it: a
//     stick held while it never gets STUCK_REACH away, standing, no critter within FIGHT_NEAR); the moto progresses, the
//     phone's frames carry the objective (protocol 15), and a finished run carries its bill (RunState.objective).
//  2. Dona Cida through the room: {t:'cida'} → {t:'bought'} with the sim's refusals, a resent req applies once.
//  3. A checkpoint at the round-2 intermission resumes on a fresh city Simulation with the objective and plays on alike.
// D-031: results only (positions, events, ticks); nothing about wall-clock time is asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {Simulation,type SimCheckpoint} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameDecoder} from '../../src/protocol/protocol4.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {FlowField} from '../../src/maps/flowfield.ts';
import {heroSpeed,walkable,type Point} from '../../src/maps/world.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {SIM_HZ,ticks} from '../../src/contract/types.ts';
import type {ObjectiveView} from '../../src/contract/objective.ts';
import {cityFlowGrid,cityTerrainOf} from '../../src/sim/city/grid.ts';
import {stateHash} from '../../src/sim/core.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};
const STUCK_SECONDS=5,STUCK_REACH=1,FIGHT_NEAR=6,SIM_SECONDS=360;

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const round=(room:Room)=>room.run.snapshot().round;
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(1)} s`;

/** A city room in combat: Ana (scripted) and `bots` room bots; the objective is the room's default. */
async function cityRoom(seed:number,bots:number){
  let n=0;
  const room=new Room(1000,seed,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',objective:'chaveiro',newId:()=>`pessoa-${++n}`}),a:TestPeer=peer();
  await room.ready();
  let t=1000;
  room.connect(a,t);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t);
  const ana=a.messages.find(m=>m.t==='welcome')?.id as string;
  assert.ok(ana,'Ana sits');
  for(let i=0;i<bots;i++)say(room,a,{t:'bot-add',round:round(room)},t+=OWNER_GAP_MS);
  say(room,a,{t:'ready',round:round(room),ready:true},t+=OWNER_GAP_MS);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  return {room,a,ana,t};
}

test('ACCEPTANCE (D-047): a city room with three bots and a person plays the chaveiro objective without an exception or a stuck bot, and the moto progresses',async()=>{
  const {room,a,ana,t:t0}=await cityRoom(4242,3);
  let t=t0;
  const sim=room.sim,city=cityTerrainOf(sim.terrain)!;
  assert.ok(city,'the room plays the city');
  assert.equal(sim.objective,'chaveiro','the city room plays the objective by default');
  const start=sim.objectiveView()!;
  assert.ok(start,'the objective is wired');
  const bots=[...sim.bots];
  const stick=new Map<string,Point>(),set=sim.setBotInput.bind(sim);
  sim.setBotInput=(id,direction,skill)=>{stick.set(id,{x:direction.x,y:direction.y});set(id,direction,skill);};
  const plaza=city.asset.points.praca,route=new FlowField(cityFlowGrid(city),[plaza]),dir={x:0,y:0},v=heroSpeed(city)/SIM_HZ;
  const window=ticks(STUCK_SECONDS);
  const trail=new Map(bots.map(id=>[id,[] as {x:number;y:number;moving:boolean;free:boolean}[]]));
  const stuck=new Map(bots.map(id=>[id,{run:0,worst:0,at:''}]));
  const modes:Record<string,number>={},moments:string[]=[];
  const brains=(room as unknown as {bots:RoomBots}).bots;
  let waves=0;
  for(let i=0;i<ticks(SIM_SECONDS)&&room.run.snapshot().phase==='combat';i++){
    const p=sim.players.get(ana)!;
    if(!p.downed){
      route.directionAt(p.x,p.y,dir);
      const next={x:p.x+dir.x*v,y:p.y+dir.y*v};
      if((dir.x||dir.y)&&walkable(next,city)){p.x=next.x;p.y=next.y;}
    }
    t+=50;
    if(i%SIM_HZ===0)say(room,a,{t:'ack',seq:0},t);
    room.advance(t);
    for(const e of sim.events){
      if(e.type==='round'&&e.phase==='wave')waves=e.index;
      if(e.type==='moto')moments.push(`${e.mode}${e.alone?'(sozinho)':''} ${secs(sim.tick)}`);
    }
    // D-050: a level-up pause stops the sim (Ana never picks: each lasts its deadline); nobody is stuck in it.
    if(room.levelup.paused)continue;
    for(const id of bots){
      const mode=brains.modes.get(id);if(mode)modes[mode]=(modes[mode]??0)+1;
      const b=sim.players.get(id)!,s=stick.get(id)??{x:0,y:0},h=trail.get(id)!;
      const fight=sim.enemies.some(e=>Math.hypot(e.x-b.x,e.y-b.y)<FIGHT_NEAR);
      h.push({x:b.x,y:b.y,moving:Math.hypot(s.x,s.y)>.15&&!b.downed,free:!fight});
      if(h.length>window)h.shift();
      const near=h.length===window&&h.every(q=>q.moving&&Math.hypot(q.x-h[0].x,q.y-h[0].y)<STUCK_REACH);
      const w=stuck.get(id)!;w.run=near&&h.every(q=>q.free)?w.run+1:0;
      if(w.run>w.worst){w.worst=w.run;w.at=`(${b.x.toFixed(1)},${b.y.toFixed(1)}) ${brains.modes.get(id)} r${sim.world.round.index} ${sim.world.round.phase} ${secs(sim.tick)}`;}
    }
  }
  const end=sim.objectiveView()!,state=room.run.snapshot();
  console.log(`[chaveiro] city room, Ana + 3 bots, seed 4242, ${secs(sim.tick)}: phase ${state.phase}${state.outcome?` (${state.outcome})`:''}, wave ${waves}; `
    +`moto ${end.moto.mode} at (${end.moto.x.toFixed(1)},${end.moto.y.toFixed(1)}), ETA ${start.etaS} → ${end.etaS} s; car ${end.car.hits}/${end.car.limit}, parts ${end.car.parts}; `
    +`Grana ${end.grana}/${end.budget}\n  moments: ${moments.join(', ')||'none'}\n  bot modes (decisions × bots): ${JSON.stringify(modes)}`
    +`\n  stuck beyond ${STUCK_SECONDS} s: ${bots.map(id=>`${id} ${secs(stuck.get(id)!.worst)}${stuck.get(id)!.worst?` at ${stuck.get(id)!.at}`:''}`).join(', ')}`
    +(state.objective?`\n  result: ${JSON.stringify(state.objective)}`:''));
  for(const id of bots)assert.equal(stuck.get(id)!.worst,0,`${id} stuck ${secs(stuck.get(id)!.worst)} at ${stuck.get(id)!.at}`);
  // The moto rode: its ETA dropped (or the run ended on its way) and it left the entrance.
  assert.ok(end.etaS<start.etaS,`ETA ${start.etaS} → ${end.etaS}`);
  assert.ok(Math.hypot(end.moto.x-start.route[0].x,end.moto.y-start.route[0].y)>1,'the moto left the entrance');
  // The phone's frames carry the objective (protocol 15): decoded in order, the last view has it with the route.
  const dec=new FrameDecoder();let last:ObjectiveView|undefined;
  for(const f of a.frames){const r=dec.decode(f);if(r.ok&&r.view.objective)last=r.view.objective;}
  assert.ok(last,'frames carry the objective');
  assert.equal(last!.route.length,start.route.length,'the static route came through');
  // A finished run's last frame is the moment it ended: the bill's ETA (the view after a defeat reads 0).
  const lastEta=state.phase==='result'&&state.objective?state.objective.eta:end.etaS;
  assert.ok(Math.abs(last!.etaS-lastEta)<=2,`the phone's ETA ${last!.etaS} vs ${lastEta}`);
  // A finished run carries the bill.
  if(state.phase==='result'){
    assert.ok(state.objective,'the result carries the objective');
    assert.equal(state.objective!.outcome,state.outcome);
  }
});

test('Dona Cida through the room: {t:\'cida\'} answers {t:\'bought\'} with the sim\'s refusals, and a resent req applies once',async()=>{
  const {room,a,ana,t:t0}=await cityRoom(77,0);
  let t=t0;
  const sim=room.sim,chaveiro=sim.run.chaveiro!;
  for(let i=0;i<5;i++)room.advance(t+=50);
  const answers=()=>a.messages.filter(m=>m.t==='bought');
  const buy=(req:number,item='brigadeiro',r=round(room))=>say(room,a,{t:'cida',round:r,req,item},t+=10);
  const p=sim.players.get(ana)!,moto=chaveiro.moto();
  p.x=moto.x+1;p.y=moto.y;
  buy(1);
  assert.deepEqual(answers().at(-1),{t:'bought',req:1,item:'brigadeiro',ok:false,reason:'grana'});
  // carteira-e-pix: Dona Cida is paid from the buyer's own wallet.
  p.grana=100;
  buy(2);
  assert.deepEqual(answers().at(-1),{t:'bought',req:2,item:'brigadeiro',ok:true,grana:85});
  assert.ok((p.fastUntil??0)>sim.tick,'the brigadeiro runs');
  buy(2);
  assert.deepEqual(answers().at(-1),{t:'bought',req:2,item:'brigadeiro',ok:false,reason:'duplicate'},'a resend applies once');
  assert.equal(p.grana,85);
  // Malformed or stale taps are dropped by the room (no answer).
  const before=answers().length;
  buy(3,'pastel');buy(0);buy(4,'pacoca',round(room)+1);
  assert.equal(answers().length,before);
  p.x+=10;buy(5,'pacoca');
  assert.deepEqual(answers().at(-1),{t:'bought',req:5,item:'pacoca',ok:false,reason:'away'});
  // The purchase is an event of the next step, and the frames carry the Grana.
  room.advance(t+=50);
  const dec=new FrameDecoder();let grana:number|undefined,camp:number|undefined;
  for(const f of a.frames){const r=dec.decode(f);if(r.ok&&r.view.objective)grana=r.view.objective.grana;if(r.ok&&r.view.camp)camp=r.view.camp.grana;}
  assert.equal(grana,85);assert.equal(camp,85,'the camp block carries the same Grana: this viewer\'s wallet');
});

test('the car\'s rope through the room (D-052): {t:\'puxar\'} answers {t:\'puxou\'} with the refusals, a resent req is duplicate, the frames carry the rope',async()=>{
  const {room,a,ana,t:t0}=await cityRoom(77,0);
  let t=t0;
  const sim=room.sim,chaveiro=sim.run.chaveiro!;
  for(let i=0;i<5;i++)room.advance(t+=50);
  const answers=()=>a.messages.filter(m=>m.t==='puxou');
  const pull=(req:number,on:unknown=true,r=round(room))=>say(room,a,{t:'puxar',round:r,req,on},t+=10);
  const p=sim.players.get(ana)!,car=chaveiro.state.car;
  p.x=car.x;p.y=car.y+10;
  pull(1);
  assert.deepEqual(answers().at(-1),{t:'puxou',req:1,ok:false,reason:'longe'});
  p.y=car.y+2;
  pull(2);
  assert.deepEqual(answers().at(-1),{t:'puxou',req:2,ok:true});
  pull(2);
  assert.deepEqual(answers().at(-1),{t:'puxou',req:2,ok:false,reason:'duplicate'});
  pull(3,true,round(room)+1);
  assert.deepEqual(answers().at(-1),{t:'puxou',req:3,ok:false,reason:'fase'},'another round');
  // Malformed taps are dropped (no answer).
  const before=answers().length;
  pull(0);pull(4,'sim');
  assert.equal(answers().length,before);
  room.advance(t+=50);
  const dec=new FrameDecoder();let rope:string|undefined;
  for(const f of a.frames){const r=dec.decode(f);if(r.ok&&r.view.objective)rope=r.view.objective.car.rope;}
  assert.equal(rope,ana,'everyone sees who holds the rope');
  pull(5,false);
  assert.deepEqual(answers().at(-1),{t:'puxou',req:5,ok:true});
  assert.equal(car.rope,undefined);
});

test('city checkpoint with the chaveiro objective: the round-2 intermission resumes on a fresh room simulation and plays on alike',async()=>{
  const loaded=await cityTerrainFrom(cityText,manifest.hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const BOTS=[['bot-1','cidadao-comum'],['bot-2','clt-cansado'],['bot-3','feirante']] as const;
  const make=()=>{const s=new Simulation(11,{world:'cidade',terrain:loaded.terrain,cityStructures:true,objective:'chaveiro'});for(const [id,c] of BOTS)s.addBot(id,id,c);return s;};
  const sim=make(),bots=new RoomBots();
  BOTS.forEach(([id],i)=>bots.add(id,i));
  sim.resetRun();
  for(let i=0,before=0;i<20*60*8;i++){
    bots.think(sim);sim.step(sim.tick*50);
    if(sim.world.round.index!==before&&sim.world.round.index===2)break;
    before=sim.world.round.index;assert.equal(sim.outcome,undefined);
  }
  assert.equal(sim.world.round.index,2);assert.equal(sim.world.round.phase,'prepare');
  const cs=sim.run.state().chaveiro!;
  assert.ok(cs&&cs.moto.s>0,'mid-route');
  const fresh=make();
  assert.equal(fresh.resume(JSON.parse(JSON.stringify(sim.checkpoint())) as SimCheckpoint),true);
  assert.equal(stateHash(fresh.run.state()),stateHash(sim.run.state()));
  assert.deepEqual(fresh.objectiveView(),sim.objectiveView(),'the same objective view (route rebuilt from the seed)');
  for(const m of [sim.world.enemies,sim.world.projectiles,sim.world.telegraphs])m.clear();
  (sim as unknown as {botInputs:Map<string,unknown>}).botInputs.clear();
  for(const p of sim.players.values()){p.ack=0;delete p.target;}
  const end=sim.world.round.phaseEndsTick+20*10;
  while(sim.tick<end){sim.step(sim.tick*50);fresh.step(fresh.tick*50);
    assert.equal(stateHash({world:fresh.world.state(),systems:fresh.run.state()}),stateHash({world:sim.world.state(),systems:sim.run.state()}),`tick ${sim.tick}`);}
  assert.equal(sim.world.round.phase,'wave');
});

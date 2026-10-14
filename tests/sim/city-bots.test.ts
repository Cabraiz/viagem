/**
 * cidade-10 (PREP): the room bots play the Cidade Nevada (real asset, real Simulation, the room's own driver RoomBots).
 * Their long walks follow the streets (src/sim/city/bot-routes.ts: a flow field per goal cell on the hero grid, small
 * shared LRU) instead of a straight line plus a sidestep.
 *  1. ACCEPTANCE (a): one bot at the helicopter (asset `inicio`, tutorial on) reaches the plaza in round 1 on 5 seeds,
 *     and never stalls on the way: its street distance to the plaza drops by at least MIN_PROGRESS every 5 s until it
 *     arrives (the straight-line bot of before parked ~10 s against the planters south of the wall). Arrival times and
 *     falls are logged.
 *  2. ACCEPTANCE (b): in the round-2 intermission a bot leaves the base, gathers at a crate and is back in the base
 *     before the horn's deadline (the wave's start), without the left-behind line (3 seeds). The trip is logged.
 *     Towers on: the lone bot is also the builder (torres-ajustes: it only walks to an obra on a trip back in time).
 *  2b. torres-ajustes: every bot (a lone builder, and three) is inside the base when each wave of rounds 2–6 starts.
 *  3. The route cache stays within BOT_ROUTE_FIELDS fields whatever the goals, and a route is the same after its field
 *     was evicted and rebuilt (a pure function of city and goal cell: decisions stay deterministic).
 *  4. Same seed, same run: three bots in the city twice give the same state hash (bot memories included).
 *  5. Island and endless untouched: no route field is built and no city memory is written there.
 * D-031: results only (positions, events, ticks); no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {walkable,type Point} from '../../src/maps/world.ts';
import {STRAIGHT_COST,UNREACHABLE} from '../../src/maps/flowfield.ts';
import {SIM_HZ,ticks,type SimEvent} from '../../src/contract/types.ts';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {BOT_ROUTE_BYTES_PER_CELL,BOT_ROUTE_FIELDS,botRoute,botRouteFields,botRouteGoal,botRouteStats} from '../../src/sim/city/bot-routes.ts';
import {LEFT_BEHIND_KEY} from '../../src/sim/stonewards/system.ts';
import {TUTORIAL_PLAN} from '../../src/sim/city/tutorial.ts';
import {FLEE_CAP_SECONDS} from '../../src/sim/director.ts';

// ---------- The real city ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
/** The judge: an independent planner ("in the plaza" = insideBase, street distance = its plaza field). */
const JUDGE=cityPlanner(city);
const toPlaza=(p:Point)=>{const c=JUDGE.plazaField.costAt(p.x,p.y);return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*JUDGE.plazaField.cellSize;};
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(1)} s`;
const fmt=(p:Point)=>`(${p.x.toFixed(1)},${p.y.toFixed(1)})`;
const CLASSES=['cidadao-comum','clt-cansado','feirante'];
/** Street metres a walking bot must gain on the plaza every 5 s (it walks ~10 at the city's ~2 u/s). */
const MIN_PROGRESS=2;

/** A real city run driven by the room's bot driver; `count` bots in slots 0..count-1. */
function cityRun(seed:number,count:number){
  const sim=new Simulation(seed,{world:'cidade',terrain:city}),bots=new RoomBots();
  sim.botState=()=>bots.state();
  const ids=Array.from({length:count},(_,i)=>`bot-${i+1}`);
  ids.forEach((id,i)=>{sim.addBot(id,id,CLASSES[(seed+i)%CLASSES.length]);bots.add(id,i);});
  sim.resetRun();
  const step=()=>{bots.think(sim);return sim.step();};
  return {sim,bots,ids,step};
}

test('ACCEPTANCE (a): a bot at the helicopter walks the streets to the plaza in round 1 (5 seeds), never stalling',()=>{
  const lines:string[]=[];
  for(let seed=1;seed<=5;seed++){
    const {sim,ids:[id],step}=cityRun(seed,1),bot=()=>sim.players.get(id)!;
    const cap=ticks(3+TUTORIAL_PLAN.capSeconds+FLEE_CAP_SECONDS+5);
    let arrived:number|undefined,ended:number|undefined,falls=0,last=toPlaza(bot());
    const start=last,progress:number[]=[];
    for(let i=0;i<cap&&ended===undefined;i++){
      for(const e of step()){
        if(e.type==='downed'&&e.player===id)falls++;
        if(e.type==='round'&&e.index===1&&e.phase==='end')ended=sim.tick;
      }
      const p=bot();
      if(arrived===undefined&&!p.downed&&JUDGE.insideBase(p))arrived=sim.tick;
      if(arrived===undefined&&sim.tick%ticks(5)===0){
        const now=toPlaza(p),gain=last-now;progress.push(gain);
        assert.ok(p.downed||gain>=MIN_PROGRESS,`seed ${seed}: at ${secs(sim.tick)} the bot at ${fmt(p)} gained ${gain.toFixed(1)} u on the plaza in 5 s (${now.toFixed(1)} u left)`);
        last=now;
      }
    }
    lines.push(`seed ${seed}: plaza at ${arrived===undefined?'never':secs(arrived)} (${start.toFixed(1)} u of street), falls ${falls}, `
      +`slowest 5 s ${Math.min(...progress).toFixed(1)} u, round 1 ended ${ended===undefined?'-':secs(ended)}`);
    assert.ok(arrived!==undefined,`seed ${seed}: the bot reached the plaza in round 1`);
    assert.ok(ended!==undefined,`seed ${seed}: round 1 ended`);
  }
  console.log(`[cidade-10] helicopter → plaza, one room bot:\n  ${lines.join('\n  ')}`);
});

test('ACCEPTANCE (b): in the intermission a bot walks to a crate and back into the base before the horn deadline (3 seeds)',()=>{
  const lines:string[]=[];
  for(let seed=1;seed<=3;seed++){
    const {sim,ids:[id],step}=cityRun(seed,1),bot=()=>sim.players.get(id)!,world=sim.world;
    const balance=()=>sim.run.stonewards.state.balance.units;
    let left:number|undefined,back:number|undefined,horn:{tick:number;endsTick:number}|undefined,wave:number|undefined,far=0,gained=0;
    let before=balance(),inBaseAtWave=false,leftBehind=false;
    for(let i=0;i<ticks(400)&&wave===undefined;i++){
      const events:SimEvent[]=step(),p=bot();
      for(const e of events){
        if(e.type==='horn'&&world.round.index===2)horn={tick:sim.tick,endsTick:e.endsTick};
        if(e.type==='round'&&e.index===2&&e.phase==='wave'){wave=sim.tick;inBaseAtWave=JUDGE.insideBase(p);}
        if(e.type==='say'&&e.key===LEFT_BEHIND_KEY&&e.source===id)leftBehind=true;
      }
      const now=balance();
      if(world.round.index===2&&world.round.phase==='prepare'){
        if(now>before)gained+=now-before;
        const inside=JUDGE.insideBase(p);
        if(left===undefined&&!inside)left=sim.tick;
        if(left!==undefined&&back===undefined&&inside&&gained>0)back=sim.tick;
        far=Math.max(far,toPlaza(p));
      }
      before=now;
    }
    lines.push(`seed ${seed}: left the base ${left===undefined?'never':secs(left)}, out to ${far.toFixed(1)} u of street, gathered ${gained}, `
      +`back ${back===undefined?'never':secs(back)}, horn ${horn?`${secs(horn.tick)} (deadline ${secs(horn.endsTick)})`:'none'}, wave ${wave===undefined?'-':secs(wave)}`);
    assert.ok(wave!==undefined,`seed ${seed}: round 2 started`);
    assert.ok(left!==undefined,`seed ${seed}: the bot left the base for the crates`);
    assert.ok(gained>0,`seed ${seed}: the bot gathered at a crate`);
    assert.ok(back!==undefined&&back<=wave!,`seed ${seed}: the bot was back in the base before the wave`);
    if(horn)assert.ok(back!<=horn.endsTick,`seed ${seed}: back ${secs(back!)} after the horn's deadline ${secs(horn.endsTick)}`);
    assert.ok(inBaseAtWave,`seed ${seed}: in the base when round 2 started`);
    assert.equal(leftBehind,false,`seed ${seed}: no left-behind line for the bot`);
  }
  console.log(`[cidade-10] intermission crate trip, one room bot:\n  ${lines.join('\n  ')}`);
});

test('the route cache stays within BOT_ROUTE_FIELDS and a route is the same after its field was rebuilt',()=>{
  const from=city.asset.points.inicio,out={x:0,y:0},again={x:0,y:0};
  const goalA=botRouteGoal(city,city.asset.points.praca);
  assert.ok(goalA>=0,'the plaza has an open goal cell');
  assert.equal(botRoute(city,from,city.asset.points.praca,out),goalA,'the helicopter is routed (far, behind buildings)');
  const builds=botRouteStats.builds;
  // Many other goals: every spawn and mouth, then the open cells along a row of the map.
  const p=city.asset.points,goals:Point[]=[p.spawnN,p.spawnS,p.spawnL,p.spawnO,p.bocas.N,p.bocas.S,p.bocas.L,p.bocas.O];
  for(let x=10;goals.length<3*BOT_ROUTE_FIELDS;x+=4)if(walkable({x,y:p.praca.y},city))goals.push({x,y:p.praca.y});
  for(const g of goals){botRoute(city,from,g,{x:0,y:0});assert.ok(botRouteFields()<=BOT_ROUTE_FIELDS,`${botRouteFields()} fields cached`);}
  assert.ok(botRouteStats.builds-builds>=BOT_ROUTE_FIELDS,'the goals did not all fit: fields were evicted and reused');
  assert.equal(botRoute(city,from,city.asset.points.praca,again),goalA);
  assert.deepEqual(again,out,'same direction from a rebuilt field');
  const cells=city.asset.cells.w*city.asset.cells.h,bytes=BOT_ROUTE_FIELDS*BOT_ROUTE_BYTES_PER_CELL*cells;
  console.log(`[cidade-10] bot route LRU: ${BOT_ROUTE_FIELDS} fields × ${BOT_ROUTE_BYTES_PER_CELL} B × ${cells} cells = ${(bytes/2**20).toFixed(2)} MiB at most, plus ${cells} B of grid per city`);
});

test('torres-ajustes: every bot is inside the base when each wave of rounds 2–6 starts (the builder comes back in time)',()=>{
  const lines:string[]=[];
  for(const [seed,count] of [[1,1],[2,1],[1,3]] as const){
    const {sim,bots,ids,step}=cityRun(seed,count);
    let built=0;
    const build=sim.build.bind(sim),upgrade=sim.upgrade.bind(sim),repair=sim.repair.bind(sim);
    const count1=<R extends {ok:boolean}>(r:R)=>{if(r.ok)built++;return r;};
    sim.build=(a,b,c)=>count1(build(a,b,c));sim.upgrade=(a,b,c,d)=>count1(upgrade(a,b,c,d));sim.repair=(a,b,c)=>count1(repair(a,b,c));
    const outside:string[]=[];
    for(let i=0;i<ticks(15*60);i++){
      // Nobody falls: the check is about where they stand when the wave starts, not about surviving it.
      for(const id of ids)sim.players.get(id)!.invulnerableUntil=Number.MAX_SAFE_INTEGER;
      let wave:number|undefined;
      for(const e of step())if(e.type==='round'&&e.phase==='wave'&&e.index>=2&&e.index<=6)wave=e.index;
      if(wave!==undefined)for(const id of ids){const p=sim.players.get(id)!;if(!JUDGE.insideBase(p))outside.push(`round ${wave}: ${id} at ${fmt(p)}`);}
      if(wave===6)break;
    }
    lines.push(`seed ${seed}, ${count} bot(s): to round ${sim.world.round.index}, ${built} tower orders, ${bots.built} by the room bots, outside at a wave start: ${outside.length}`);
    assert.ok(sim.world.round.index>=6,`seed ${seed}: reached round 6`);
    assert.ok(built>0,`seed ${seed}: the builder still built`);
    assert.deepEqual(outside,[],`seed ${seed}, ${count} bot(s): in the base at every wave start`);
  }
  console.log(`[torres-ajustes] in the base at the wave:\n  ${lines.join('\n  ')}`);
});

test('same seed, same city run: three bots twice give the same state (their memories included)',()=>{
  const run=()=>{const r=cityRun(7,3);for(let i=0;i<ticks(70);i++)r.step();return {hash:r.sim.stateHash(),at:r.ids.map(id=>fmt(r.sim.players.get(id)!))};};
  const a=run(),b=run();
  assert.deepEqual(b,a);
});

test('island and endless untouched: no route field, no city memory',()=>{
  for(const world of ['ilha','infinito'] as const){
    const sim=new Simulation(5,{world}),bots=new RoomBots(),builds=botRouteStats.builds;
    ['bot-1','bot-2','bot-3'].forEach((id,i)=>{sim.addBot(id,id,CLASSES[i]);bots.add(id,i);});
    sim.resetRun();
    for(let i=0;i<ticks(60);i++){bots.think(sim);sim.step();}
    assert.equal(botRouteStats.builds,builds,`${world}: no route field built`);
    for(const m of bots.state())for(const key of ['rescueGoal','escortGoal','huntGoal','homing'])assert.equal(key in m.memory,false,`${world}: ${m.id} has no ${key}`);
  }
});

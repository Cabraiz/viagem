// Card NEW-20261028-ORQ-escuridao-justa (the E2 audit, 28/10, item 1): the dark must not take a hero doing what the
// objective says ("Junte caixas e volte ao Uno"). On the real match (Cidade Nevada, the nests, the manual combat, a solo
// with no bots: nobody else is company), from beside the Uno to each start crate within REACH u of it, open it and walk
// back, at the slow loot walk (half the hero's real one), in the minuto de Minerva and again after it (the dark at full
// pace), never falls to the dark. Enemies are out of it (the hero is untouchable): only the dark is under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {FlowField} from '../../src/maps/flowfield.ts';
import {walkable,type Point} from '../../src/maps/world.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {CAR_ID,SIM_HZ,ticks} from '../../src/contract/index.ts';
import {FEAR_BASE_RADIUS,FEAR_EXPLORE_RATE,FEAR_SOURCE,FEAR_TICKS} from '../../src/rules/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {lootHeroSpeed} from '../../src/sim/stonewards/loot.ts';
import {MINERVA_S} from '../../src/sim/ninhos/ninhos.ts';
import {OPEN_REACH} from '../../src/sim/crates.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,field=cityAsField(city);
/** The crates the card's goal covers: within this many units of the Uno. */
const REACH=30;
// The walker keeps clear of the Uno's body, like the room's (uno-bloqueio-corpo); see caixas-primeiro-minuto.test.ts.
const car0=placeWall(city),CAR_CLEAR=1.6,grid0=cityFlowGrid(city);
const grid={...grid0,walkable:(cx:number,cy:number)=>grid0.walkable(cx,cy)&&Math.hypot((cx+.5)*grid0.cellSize-car0.x,(cy+.5)*grid0.cellSize-car0.y)>CAR_CLEAR};
const open=(p:Point)=>walkable(p,city)&&Math.hypot(p.x-car0.x,p.y-car0.y)>CAR_CLEAR-.5;
/** The slow walk (the loot's tiers were sized with it): half the heroes' real one, a lost or hesitant player. */
const STEP=lootHeroSpeed(field)/SIM_HZ;

/** The Uno's door: the walker grid's open cell centre nearest the spawn (the spawn may sit on a cell the car's clearance takes). */
function door(spawn:Point):Point{
  const cs=grid.cellSize;let best:Point=spawn,d=Infinity;
  for(let cy=Math.floor(spawn.y/cs)-3;cy<=Math.floor(spawn.y/cs)+3;cy++)for(let cx=Math.floor(spawn.x/cs)-3;cx<=Math.floor(spawn.x/cs)+3;cx++){
    if(!grid.walkable(cx,cy))continue;
    const p={x:(cx+.5)*cs,y:(cy+.5)*cs},e=Math.hypot(p.x-spawn.x,p.y-spawn.y);
    if(e<d){d=e;best=p;}
  }
  return best;
}
type Chest={kind:string;id:string;x:number;y:number;hiddenFor?:string[]};
type Pickups={world:{pickups:Map<string,Chest>}};
function match(seed:number){
  const sim=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  sim.add('a','Ana','cidadao-comum');sim.resetRun();
  let now=1000;
  const hero=sim.players.get('a')!;
  let fell:string|undefined,most=0;
  const step=()=>{
    hero.invulnerableUntil=sim.tick+1e6;hero.hp=hero.stats.maxHp;
    sim.step(now+=50);
    for(const e of sim.world.lastEvents)if(e.type==='downed'&&e.player==='a')fell=(e as {source?:string}).source??'enemy';
    most=Math.max(most,(hero.fear??0)/FEAR_TICKS);
  };
  step();
  const car=sim.run.chaveiro!.targets().find(t=>t.id===CAR_ID)!;
  const chests=()=>[...(sim as unknown as Pickups).world.pickups.values()].filter(c=>c.kind==='chest'&&!c.hiddenFor?.includes('a'));
  return {sim,hero,step,car,chests,door:door(hero),fell:()=>fell,most:()=>most};
}

/** Walks the hero (one slow step a tick) to `goal` until within `near` u; false when stuck. */
function walkTo(m:ReturnType<typeof match>,goal:Point,near:number){
  const flow=new FlowField(grid,[goal]),dir={x:0,y:0};
  for(let t=0;t<ticks(90);t++){
    if(Math.hypot(goal.x-m.hero.x,goal.y-m.hero.y)<=near)return true;
    flow.directionAt(m.hero.x,m.hero.y,dir);
    const next={x:m.hero.x+dir.x*STEP,y:m.hero.y+dir.y*STEP};
    if(!(dir.x||dir.y)||!open(next))return false;
    m.hero.x=next.x;m.hero.y=next.y;m.step();
  }
  return false;
}
/** To the crate and standing until it opens (it leaves the map). */
function fetch(m:ReturnType<typeof match>,crate:{id:string;x:number;y:number}){
  assert.ok(walkTo(m,crate,OPEN_REACH*.8),`reaches ${crate.id} (${Math.hypot(crate.x-m.hero.x,crate.y-m.hero.y).toFixed(1)} u off)`);
  for(let t=0;t<ticks(6)&&m.chests().some(c=>c.id===crate.id);t++)m.step();
  assert.ok(!m.chests().some(c=>c.id===crate.id),`opens ${crate.id}`);
}
/** Back to the door and a moment beside the car (the dark backs off). */
function home(m:ReturnType<typeof match>){
  assert.ok(walkTo(m,m.door,1),'back at the Uno');
  for(let t=0;t<SIM_HZ;t++)m.step();
}

test(`a solo hero fetches every start crate within ${REACH} u of the Uno and walks back without falling to the dark, in the minuto de Minerva and after it`,()=>{
  for(const seed of [1,2,3,7,21,4242]){
    const m=match(seed);
    // In the minuto de Minerva the mission, word for word ("Junte caixas e volte ao Uno"): one round of the start crates
    // within REACH, the nearest next, then back (a crate he cannot take any more hides from him: crates.ts hiddenFor).
    const start=m.chests().filter(k=>Math.hypot(k.x-m.car.x,k.y-m.car.y)<=REACH),near:Chest[]=[];
    for(let c:Chest|undefined;(c=start.filter(k=>!near.includes(k)&&m.chests().some(v=>v.id===k.id))
      .sort((a,b)=>Math.hypot(a.x-m.hero.x,a.y-m.hero.y)-Math.hypot(b.x-m.hero.x,b.y-m.hero.y))[0]);){near.push(c);fetch(m,c);}
    home(m);
    assert.ok(near.length>=1,`seed ${seed}: a start crate within ${REACH} u`);
    assert.ok(m.sim.tick<ticks(MINERVA_S),`seed ${seed}: the trips fit the minuto de Minerva (${m.sim.tick/SIM_HZ} s)`);
    assert.equal(m.fell(),undefined,`seed ${seed}: fell to ${m.fell()} in the minuto de Minerva`);
    const minerva=m.most();
    // After it, the dark at full pace: one trip to where each of those crates was (a crate respawns or not: walk there,
    // stand the longest opening, come back).
    while(m.sim.tick<ticks(MINERVA_S)+2)m.step();
    for(const c of near){
      assert.ok(walkTo(m,c,OPEN_REACH*.8),`seed ${seed}: reaches ${c.id} again`);
      for(let t=0;t<ticks(3);t++)m.step();
      home(m);
    }
    assert.equal(m.fell(),undefined,`seed ${seed}: fell to ${m.fell()} after the minuto de Minerva`);
    // Room to spare: never past two thirds of the dark (the last stretch, the heartbeat, starts at 5/6).
    assert.ok(m.most()<2/3,`seed ${seed}: the dark reached ${(m.most()*100).toFixed(0)} % (Minerva ${(minerva*100).toFixed(0)} %)`);
  }
});

test('leaning on the Uno is company: anywhere at its body\'s edge the dark never builds',()=>{
  const m=match(7);
  // Around the car, a step outside its body, the farthest the room lets a hero stand from its centre on that side.
  for(let k=0;k<16;k++){
    const a=k/16*Math.PI*2;
    let spot:Point|undefined;
    for(let r=CAR_CLEAR;r<FEAR_BASE_RADIUS;r+=.25){const p={x:m.car.x+Math.cos(a)*r,y:m.car.y+Math.sin(a)*r};if(open(p)){spot=p;break;}}
    if(!spot)continue;
    for(let t=0;t<SIM_HZ;t++){m.hero.x=spot.x;m.hero.y=spot.y;m.step();}
    assert.equal(m.hero.fear,undefined,`at ${Math.hypot(spot.x-m.car.x,spot.y-m.car.y).toFixed(1)} u from the Uno`);
  }
  assert.ok(FEAR_BASE_RADIUS>=12,'the Uno\'s light (≈12 u on screen), not the old 6 u (a hero leaning on the car was 6.3 u off and fell)');
});

test(`exploring the dark grows at ${FEAR_EXPLORE_RATE}: alone the whole minuto de Minerva the hero falls only at its end`,()=>{
  const m=match(1),far={x:m.car.x+FEAR_BASE_RADIUS+20,y:m.car.y};
  const from=m.sim.tick;
  let at:number|undefined;
  for(let t=0;t<ticks(MINERVA_S)+5&&!m.fell();t++){m.hero.x=far.x;m.hero.y=far.y;m.step();if(m.fell())at=m.sim.tick-from;}
  assert.equal(m.fell(),FEAR_SOURCE);
  assert.equal(FEAR_TICKS/FEAR_EXPLORE_RATE,ticks(MINERVA_S),'the whole minuto de Minerva');
  assert.ok(at!==undefined&&Math.abs(at-ticks(MINERVA_S))<=2,`fell at ${at!/SIM_HZ} s`);
});

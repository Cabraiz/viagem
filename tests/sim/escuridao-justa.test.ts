// Card NEW-20261028-ORQ-escuridao-justa (the E2 audit, 28/10; the user: "a escuridão não mata"): the dark never takes
// anyone. On the real match (Cidade Nevada, the nests, the manual combat, a solo with no bots: nobody else is company),
// over several seeds: from beside the Uno to each start crate within REACH u of it and back, at the slow loot walk (half
// the hero's real one), then minutes alone far from the Uno, in the minuto de Minerva and after it. The dark fills up,
// nobody falls to it. Enemies are out of it (the hero is untouchable): only the dark is under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {FlowField} from '../../src/maps/flowfield.ts';
import {walkable,type Point} from '../../src/maps/world.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {CAR_ID,SIM_HZ,ticks} from '../../src/contract/index.ts';
import {FEAR_BASE_RADIUS,FEAR_TICKS} from '../../src/rules/index.ts';
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

test(`nobody falls to the dark: a solo hero fetching the start crates within ${REACH} u and then alone for minutes, every seed`,()=>{
  for(const seed of [1,2,3,7,21,4242]){
    const m=match(seed);
    // The dark only: the first wave where the solo had it before missao-proteger-uno-tempo (210 s; now 35–45 s, and the
    // Uno left alone falls to it before the darkest has run its FEAR_SECONDS).
    const nests=m.sim.run.nests!.state;nests.nextWave=nests.startTick!+ticks(210);
    // In the minuto de Minerva the mission, word for word ("Junte caixas e volte ao Uno"): one round of the start crates
    // within REACH, the nearest next, then back (a crate he cannot take any more hides from him: crates.ts hiddenFor).
    const start=m.chests().filter(k=>Math.hypot(k.x-m.car.x,k.y-m.car.y)<=REACH),near:Chest[]=[];
    for(let c:Chest|undefined;(c=start.filter(k=>!near.includes(k)&&m.chests().some(v=>v.id===k.id))
      .sort((a,b)=>Math.hypot(a.x-m.hero.x,a.y-m.hero.y)-Math.hypot(b.x-m.hero.x,b.y-m.hero.y))[0]);){near.push(c);fetch(m,c);}
    home(m);
    assert.ok(near.length>=1,`seed ${seed}: a start crate within ${REACH} u`);
    // Then far from the Uno, alone, through the end of the minute and well past the darkest (the Uno, left alone, may
    // fall to the critters and end the run: only the live run counts, and it must hold the darkest a full FEAR_SECONDS).
    const far={x:m.car.x+FEAR_BASE_RADIUS+20,y:m.car.y},until=Math.max(m.sim.tick,ticks(MINERVA_S))+3*FEAR_TICKS;
    const live=()=>m.sim.run.chaveiro!.state.ended===undefined;
    let darkest=0;
    while(m.sim.tick<until&&live()){m.hero.x=far.x;m.hero.y=far.y;m.step();if(live()&&m.hero.fear===FEAR_TICKS)darkest++;}
    assert.ok(darkest>=FEAR_TICKS,`seed ${seed}: the darkest held ${darkest/SIM_HZ} s of live run`);
    assert.equal(m.fell(),undefined,`seed ${seed}: fell to ${m.fell()}`);
    assert.equal(m.hero.downed,undefined,`seed ${seed}: on their feet`);
    // Back at the Uno the dark goes as before (while the run lasts: the dark stops with it).
    if(live()){
      home(m);for(let t=0;t<ticks(2);t++)m.step();
      if(live())assert.equal(m.hero.fear,undefined,`seed ${seed}: the Uno backs the dark off`);
    }
  }
});

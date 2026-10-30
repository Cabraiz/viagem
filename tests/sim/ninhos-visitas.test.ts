/**
 * NEW-20261028-ORQ-ritmo-morto-e-viaduto: the visitors of the minuto de Minerva (sono.ts VISIT_FROM). The first 2 min
 * were dead (the horde held, the first level-up after 4 min in half the 1p runs): while Minerva holds the horde, a few
 * of the weakest sleepers around an armed hero walk up to him, on the real Cidade Nevada, mode 'ninhos' (chaveiro).
 * D-031: sim ticks and states only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {BASE_STATS,ticks,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {MODE,VISIT_COUNT,VISIT_EVERY,VISIT_FAR,VISIT_FROM,VISIT_NEAR,VISIT_QUIET} from '../../src/sim/ninhos/sono.ts';
import {NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

/**
 * A run with the 120 s minute the visits were made for: since missao-proteger-uno-tempo the minute is 30 s (MINERVA_S),
 * over before VISIT_FROM, so the visits wait for a longer minute (the rooms' option, a test's).
 */
function run(seed=1):{world:SimWorld;sys:RunSystems}{
  const saved=NEST_PACE.minerva;NEST_PACE.minerva=120;
  try{
    const world=new SimWorld({terrain:city.fork(),seed,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode:'ninhos'});
    world.step();
    return {world,sys};
  }finally{NEST_PACE.minerva=saved;}
}
/** A hero that never falls; `unarmed`: the manual combat's inventory (build.hand) with no weapon in it. */
function addPlayer(world:SimWorld,id:string,x:number,y:number,unarmed=false){
  const p={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[],...(unarmed?{hand:0}:{})},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  world.players.set(id,p);return p;
}
/** Whether a body of radius r walks the straight segment a→b with no wall on it (sampled every quarter unit). */
function straight(a:{x:number;y:number},b:{x:number;y:number},r=.5){
  const n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.25);
  for(let i=0;i<=n;i++)if(!city.clearDisc(a.x+(b.x-a.x)*i/n,a.y+(b.y-a.y)*i/n,r))return false;
  return true;
}
/**
 * A clear spot with no sleeper within 4 u (the hero wakes nobody by standing there) and a few between VISIT_NEAR and
 * VISIT_FAR u; the VISIT_COUNT the visit picks (the weakest, then the nearest, then plan order: sono.ts visit) have a
 * straight open way to it. A pick behind a block wall made the walk-up a matter of the map: since the Uno's map v7 the
 * first spot's two came round a block, longer than VISIT_EVERY. Off the plaza's barricades too (the mask has none):
 * a hero inside one has his visitors bash it.
 */
function spot(sono:NonNullable<ReturnType<RunSystems['sono']>>,sys:RunSystems,world:SimWorld){
  const hp=(id:string)=>world.enemies.get(id)?.maxHp??sono.sleepers.get(id)?.maxHp??Infinity;
  const barricades=sys.stonewards.state.barricades??[];
  for(const b of sono.bodies)for(let k=0;k<8;k++){
    const x=b.home.x+Math.cos(k*Math.PI/4)*VISIT_NEAR,y=b.home.y+Math.sin(k*Math.PI/4)*VISIT_NEAR;
    const d=sono.bodies.map(o=>Math.hypot(o.home.x-x,o.home.y-y));
    const ring=sono.bodies.map((o,i)=>({o,d:d[i]!,i})).filter(r=>r.d>=VISIT_NEAR&&r.d<=VISIT_FAR);
    const pick=[...ring].sort((a,b)=>hp(a.o.id)-hp(b.o.id)||a.d-b.d||a.i-b.i).slice(0,VISIT_COUNT);
    if(d.every(v=>v>4)&&ring.length>=VISIT_COUNT+2&&city.clearDisc(x,y,.5)&&barricades.every(c=>Math.hypot(c.x-x,c.y-y)>c.r+2)&&pick.every(r=>straight(r.o.home,{x,y})))return {x,y};
  }
  throw new Error('no spot');
}
const visitors=(world:SimWorld)=>[...world.enemies.values()].filter(e=>e.memory?.visita===1);

test('the minuto de Minerva sends VISIT_COUNT of the weakest sleepers around an armed hero from VISIT_FROM s, caçando, and they walk up to him and hit him',()=>{
  const {world,sys}=run();
  const sono=sys.sono()!,until=sys.nests!.state.minervaUntil!;
  assert.ok(until-world.tick>ticks(VISIT_FROM+VISIT_EVERY),'the minute lasts past two visits');
  const at=spot(sono,sys,world);
  const p=addPlayer(world,'p1',at.x,at.y);
  const start=world.tick;
  while(world.tick<start+ticks(VISIT_FROM)-2)world.step();
  assert.equal(visitors(world).length,0,'nobody before VISIT_FROM');
  while(world.tick<start+ticks(VISIT_FROM)+2)world.step();
  const first=visitors(world);
  assert.equal(first.length,VISIT_COUNT,'VISIT_COUNT came');
  const ring=sono.bodies.filter(b=>{const d=Math.hypot(b.home.x-p.x,b.home.y-p.y);return d>=VISIT_NEAR&&d<=VISIT_FAR;});
  // The VISIT_COUNT lowest max hp of the ring (they need not tie: the enemy kinds vary).
  const weakest=ring.map(b=>world.enemies.get(b.id)?.maxHp??sono.sleepers.get(b.id)?.maxHp??Infinity).sort((a,b)=>a-b).slice(0,VISIT_COUNT);
  for(const e of first)assert.equal(e.memory!.sono,MODE.cacando);
  assert.deepEqual(first.map(e=>e.maxHp).sort((a,b)=>a-b),weakest,'the visitors are the weakest of the ring');
  // They walk to him (the city's streets, maybe around a block) and hit him; nothing else moves (none within 4 u).
  const hp=p.hp;
  while(world.tick<start+ticks(VISIT_FROM+VISIT_EVERY)-2&&p.hp===hp)world.step();
  assert.ok(p.hp<hp,'a visitor reached the hero before the next visit');
  // The next visit comes VISIT_EVERY s later (the first two still up: at most VISIT_ALIVE near him, so it may wait).
  while(world.tick<start+ticks(VISIT_FROM+VISIT_EVERY)+2)world.step();
  assert.ok(visitors(world).length>=first.length,'visitors keep coming');
  sys.dispose();
});

test('an unarmed hero (manual combat, no weapon yet) gets no visitor',()=>{
  const {world,sys}=run();
  const at=spot(sys.sono()!,sys,world);
  addPlayer(world,'p1',at.x,at.y,true);
  while(world.tick<ticks(VISIT_FROM+VISIT_EVERY+2))world.step();
  assert.equal(visitors(world).length,0);
  sys.dispose();
});

test('a team that just killed something gets no visitor until VISIT_QUIET s after the kill',()=>{
  const {world,sys}=run();
  const at=spot(sys.sono()!,sys,world);
  addPlayer(world,'p1',at.x,at.y);
  const start=world.tick,kill=start+ticks(VISIT_FROM)-ticks(1);
  while(world.tick<kill)world.step();
  // A kill of its own (the sim emits it as the hero's shot lands), far from any sleeper's ear.
  world.emit({type:'kill',enemy:'x',kind:'x',by:'p1',x:-1e3,y:-1e3} as Parameters<SimWorld['emit']>[0]);
  while(world.tick<kill+ticks(VISIT_QUIET)-2)world.step();
  assert.equal(visitors(world).length,0,'no visit inside the quiet');
  while(world.tick<kill+ticks(VISIT_QUIET)+ticks(1)+2)world.step();
  assert.equal(visitors(world).length,VISIT_COUNT,'the visit comes once the team is quiet');
  sys.dispose();
});

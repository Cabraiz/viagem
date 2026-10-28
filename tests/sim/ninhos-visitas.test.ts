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

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function run(seed=1):{world:SimWorld;sys:RunSystems}{
  const world=new SimWorld({terrain:city.fork(),seed,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode:'ninhos'});
  world.step();
  return {world,sys};
}
/** A hero that never falls; `unarmed`: the manual combat's inventory (build.hand) with no weapon in it. */
function addPlayer(world:SimWorld,id:string,x:number,y:number,unarmed=false){
  const p={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[],...(unarmed?{hand:0}:{})},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  world.players.set(id,p);return p;
}
/** A clear spot with no sleeper within 4 u (the hero wakes nobody by standing there) and a few between VISIT_NEAR and VISIT_FAR u. */
function spot(sono:NonNullable<ReturnType<RunSystems['sono']>>){
  for(const b of sono.bodies)for(let k=0;k<8;k++){
    const x=b.home.x+Math.cos(k*Math.PI/4)*VISIT_NEAR,y=b.home.y+Math.sin(k*Math.PI/4)*VISIT_NEAR;
    const d=sono.bodies.map(o=>Math.hypot(o.home.x-x,o.home.y-y));
    if(d.every(v=>v>4)&&d.filter(v=>v>=VISIT_NEAR&&v<=VISIT_FAR).length>=VISIT_COUNT+2&&city.clearDisc(x,y,.5))return {x,y};
  }
  throw new Error('no spot');
}
const visitors=(world:SimWorld)=>[...world.enemies.values()].filter(e=>e.memory?.visita===1);

test('the minuto de Minerva sends VISIT_COUNT of the weakest sleepers around an armed hero from VISIT_FROM s, caçando, and they walk up to him and hit him',()=>{
  const {world,sys}=run();
  const sono=sys.sono()!,until=sys.nests!.state.minervaUntil!;
  assert.ok(until-world.tick>ticks(VISIT_FROM+VISIT_EVERY),'the minute lasts past two visits');
  const at=spot(sono);
  const p=addPlayer(world,'p1',at.x,at.y);
  const start=world.tick;
  while(world.tick<start+ticks(VISIT_FROM)-2)world.step();
  assert.equal(visitors(world).length,0,'nobody before VISIT_FROM');
  while(world.tick<start+ticks(VISIT_FROM)+2)world.step();
  const first=visitors(world);
  assert.equal(first.length,VISIT_COUNT,'VISIT_COUNT came');
  const ring=sono.bodies.filter(b=>{const d=Math.hypot(b.home.x-p.x,b.home.y-p.y);return d>=VISIT_NEAR&&d<=VISIT_FAR;});
  const weakest=Math.min(...ring.map(b=>world.enemies.get(b.id)?.maxHp??sono.sleepers.get(b.id)?.maxHp??Infinity));
  for(const e of first){
    assert.equal(e.memory!.sono,MODE.cacando);
    assert.equal(e.maxHp,weakest,`${e.id} is among the weakest of the ring`);
  }
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
  const at=spot(sys.sono()!);
  addPlayer(world,'p1',at.x,at.y,true);
  while(world.tick<ticks(VISIT_FROM+VISIT_EVERY+2))world.step();
  assert.equal(visitors(world).length,0);
  sys.dispose();
});

test('a team that just killed something gets no visitor until VISIT_QUIET s after the kill',()=>{
  const {world,sys}=run();
  const at=spot(sys.sono()!);
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

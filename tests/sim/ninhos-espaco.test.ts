/**
 * Card NEW-20261017-ORQ-ninhos-perto-ataca-20x, the user's pseudo-collision: in mode 'ninhos' no critter stands inside
 * another (always SPACING_GAP between bodies), the awake ones step off the sleepers, and none stands inside a hero
 * (enemies/ai.ts separation). An assembled city run in mode 'ninhos' (the slice-1 population), bodies placed by hand.
 * D-031: sim ticks only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {RADIUS as PLAYER_RADIUS} from '../../src/maps/world.ts';
import {BASE_STATS,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {SPACING_GAP} from '../../src/sim/enemies/ai.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PLAZA=city.asset.points.praca;

function run(mode:'ninhos'|'rounds'){
  const world=new SimWorld({terrain:city.fork(),seed:3,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode,nestPopulation:1});
  world.step();
  return {world,sys};
}
function addPlayer(world:SimWorld,id:string,x:number,y:number){
  const p={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x,y,ack:0,score:0} as SimPlayer;
  world.players.set(id,p);return p;
}
const gapOf=(a:EnemyState,b:{x:number;y:number},r:number)=>Math.hypot(a.x-b.x,a.y-b.y)-a.radius-r;

test('ninhos: a crowd dropped on one spot spreads out to SPACING_GAP between every two bodies; the rounds mode keeps its tuned (gapless) crowd',()=>{
  for(const mode of ['ninhos','rounds'] as const){
    const {world,sys}=run(mode);
    const crowd:EnemyState[]=[];
    for(let i=0;i<12;i++){const e=createEnemy(world,'bebado',{x:PLAZA.x+(i%4)*.05,y:PLAZA.y+Math.floor(i/4)*.05},1);e.speed=0;crowd.push(e);}
    for(let t=0;t<200;t++)world.step();
    let worst=Infinity;
    for(let i=0;i<crowd.length;i++)for(let j=i+1;j<crowd.length;j++)worst=Math.min(worst,gapOf(crowd[i],crowd[j],crowd[j].radius));
    if(mode==='ninhos')assert.ok(worst>=SPACING_GAP*.8,`ninhos: the tightest pair ${worst.toFixed(3)} u apart`);
    else assert.ok(worst>-.02&&worst<SPACING_GAP*.8,`rounds: touching, no gap (${worst.toFixed(3)})`);
    sys.dispose();
  }
});

test('ninhos: an awake critter steps off a sleeper it stands on, and off a hero (never inside one, still at contact range)',()=>{
  const {world,sys}=run('ninhos');
  const sleeper=[...sys.sono()!.bodies].map(b=>world.sleepers!.get(b.id)!).find(Boolean)!;
  const e=createEnemy(world,'bebado',{x:sleeper.x+.05,y:sleeper.y},1);e.speed=0;
  for(let t=0;t<120;t++)world.step();
  assert.ok(world.sleepers!.has(sleeper.id),'it sleeps on');
  assert.ok(gapOf(e,sleeper,sleeper.radius)>=SPACING_GAP*.8,`off the sleeper: ${gapOf(e,sleeper,sleeper.radius).toFixed(3)}`);
  // A hero on top of a still critter: pushed out to the hero's edge (no extra gap there).
  const p=addPlayer(world,'p1',PLAZA.x+30,PLAZA.y+30);
  const f=createEnemy(world,'bebado',{x:p.x+.05,y:p.y},1);f.speed=0;
  for(let t=0;t<120;t++){p.hp=1e6;world.step();}
  const g=gapOf(f,p,PLAYER_RADIUS);
  assert.ok(g>=-.02&&g<=.1,`at the hero's edge: ${g.toFixed(3)}`);
  sys.dispose();
});

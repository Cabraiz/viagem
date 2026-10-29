/**
 * NEW-20261028-ORQ-ritmo-morto-e-viaduto: in mode 'ninhos' the first level costs FIRST_LEVEL_XP by the match's heroes
 * (progression.ts), counted at the run's first step and fixed for the run; levels 2+ cost xpToNext as ever. Other modes
 * keep xpToNext(1). Real Cidade Nevada, D-031: sim ticks and states only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {BASE_STATS,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {FIRST_LEVEL_XP,firstLevelXp,xpToNext} from '../../src/sim/progression.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

function run(heroes:number,mode?:'ninhos'){
  const world=new SimWorld({terrain:city.fork(),seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  for(let i=0;i<heroes;i++){
    const id=`p${i+1}`;
    world.players.set(id,{id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
      stats:{...BASE_STATS},weaponReady:{},x:0,y:0,ack:0,score:0} as SimPlayer);
  }
  world.players.set('s',{id:'s',classId:'x',hp:100,online:true,spectator:true,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS},weaponReady:{},x:0,y:0,ack:0,score:0} as SimPlayer);
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',...(mode?{mode}:{})});
  world.step();
  return {world,sys};
}

test('mode ninhos: the first level costs FIRST_LEVEL_XP by the heroes (spectators out), one leaving does not move it, level 2 costs xpToNext(2)',()=>{
  assert.ok(FIRST_LEVEL_XP.every((v,i)=>i===0||v>=FIRST_LEVEL_XP[i-1]),'more heroes never cost less');
  for(const n of [1,3,6]){
    const {world,sys}=run(n,'ninhos');
    assert.equal(world.team.nextXp,firstLevelXp(n),`${n} heroes`);
    world.players.delete('p1');
    world.step();
    assert.equal(world.team.nextXp,firstLevelXp(n),'a hero leaving keeps the bar');
    world.team.xp=world.team.nextXp;world.step();
    assert.equal(world.team.level,2);
    assert.equal(world.team.nextXp,xpToNext(2));
    sys.dispose();
  }
});

test('other modes keep xpToNext(1) whatever the team',()=>{
  const {world,sys}=run(6);
  assert.equal(world.team.nextXp,xpToNext(1));
  sys.dispose();
});

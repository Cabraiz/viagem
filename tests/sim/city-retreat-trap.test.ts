/**
 * BUG-20261012-E1-recuo-parado-na-praca: retreating bodies inside the plaza, with the four barricades up around them,
 * had no exit on the enemy grid and stood still until the round cap. They now walk out over the barricades on the
 * barricade-free planner (damage 0) and leave by an avenue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {BASE_STATS,type EnemyState,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems} from '../../src/sim/assemble.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const city=(await cityTerrainFrom(TEXT,HASH)).terrain;

test('retreating bodies trapped in the plaza by standing barricades walk out instead of freezing until the cap',()=>{
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city,seed:4242,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false});
  const planner=sys.avenues!,base=planner.plazaCenter;
  players.set('a',{id:'a',classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:base.x,y:base.y,ack:0,score:0} as SimPlayer);
  for(let i=0;i<2000&&world.round.phase!=='wave';i++)world.step();
  assert.equal(world.round.phase,'wave');
  const bars=sys.stonewards.state.barricades??[];
  assert.ok(bars.length===4&&bars.every(b=>!b.down),'the four barricades stand');
  // Like the bodies of the report: inside the walled plaza, retreating (damage 0), after the wave timed out.
  const ids:string[]=[];
  const spots=[[-1.5,0],[0,1.5],[1.5,1.5],[-1.5,1.5],[0,-1.5],[1.5,0]].map(([dx,dy])=>({x:base.x+dx,y:base.y+dy})).filter(p=>planner.insideBase(p)).slice(0,3);
  assert.ok(spots.length>=2,'spots inside the base');
  for(const p of spots){
    const e=createEnemy(world,'bebado',p);e.memory={...(e.memory??{}),retreat:1};e.damage=0;
    sys.director.state.retreating.push({id:e.id,x:p.x,y:p.y,untilTick:world.tick+20*60});ids.push(e.id);
  }
  assert.ok(ids.every(id=>planner.insideBase(world.enemies.get(id)!)),'they start inside the base');
  const still=new Map<string,{x:number;y:number;since:number}>();
  let worst=0;
  for(let t=0;t<20*20;t++){
    world.step();
    for(const id of ids){
      const e=world.enemies.get(id);if(!e)continue;
      const s=still.get(id);
      if(!s||Math.hypot(e.x-s.x,e.y-s.y)>.5)still.set(id,{x:e.x,y:e.y,since:world.tick});
      else worst=Math.max(worst,world.tick-s.since);
    }
  }
  assert.ok(worst<=10*20,`a retreating body stood still ${worst/20} s`);
  for(const id of ids){
    const e=world.enemies.get(id);
    assert.ok(!e||!planner.insideBase(e),`${id} left the base (or is gone): ${e?`at (${e.x.toFixed(1)},${e.y.toFixed(1)})`:'gone'}`);
  }
});

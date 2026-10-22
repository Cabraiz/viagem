/**
 * NEW-20261021-ORQ-barricada-construir part 2, on the REAL Cidade Nevada (towers/tralha.ts through the stonewards system):
 *  1. The map's barricadas: laid once on the first step, rows of squares away from the car, never locking it.
 *  2. DESTRUIR: the square goes at once (its blocker too) and pays DESTRUIR_PIX; out of reach 'longe'.
 *  3. COLETAR: COLETAR_SECONDS standing by it gives a kit:barricada; a hit cancels ('apanhou'); CARREGA_MAX ('cheio').
 *  4. A barricada is never bought: only a kit builds it ('defense' otherwise).
 * D-031: results only (state, events), no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {createStonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {CARREGA_MAX,COLETAR_SECONDS,DESTRUIR_PIX,TRALHA_GROUP_CELLS,TRALHA_GROUPS,UNO_BUILD_CELLS} from '../../src/rules/index.ts';
import {FREE_CELL,pieceRectOf} from '../../src/sim/towers/free-build.ts';
import {TRALHA_OWNER} from '../../src/sim/towers/tralha.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,CAR=placeWall(city),CAR_R=1;

function rig(seed=7){
  const terrain=city.fork(),events:SimEvent[]=[],counters=new Map<string,number>();
  const ana:SimPlayer={id:'ana',x:CAR.x,y:CAR.y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[],hand:0},stats:{...BASE_STATS},weaponReady:{},grana:0};
  const ctx={tick:1,runStartTick:0,events,terrain,get rng(){return new Rng(seed);},players:new Map([['ana',ana]]),
    enemies:new Map<string,EnemyState>(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),team:{xp:0,level:1,nextXp:5},
    round:{index:2,total:10,phase:'wave',phaseEndsTick:ticks(600),remaining:0},
    enemyIndex:{rebuild(){},query(_x:number,_y:number,_r:number,out:EnemyState[]=[]){out.length=0;return out;},nearest(){return undefined;}},
    nextId:(prefix:string)=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:(e:SimEvent)=>{events.push(e);},damageEnemy(){return false;},damagePlayer(){}} as unknown as SimContext&{tick:number};
  const kits=(p:SimPlayer)=>p.build.weapons.reduce((n,w)=>n+(w.id==='kit:barricada'?w.level:0),0);
  const sys=createStonewardsSystem({terrain,siegeContact:false,barricades:false,freeBuild:{car:()=>({...CAR,radius:CAR_R})},
    tralha:{carrying:kits,give:p=>{p.build.weapons.push({id:'kit:barricada',level:1});return true;}}});
  sys.step(ctx);
  const squares=()=>(sys.state.defenses?.pieces??[]).filter(p=>p.owner===TRALHA_OWNER);
  const stand=(id:string)=>{const p=squares().find(q=>q.id===id)!;ana.x=p.x+FREE_CELL;ana.y=p.y;};
  return {terrain,ctx,sys,ana,events,squares,stand,kits};
}

test('the map\'s barricadas: laid once, rows away from the car, blockers that never lock it', ()=>{
  const g=rig(),laid=g.squares();
  assert.ok(laid.length>=TRALHA_GROUPS,`laid ${laid.length}`);
  assert.ok(laid.length<=TRALHA_GROUPS*TRALHA_GROUP_CELLS);
  assert.equal(g.terrain.blockers().length,laid.length,'one blocker each');
  for(const p of laid){
    const r=pieceRectOf(p),gap=Math.hypot(Math.max(r.x-CAR.x,0,CAR.x-(r.x+r.w)),Math.max(r.y-CAR.y,0,CAR.y-(r.y+r.h)));
    assert.ok(gap>=CAR_R+UNO_BUILD_CELLS*FREE_CELL,`${p.id} ${gap.toFixed(2)} u from the car`);
  }
  g.ctx.tick++;g.sys.step(g.ctx);
  assert.equal(g.squares().length,laid.length,'once');
  // Same seed, same map.
  assert.deepEqual(rig().squares().map(p=>p.cell),laid.map(p=>p.cell));
});

test('DESTRUIR: at once, its blocker gone, R$ to the hero; out of reach or not a square refused', ()=>{
  const g=rig(),[a]=g.squares();
  g.ana.x=a.x+10;g.ana.y=a.y;
  assert.deepEqual(g.sys.destruir(g.ctx,'ana',a.id),{ok:false,reason:'longe'});
  assert.deepEqual(g.sys.destruir(g.ctx,'ana','nope'),{ok:false,reason:'nada'});
  g.stand(a.id);
  const before=g.terrain.blockers().length;
  assert.deepEqual(g.sys.destruir(g.ctx,'ana',a.id),{ok:true,pix:DESTRUIR_PIX});
  assert.equal(g.ana.grana,DESTRUIR_PIX);
  assert.equal(g.terrain.blockers().length,before-1);
  assert.ok(!g.squares().some(p=>p.id===a.id));
  assert.ok(g.events.some(e=>e.type==='structure'&&e.id===a.id&&e.hp===0));
});

test('COLETAR: 1.5 s by it gives a kit:barricada (no Pix); a hit cancels; one in the hands at a time', ()=>{
  const g=rig(),[a,b]=g.squares();
  g.stand(a.id);
  const started=g.sys.coletar(g.ctx,'ana',a.id,1);
  assert.deepEqual(started,{ok:true,until:g.ctx.tick+ticks(COLETAR_SECONDS)});
  assert.deepEqual(g.sys.coletar(g.ctx,'ana',a.id,2),{ok:false,reason:'ocupado'});
  for(let k=0;k<ticks(COLETAR_SECONDS)-1;k++){g.ctx.tick++;g.sys.step(g.ctx);}
  assert.deepEqual(g.sys.drainColetas(),[]);
  assert.ok(g.squares().some(p=>p.id===a.id),'not yet');
  g.ctx.tick++;g.sys.step(g.ctx);
  assert.deepEqual(g.sys.drainColetas(),[{player:'ana',piece:a.id,req:1,ok:true}]);
  assert.equal(g.kits(g.ana),1);assert.equal(g.ana.grana,0);
  assert.ok(!g.squares().some(p=>p.id===a.id));
  // Hands full (CARREGA_MAX 1).
  assert.equal(CARREGA_MAX,1);
  g.stand(b.id);
  assert.deepEqual(g.sys.coletar(g.ctx,'ana',b.id),{ok:false,reason:'cheio'});
  // Empty hands again; a hit mid-way cancels.
  g.ana.build.weapons=[];
  assert.equal(g.sys.coletar(g.ctx,'ana',b.id,3).ok,true);
  g.ctx.tick++;g.sys.step(g.ctx);g.ana.hp-=5;g.ctx.tick++;g.sys.step(g.ctx);
  assert.deepEqual(g.sys.drainColetas(),[{player:'ana',piece:b.id,req:3,ok:false,reason:'apanhou'}]);
  assert.ok(g.squares().some(p=>p.id===b.id),'still there');
});

test('a barricada is never bought: only its kit builds it', ()=>{
  const g=rig(),[a]=g.squares();
  g.stand(a.id);g.sys.destruir(g.ctx,'ana',a.id);
  g.ana.grana=100;g.ana.x=a.x+FREE_CELL;g.ana.y=a.y;
  assert.deepEqual(g.sys.build(g.ctx,'ana',{piece:'barricada',c:a.cell.c,r:a.cell.r}),{ok:false,reason:'defense'});
  const built=g.sys.buildKit(g.ctx,'ana',{piece:'barricada',c:a.cell.c,r:a.cell.r});
  assert.equal(built.ok,true,JSON.stringify(built));
});

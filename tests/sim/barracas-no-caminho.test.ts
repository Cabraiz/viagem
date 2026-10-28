/**
 * NEW-20261023-ORQ-barracas-no-caminho (user, 28/10), on the REAL Cidade Nevada (towers/barracas.ts through the
 * stonewards system):
 *  1. FEIRA_COUNT feirinhas of FEIRA_BARRACAS barracas, laid once, far apart (FEIRA_GAP), on open ground, away from the
 *     spawns and the car, never locking the car off a spawn; each keeps an id and a centre (the shop to come).
 *  2. The same seed lays the same feirinhas; another seed, others.
 *  3. Solid scenery: a blocker to the enemies, never a siege target, never hurt, never collected, never built.
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
import {FEIRA_BARRACAS,FEIRA_CAR_GAP,FEIRA_COUNT,FEIRA_GAP,FEIRA_SPAWN_GAP,isFreePiece,pieceCells} from '../../src/rules/index.ts';
import {damagePiece,onGround,pieceRectOf,pieceTargets,standingPieces} from '../../src/sim/towers/free-build.ts';
import {FEIRA_OWNER,feirinhasOf} from '../../src/sim/towers/barracas.ts';
import {TRALHA_OWNER,destruir} from '../../src/sim/towers/tralha.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,CAR=placeWall(city),CAR_R=1,P=city.asset.points,SPAWNS=[P.spawnN,P.spawnS,P.spawnL,P.spawnO];
const gapTo=(r:{x:number;y:number;w:number;h:number},p:{x:number;y:number})=>Math.hypot(Math.max(r.x-p.x,0,p.x-(r.x+r.w)),Math.max(r.y-p.y,0,p.y-(r.y+r.h)));

function rig(seed=7){
  const terrain=city.fork(),events:SimEvent[]=[],counters=new Map<string,number>();
  const ana:SimPlayer={id:'ana',x:CAR.x,y:CAR.y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[],hand:0},stats:{...BASE_STATS},weaponReady:{},grana:0};
  const ctx={tick:1,runStartTick:0,events,terrain,get rng(){return new Rng(seed);},players:new Map([['ana',ana]]),
    enemies:new Map<string,EnemyState>(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),team:{xp:0,level:1,nextXp:5},
    round:{index:2,total:10,phase:'wave',phaseEndsTick:ticks(600),remaining:0},
    enemyIndex:{rebuild(){},query(_x:number,_y:number,_r:number,out:EnemyState[]=[]){out.length=0;return out;},nearest(){return undefined;}},
    nextId:(prefix:string)=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:(e:SimEvent)=>{events.push(e);},damageEnemy(){return false;},damagePlayer(){}} as unknown as SimContext&{tick:number};
  const sys=createStonewardsSystem({terrain,siegeContact:false,barricades:false,freeBuild:{car:()=>({...CAR,radius:CAR_R})},
    tralha:{carrying:()=>0,give:()=>true}});
  sys.step(ctx);
  const barracas=()=>(sys.state.defenses?.pieces??[]).filter(p=>p.kind==='barraca');
  return {terrain,ctx,sys,ana,barracas};
}

test('4–5 feirinhas of 2–4 barracas, far apart, on open ground, away from the spawns and the car', ()=>{
  for(const seed of [1,7,42,2026,99991]){
    const g=rig(seed),feiras=feirinhasOf(g.sys.state),all=g.barracas();
    assert.ok(feiras.length>=FEIRA_COUNT[0]&&feiras.length<=FEIRA_COUNT[1],`seed ${seed}: ${feiras.length} feirinhas`);
    assert.equal(all.length,feiras.reduce((n,f)=>n+f.barracas.length,0),'every barraca in one feirinha');
    for(const f of feiras){
      assert.ok(f.barracas.length>=FEIRA_BARRACAS[0]&&f.barracas.length<=FEIRA_BARRACAS[1],`${f.id}: ${f.barracas.length} barracas`);
      for(const id of f.barracas){
        const p=all.find(q=>q.id===id)!;
        assert.equal(p.owner,FEIRA_OWNER);
        assert.ok(Math.hypot(p.x-f.x,p.y-f.y)<15,`${id} by its feirinha's centre`);
        const r=pieceRectOf(p);
        assert.ok(onGround(city,p.cell,...pieceCells('barraca')),`${id} on walkable ground`);
        for(const s of SPAWNS)assert.ok(gapTo(r,s)>=FEIRA_SPAWN_GAP,`${id} ${gapTo(r,s).toFixed(1)} u from a spawn`);
        assert.ok(gapTo(r,CAR)>=CAR_R+FEIRA_CAR_GAP,`${id} away from the car`);
      }
    }
    const ids=feiras.map(f=>f.id);
    assert.equal(new Set(ids).size,ids.length,'one id each');
    for(let i=0;i<feiras.length;i++)for(let j=i+1;j<feiras.length;j++){
      const d=Math.hypot(feiras[i].x-feiras[j].x,feiras[i].y-feiras[j].y);
      assert.ok(d>=FEIRA_GAP*.6,`seed ${seed}: ${feiras[i].id}–${feiras[j].id} only ${d.toFixed(1)} u apart`);
    }
    // Blockers to the enemies (one disc each).
    for(const p of all)assert.ok(g.terrain.blockers().some(b=>b.id===p.id),`${p.id} blocks the enemies`);
    // Laid once.
    g.ctx.tick++;g.sys.step(g.ctx);
    assert.equal(g.barracas().length,all.length,'once');
    assert.equal(feirinhasOf(g.sys.state).length,feiras.length);
  }
});

test('the same seed lays the same feirinhas; another seed, others; the tralha lays as without them', ()=>{
  const a=rig(7),b=rig(7),c=rig(8);
  assert.deepEqual(feirinhasOf(b.sys.state),feirinhasOf(a.sys.state));
  assert.deepEqual(b.barracas(),a.barracas());
  assert.notDeepEqual(feirinhasOf(c.sys.state).map(f=>[f.x,f.y]),feirinhasOf(a.sys.state).map(f=>[f.x,f.y]));
  // JSON-safe (checkpoints, stateHash).
  assert.deepEqual(JSON.parse(JSON.stringify(feirinhasOf(a.sys.state))),feirinhasOf(a.sys.state));
  // The tralha's own rng stream and ids: the feirinhas come after it.
  const tralha=a.sys.state.defenses!.pieces!.filter(p=>p.owner===TRALHA_OWNER);
  assert.ok(tralha.length>0);
  assert.ok(tralha.every(p=>p.id.startsWith('tralha-')));
});

test('solid scenery: never a siege target, never hurt, never collected, never built, not counted against a limit', ()=>{
  const g=rig(),[p]=g.barracas();
  assert.ok(!pieceTargets(g.sys.state).some(t=>t.id===p.id),'not a target');
  assert.equal(damagePiece(g.terrain,g.sys.state,p.id,1e6),true,'a known piece');
  assert.ok(g.barracas().some(q=>q.id===p.id),'still standing');
  assert.equal(p.hp,p.maxHp);
  g.ana.x=p.x;g.ana.y=p.y;
  assert.deepEqual(destruir(g.ctx,g.terrain,g.sys.state,'ana',p.id),{ok:false,reason:'nada'},'not tralha');
  assert.ok(g.barracas().some(q=>q.id===p.id));
  assert.equal(isFreePiece('barraca'),false,'never built');
  assert.equal(standingPieces(g.sys.state,'barraca'),0);
});

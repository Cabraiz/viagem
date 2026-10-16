/**
 * D-052, fortification anywhere (sim-fortificação, slice 2 of NEW-20261016-ORQ-carro-e-fortificacao-livre), on the REAL
 * Cidade Nevada: the free build of towers/system.ts buildFree and towers/free-build.ts.
 *  1. Rules: the pieces' numbers and footprints (rot turns the barricade).
 *  2. A root on a cell: any phase, its cell and centre, the ficha; the refusals in order (fora, carro, ocupado, limite,
 *     away, balance/grana, defense, duplicate).
 *  3. Muro: a blocker to the enemies, a blocking siege target, paid in Grana, queued per hero, gone at 0 hp.
 *  4. Tranca: a ring of muros around the car is never closed (one of them is refused 'tranca').
 *  5. Barricade: the drag on an enemy standing on it; rot 1.
 *  6. Evolution: a free root grows centred; a larger tier needs free ground ('size'); the Gustavão is out ('max').
 *  7. The site bridge (bots, today's HUD): a site id builds the root on the site's cell; the rail is refused.
 *  8. A rematch reset drops the muros' blockers; a checkpoint's state raises them again.
 *  9. The moto replans around a muro built across his way (the checkpoint rebuilds that route).
 * 10. Mode ninhos: no piece within CAR_NEST_KEEP_OUT of a living nest.
 * D-031: results only (state, events), no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type RoundPhase,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {cityTerrainFrom,type CityTerrain} from '../../src/maps/city/terrain.ts';
import {buildPlanFor,type CellRect} from '../../src/maps/index.ts';
import {createStonewardsSystem,structureTargets,type StonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {CAR_BUILD_GAP,DEFENSES,DEFENSE_LIMIT,FREE_PIECE_DEFS,ROOT_DEFENSE,pieceCells} from '../../src/rules/index.ts';
import {FREE_CELL,MURO_BLOCK_R,gridSize,onGround,pieceDrag,type FreeBuildHooks} from '../../src/sim/towers/free-build.ts';
import {SimWorld,stateHash} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {pointAt,routeCrosses} from '../../src/sim/chaveiro/route.ts';
import {CAR_NEST_KEEP_OUT} from '../../src/contract/objective.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),
  (JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const CAR=placeWall(city),CAR_R=1;

type FakeCtx=SimContext&{tick:number;events:SimEvent[];round:{index:number;total:number;phase:RoundPhase;phaseEndsTick:number;remaining:number}};
function player(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x,y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},grana:500,...extra};
}
function enemy(id:string,x:number,y:number):EnemyState{
  return {id,kind:'bebado',x,y,hp:30,maxHp:30,speed:1,damage:10,radius:.35,xp:1,spawnTick:0,readyTick:0};
}
function fakeCtx(terrain:SimContext['terrain'],players:SimPlayer[]):FakeCtx{
  const events:SimEvent[]=[],enemies=new Map<string,EnemyState>(),counters=new Map<string,number>();
  return {
    tick:0,runStartTick:0,events,terrain,
    get rng(){return new Rng((this as {tick:number}).tick>>>0);},
    players:new Map(players.map(p=>[p.id,p])),
    enemies,pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},
    round:{index:2,total:10,phase:'wave',phaseEndsTick:ticks(600),remaining:0},
    enemyIndex:{rebuild(){},query(_x,_y,_r,out=[]){out.length=0;return out;},nearest(){return undefined;}},
    nextId:prefix=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:e=>{events.push(e);},
    damageEnemy(){return false;},
    damagePlayer(){},
  } as FakeCtx;
}
interface Rig {terrain:CityTerrain;ctx:FakeCtx;sys:StonewardsSystem;ana:SimPlayer;changed:CellRect[];hooks:FreeBuildHooks}
/** A city fork (its own blockers), Ana with R$ 500 and the camp with 4 fichas; the car where the wall stands. */
function rig(hooks:FreeBuildHooks={car:()=>({...CAR,radius:CAR_R})}):Rig{
  const terrain=city.fork(),ana=player('ana',CAR.x,CAR.y),ctx=fakeCtx(terrain,[ana]),changed:CellRect[]=[];
  const sys=createStonewardsSystem({terrain,siegeContact:false,barricades:false,freeBuild:hooks,onTerrainChanged:r=>changed.push(r)});
  sys.state.balance.units=DEFENSES[ROOT_DEFENSE].cost*4;
  return {terrain,ctx,sys,ana,changed,hooks};
}
const centre=(c:number,r:number)=>({x:(c+.5)*FREE_CELL,y:(r+.5)*FREE_CELL});
/** Steps Ana onto the cell (the reach rule) and orders it. */
function order(g:Rig,piece:string,c:number,r:number,req?:string,rot?:0|1){
  const at=centre(c,r);g.ana.x=at.x+FREE_CELL*1.5;g.ana.y=at.y;
  return g.sys.build(g.ctx,'ana',{piece:piece as never,c,r,...(rot!==undefined?{rot}:{})},req);
}
/** Walkable cells on Chebyshev ring `k` (cells) around the cell of `at` (the car's by default), clockwise from the top-left. */
function ring(k:number,at:{x:number;y:number}=CAR):{c:number;r:number}[]{
  const cc=Math.floor(at.x/FREE_CELL),cr=Math.floor(at.y/FREE_CELL),out:{c:number;r:number}[]=[];
  for(let i=-k;i<k;i++)out.push({c:cc+i,r:cr-k});
  for(let i=-k;i<k;i++)out.push({c:cc+k,r:cr+i});
  for(let i=k;i>-k;i--)out.push({c:cc+i,r:cr+k});
  for(let i=k;i>-k;i--)out.push({c:cc-k,r:cr+i});
  return out.filter(o=>onGround(city,o,1,1));
}
/** A free walkable cell clear of the car (Chebyshev 5 cells around it). */
const spot=(i=0)=>ring(5)[i];

test('rules: the muro and the barricada (D-052 numbers), footprints and rot', ()=>{
  assert.deepEqual({...FREE_PIECE_DEFS.muro,footprint:[...FREE_PIECE_DEFS.muro.footprint]},
    {id:'muro',name:'Muro',footprint:[1,1],price:4,hp:250,limit:40,buildSeconds:1,blocks:true,drag:1});
  const b=FREE_PIECE_DEFS.barricada;
  assert.deepEqual([b.price,b.hp,b.limit,b.blocks,b.drag],[10,400,8,false,.4]);
  assert.deepEqual(pieceCells('barricada'),[2,1]);assert.deepEqual(pieceCells('barricada',1),[1,2]);
  assert.deepEqual(pieceCells('muro',1),[1,1]);assert.deepEqual(pieceCells(ROOT_DEFENSE),[1,1]);
  assert.deepEqual(pieceCells('ninho-de-metralhadora'),[3,3]);
});

test('a root on a free cell: at any phase, centred on its cell, one ficha; the order of the refusals', ()=>{
  const g=rig(),at=spot(),before=g.sys.state.balance.units;
  const ok=order(g,ROOT_DEFENSE,at.c,at.r,'1');
  assert.equal(ok.ok,true,JSON.stringify(ok));
  const d=g.sys.state.defenses!.list[0];
  assert.deepEqual(d.cell,at);assert.deepEqual({x:d.x,y:d.y},centre(at.c,at.r));assert.equal(d.site,'');
  assert.equal(before-g.sys.state.balance.units,DEFENSES[ROOT_DEFENSE].cost,'one ficha');
  assert.equal(g.ctx.round.phase,'wave','built during a wave (no rounds for the obra)');
  // The same req again: a duplicate, nothing charged.
  assert.deepEqual(order(g,ROOT_DEFENSE,spot(3).c,spot(3).r,'1'),{ok:false,reason:'duplicate'});
  // Off the grid, or on a building.
  assert.deepEqual(order(g,'muro',-1,0),{ok:false,reason:'fora'});
  const {cols}=gridSize(city);
  assert.deepEqual(order(g,'muro',cols,0),{ok:false,reason:'fora'});
  let wallCell:{c:number;r:number}|undefined;
  for(let c=0;!wallCell&&c<cols;c++)if(!onGround(city,{c,r:Math.floor(CAR.y/FREE_CELL)},1,1)&&Math.abs((c+.5)*FREE_CELL-CAR.x)<30)wallCell={c,r:Math.floor(CAR.y/FREE_CELL)};
  assert.ok(wallCell,'a cell off the walkable ground near the plaza');
  assert.deepEqual(order(g,'muro',wallCell!.c,wallCell!.r),{ok:false,reason:'fora'});
  // Next to the car's body.
  const cc=Math.floor(CAR.x/FREE_CELL),cr=Math.floor(CAR.y/FREE_CELL);
  let near:{c:number;r:number}|undefined;
  for(let k=1;!near&&k<4;k++)near=[{c:cc+k,r:cr},{c:cc-k,r:cr},{c:cc,r:cr+k},{c:cc,r:cr-k}].find(o=>onGround(city,o,1,1));
  assert.ok(near);
  assert.deepEqual(order(g,'muro',near!.c,near!.r),{ok:false,reason:'carro'});
  // Taken: the root's cell, a barricade over it, a hero, an enemy.
  assert.deepEqual(order(g,'muro',at.c,at.r),{ok:false,reason:'ocupado'});
  const other=spot(6);
  const bia=player('bia',centre(other.c,other.r).x,centre(other.c,other.r).y);g.ctx.players.set('bia',bia);
  assert.deepEqual(order(g,'muro',other.c,other.r),{ok:false,reason:'ocupado'},'a hero stands on it');
  g.ctx.players.delete('bia');
  g.ctx.enemies.set('e1',enemy('e1',centre(other.c,other.r).x,centre(other.c,other.r).y));
  assert.deepEqual(order(g,'muro',other.c,other.r),{ok:false,reason:'ocupado'},'an enemy stands on it');
  g.ctx.enemies.clear();
  // Only the root among the towers.
  assert.deepEqual(order(g,'vigias-armados',other.c,other.r),{ok:false,reason:'defense'});
  // From afar.
  g.ana.x=g.ana.y=0;
  assert.deepEqual(g.sys.build(g.ctx,'ana',{piece:'muro',c:other.c,r:other.r}),{ok:false,reason:'away'});
  // Money: the root's ficha from the camp, a piece's R$ from the builder's wallet.
  g.sys.state.balance.units=0;
  assert.deepEqual(order(g,ROOT_DEFENSE,other.c,other.r),{ok:false,reason:'balance'});
  g.ana.grana=3;
  assert.deepEqual(order(g,'muro',other.c,other.r),{ok:false,reason:'grana'});
  g.ana.grana=4;
  assert.equal(order(g,'muro',other.c,other.r).ok,true);assert.equal(g.ana.grana,0,'R$ 4');
  // A downed hero builds nothing.
  g.ana.hp=0;g.ana.downed=true;
  assert.deepEqual(order(g,'muro',spot(9).c,spot(9).r),{ok:false,reason:'player'});
});

test('limits: DEFENSE_LIMIT roots, 40 muros, 8 barricadas', ()=>{
  const g=rig(),at=spot(2);
  g.sys.state.balance.units=1e6;
  g.sys.state.defenses={list:[],gustavoes:0,pieces:[]};
  const far={c:1,r:1};
  for(let i=0;i<FREE_PIECE_DEFS.muro.limit;i++)g.sys.state.defenses.pieces!.push({id:`m${i}`,kind:'muro',cell:far,owner:'x',x:0,y:0,hp:1,maxHp:1,startTick:0,readyTick:0});
  assert.deepEqual(order(g,'muro',at.c,at.r),{ok:false,reason:'limite'});
  g.sys.state.defenses.pieces=[];
  for(let i=0;i<FREE_PIECE_DEFS.barricada.limit;i++)g.sys.state.defenses.pieces.push({id:`b${i}`,kind:'barricada',cell:far,owner:'x',x:0,y:0,hp:1,maxHp:1,startTick:0,readyTick:0});
  assert.deepEqual(order(g,'barricada',at.c,at.r),{ok:false,reason:'limite'});
  assert.equal(order(g,'muro',at.c,at.r).ok,true,'the muros have their own limit');
  g.sys.state.defenses.pieces=[];
  for(let i=0;i<DEFENSE_LIMIT;i++)g.sys.state.defenses.list.push({id:`d${i}`,kind:ROOT_DEFENSE,site:'',cell:far,owner:'x',x:0,y:0,hp:1,maxHp:1,r:.44,startTick:0,readyTick:0,fireTick:0});
  assert.deepEqual(order(g,ROOT_DEFENSE,spot(4).c,spot(4).r),{ok:false,reason:'limite'});
});

test('muro: a blocker to the enemies from its first tick, a blocking siege target, its obras queued, gone at 0 hp', ()=>{
  const g=rig(),a=spot(0),b=spot(1);
  const first=order(g,'muro',a.c,a.r),second=order(g,'muro',b.c,b.r);
  assert.ok(first.ok&&second.ok);
  const [m1,m2]=g.sys.state.defenses!.pieces!;
  assert.equal(m1.readyTick,ticks(FREE_PIECE_DEFS.muro.buildSeconds));
  assert.equal(m2.startTick,m1.readyTick,'the second obra starts when the first is done');
  const blockers=g.terrain.blockers().map(x=>x.id);
  assert.ok(blockers.includes(m1.id)&&blockers.includes(m2.id),'both are blockers on the fork');
  assert.equal(city.blockers().length,0,'the shared city is untouched');
  assert.ok(g.changed.length>=2,'the flow grid hears about each one');
  const disc=g.terrain.blockers().find(x=>x.id===m1.id)!;
  assert.deepEqual({x:disc.x,y:disc.y,r:disc.r},{...centre(a.c,a.r),r:MURO_BLOCK_R});
  // The enemies see it solid; a hero walks through.
  assert.equal(g.terrain.forEnemies().clearDisc(disc.x,disc.y,.2),false);
  assert.equal(g.terrain.clearDisc(disc.x,disc.y,.2),true);
  const target=structureTargets(g.sys.state,false).find(t=>t.id===m1.id)!;
  assert.equal(target.blocking,true);
  // The structures system's single damage path (D-017).
  g.sys.hit(g.ctx,m1.id,100);
  assert.equal(g.sys.state.defenses!.pieces![0].hp,FREE_PIECE_DEFS.muro.hp-100);
  const changes=g.changed.length;
  g.sys.hit(g.ctx,m1.id,1000);
  assert.equal(g.sys.state.defenses!.pieces!.some(p=>p.id===m1.id),false,'fallen: gone');
  assert.equal(g.terrain.blockers().some(x=>x.id===m1.id),false,'its blocker too');
  assert.ok(g.changed.length>changes);
  // Its cell is free again.
  assert.equal(order(g,'muro',a.c,a.r).ok,true);
});

test('tranca: a ring of muros around the car is never closed; the muro that would close it is refused', ()=>{
  const g=rig();
  g.ana.grana=1e6;
  const cells=ring(4),answers:string[]=[];
  assert.ok(cells.length>=10,`a ring of free cells around the car (${cells.length})`);
  for(const [i,o] of cells.entries()){const r=order(g,'muro',o.c,o.r,`r${i}`);answers.push(r.ok?'ok':r.reason);}
  assert.ok(answers.includes('tranca'),answers.join(' '));
  assert.ok(answers.filter(x=>x==='ok').length>=cells.length/2,answers.join(' '));
  assert.ok(answers.every(x=>x==='ok'||x==='tranca'),answers.join(' '));
  // Without the car hook the wall's spot stands for it: the same answer.
  const h=rig({});h.ana.grana=1e6;
  const again=cells.map((o,i)=>{const r=order(h,'muro',o.c,o.r,`r${i}`);return r.ok?'ok':r.reason;});
  assert.ok(again.includes('tranca'));
});

test('tranca: the moto keeps a way to the car (a ring around the moto, far from the car, never closes)', ()=>{
  // A spot on the ground 12-20 u from the car with a ring of free cells around it.
  let moto:{x:number;y:number}|undefined;
  for(let d=12;!moto&&d<=20;d+=2)for(let a=0;a<8&&!moto;a++){
    const p={x:CAR.x+Math.cos(a*Math.PI/4)*d,y:CAR.y+Math.sin(a*Math.PI/4)*d};
    if(onGround(city,{c:Math.floor(p.x/FREE_CELL),r:Math.floor(p.y/FREE_CELL)},1,1)&&ring(3,p).length===24)moto=p;
  }
  assert.ok(moto,'an open spot for the moto');
  const cells=ring(3,moto!);
  const run=(hooks:FreeBuildHooks)=>{
    const g=rig(hooks);g.ana.grana=1e6;
    return cells.map((o,i)=>{const r=order(g,'muro',o.c,o.r,`m${i}`);return r.ok?'ok':r.reason;});
  };
  const withMoto=run({car:()=>({...CAR,radius:CAR_R}),moto:()=>moto});
  // The muro discs reach past their cell on the 1.5 u flow grid, so the last one or two of the ring are refused.
  const refused=withMoto.filter(x=>x!=='ok');
  assert.ok(refused.length>=1&&refused.length<=3&&refused.every(x=>x==='tranca'),withMoto.join(' '));
  assert.equal(withMoto.at(-1),'tranca','the last muro would close the ring');
  // Without the moto the same ring around an empty spot closes: nothing to lock there.
  assert.ok(run({car:()=>({...CAR,radius:CAR_R})}).every(x=>x==='ok'));
});

test('barricada: 2×1 (rot 1: 1×2); an enemy on it walks at 40 %; a non-blocking siege target', ()=>{
  const g=rig();
  let at:{c:number;r:number}|undefined;
  for(const o of ring(5))if(onGround(city,o,2,1)&&onGround(city,o,1,2)){at=o;break;}
  assert.ok(at);
  const lying=order(g,'barricada',at!.c,at!.r);
  assert.equal(lying.ok,true,JSON.stringify(lying));
  const p=g.sys.state.defenses!.pieces![0];
  assert.deepEqual({x:p.x,y:p.y},{x:(at!.c+1)*FREE_CELL,y:(at!.r+.5)*FREE_CELL});
  assert.equal(g.terrain.blockers().length,0,'no blocker');
  assert.equal(pieceDrag(g.sys.state,{x:p.x+.5,y:p.y}),.4);
  assert.equal(pieceDrag(g.sys.state,{x:p.x,y:p.y+FREE_CELL}),1,'off it');
  const t=structureTargets(g.sys.state,false).find(x=>x.id===p.id)!;
  assert.equal(t.blocking,undefined);
  // rot 1 stands up: the cell under the lying one's right half is taken, the column below it is not.
  const h=rig(),up=order(h,'barricada',at!.c,at!.r,undefined,1);
  assert.equal(up.ok,true);
  const q=h.sys.state.defenses!.pieces![0];
  assert.equal(q.rot,1);assert.deepEqual({x:q.x,y:q.y},{x:(at!.c+.5)*FREE_CELL,y:(at!.r+1)*FREE_CELL});
  assert.equal(CAR_BUILD_GAP,1.5);
});

test('evolution: a free root grows centred on its cell; a larger tier needs free ground; the Gustavão is out', ()=>{
  const g=rig(),at=spot(0);
  g.ctx.round.phase='prepare';
  assert.equal(order(g,ROOT_DEFENSE,at.c,at.r).ok,true);
  const d=g.sys.state.defenses!.list[0];d.readyTick=0;
  // A2 is 2×2: it takes the cells up and left too.
  const grow=()=>{g.ana.x=d.x+1;g.ana.y=d.y;return g.sys.upgrade(g.ctx,'ana',d.id,'A');};
  // A muro up-left of it blocks that.
  const blocker={c:at.c-1,r:at.r-1};
  if(onGround(city,blocker,1,1)){
    assert.equal(order(g,'muro',blocker.c,blocker.r,'m').ok,true);
    g.ana.grana=500;
    assert.deepEqual(grow(),{ok:false,reason:'size'});
    g.sys.hit(g.ctx,g.sys.state.defenses!.pieces![0].id,1e6);
  }
  const up=grow();
  assert.equal(up.ok,true,JSON.stringify(up));
  assert.deepEqual(d.cell,{c:at.c-1,r:at.r-1});
  assert.deepEqual({x:d.x,y:d.y},{x:at.c*FREE_CELL,y:at.r*FREE_CELL});
  // The Obuseiro's only child is the Gustavão: out of the free build.
  d.kind='obuseiro';d.readyTick=0;
  g.ana.x=d.x;g.ana.y=d.y;
  assert.deepEqual(g.sys.upgrade(g.ctx,'ana',d.id),{ok:false,reason:'max'});
});

test('the site bridge (bots, the HUD of today): a site builds the root on its cell and keeps the site id; the rail is refused', ()=>{
  const g=rig(),plan=buildPlanFor(city),site=plan.sites[0];
  g.ana.x=site.x;g.ana.y=site.y;
  const r=g.sys.build(g.ctx,'ana','obra-01');
  assert.equal(r.ok,true,JSON.stringify(r));
  const d=g.sys.state.defenses!.list[0];
  assert.equal(d.site,'obra-01');
  assert.deepEqual(d.cell,{c:Math.floor(site.x/FREE_CELL),r:Math.floor(site.y/FREE_CELL)});
  assert.deepEqual(g.sys.build(g.ctx,'ana','obra-01'),{ok:false,reason:'ocupado'});
  g.ana.x=plan.rail!.x;g.ana.y=plan.rail!.y;
  assert.deepEqual(g.sys.build(g.ctx,'ana','trilho'),{ok:false,reason:'rail'});
  assert.equal(g.sys.plan.rail,null,'the bots see no rail');
  assert.deepEqual(g.sys.build(g.ctx,'ana','obra-99'),{ok:false,reason:'site'});
  // Without the free build (tests, the endless map) a FreeOrder is 'fora'.
  const terrain=city.fork(),ctx=fakeCtx(terrain,[player('ana',site.x,site.y)]);
  const legacy=createStonewardsSystem({terrain,siegeContact:false,barricades:false});
  assert.deepEqual(legacy.build(ctx,'ana',{piece:'muro',c:1,r:1}),{ok:false,reason:'fora'});
  assert.notEqual(legacy.plan.rail,null);
});

test('a rematch reset drops the muros\' blockers; a system made from a checkpoint raises them again', ()=>{
  const g=rig(),a=spot(0);
  assert.equal(order(g,'muro',a.c,a.r).ok,true);
  const saved=structuredClone(g.sys.state);
  g.sys.reset();
  assert.equal(g.terrain.blockers().length,0);
  assert.equal(g.sys.state.defenses,undefined);
  const restored=createStonewardsSystem({terrain:g.terrain,siegeContact:false,barricades:false,freeBuild:{}},saved);
  assert.deepEqual(g.terrain.blockers().map(b=>b.id),[saved.defenses!.pieces![0].id]);
  assert.equal(restored.state.defenses!.pieces!.length,1);
  assert.equal(JSON.stringify(restored.state),JSON.stringify(saved),'JSON-safe');
});

// ---------- An assembled city run (the chaveiro): the critters against the muros ----------
test('assembled run: a ring of muros around the car (an opening kept by the tranca rule); no critter ever stands inside a muro; a checkpoint plays on identically', ()=>{
  const SEED=21,players=new Map<string,SimPlayer>();
  const make=(terrain:CityTerrain,ps:Map<string,SimPlayer>,checkpoint?:ReturnType<RunSystems['state']>)=>{
    const world=new SimWorld({terrain,seed:SEED,players:ps,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    return {world,sys:createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',...(checkpoint?{checkpoint}:{})})};
  };
  const a=make(city.fork(),players);
  const hero=(id:string,dx:number)=>{const p=player(id,CAR.x+dx,CAR.y,{hp:1e6,stats:{...BASE_STATS,maxHp:1e6},grana:1e4});a.world.players.set(id,p);return p;};
  const ana=hero('ana',1.5);hero('bia',-1.5);
  // The ring, 6 cells out; each muro ordered from beside it.
  const answers:string[]=[];
  for(const [i,o] of ring(6).entries()){
    const at=centre(o.c,o.r);ana.x=at.x;ana.y=at.y;
    const r=a.sys.stonewards.build(a.world,'ana',{piece:'muro',c:o.c,r:o.r},`r${i}`);
    answers.push(r.ok?'ok':r.reason);
  }
  ana.x=CAR.x+1.5;ana.y=CAR.y;
  const muros=a.sys.stonewards.state.defenses!.pieces!;
  assert.ok(muros.length>=10,answers.join(' '));
  assert.ok(answers.every(x=>x==='ok'||x==='tranca'||x==='ocupado'||x==='limite'),answers.join(' '));
  // Into the first waves: no enemy centre inside a standing muro's disc (less the touch slack of the blocker).
  let inside=0,seen=0,closest=Infinity;
  for(let i=0;i<ticks(90);i++){
    a.world.step();
    for(const e of a.world.enemies.values()){
      seen++;
      for(const m of a.sys.stonewards.state.defenses?.pieces??[]){
        const d=Math.hypot(e.x-m.x,e.y-m.y);closest=Math.min(closest,d);
        if(m.kind==='muro'&&d<MURO_BLOCK_R-.05)inside++;
      }
    }
  }
  const hurt=muros.filter(m=>m.hp<m.maxHp).length,fallen=answers.filter(x=>x==='ok').length-a.sys.stonewards.state.defenses!.pieces!.length;
  console.log(`[fortificacao] ${answers.filter(x=>x==='ok').length} muros (${answers.join(' ')}); 90 s: closest critter ${closest.toFixed(2)} u, ${hurt} hurt, ${fallen} fallen, car hits ${a.sys.chaveiro!.state.car.hits}`);
  assert.ok(seen>0,'enemies walked');
  assert.ok(closest<MURO_BLOCK_R+1,'the critters came up against the muros');
  assert.equal(inside,0,'never inside a muro');
  // Checkpoint with the muros: a fresh run on a fresh fork raises their blockers and plays on identically.
  const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
  const copies=new Map([...players].map(([id,p])=>[id,structuredClone(p)]));
  const fork=city.fork(),b=make(fork,copies,systems);b.world.load(world);
  assert.deepEqual(fork.blockers().map(x=>x.id).filter(id=>id.startsWith('peca')).sort(),
    (a.sys.stonewards.state.defenses?.pieces??[]).filter(p=>p.kind==='muro').map(p=>p.id).sort());
  for(let i=0;i<ticks(20);i++){a.world.step();b.world.step();}
  assert.equal(stateHash({world:b.world.state(),systems:b.sys.state()}),stateHash({world:a.world.state(),systems:a.sys.state()}));
});

test('assembled run: a muro built across the moto\'s way makes him replan around it; a checkpoint rebuilds that route and plays on identically', ()=>{
  const SEED=21,players=new Map<string,SimPlayer>();
  const make=(terrain:CityTerrain,ps:Map<string,SimPlayer>,checkpoint?:ReturnType<RunSystems['state']>)=>{
    const world=new SimWorld({terrain,seed:SEED,players:ps,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    return {world,sys:createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',...(checkpoint?{checkpoint}:{})})};
  };
  const a=make(city.fork(),players),chaveiro=a.sys.chaveiro!;
  const ana=player('ana',CAR.x+1.5,CAR.y,{hp:1e6,stats:{...BASE_STATS,maxHp:1e6},grana:1e4});a.world.players.set('ana',ana);
  const before=chaveiro.route,mid=pointAt(before,before.length*.5);
  // A 3×3 block of muros on the middle of his way, each ordered from beside it.
  const c0=Math.floor(mid.x/FREE_CELL),r0=Math.floor(mid.y/FREE_CELL),answers:string[]=[];
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
    const at=centre(c0+dc,r0+dr);ana.x=at.x+.4;ana.y=at.y+.4;
    const r=a.sys.stonewards.build(a.world,'ana',{piece:'muro',c:c0+dc,r:r0+dr},`m${dc}${dr}`);
    answers.push(r.ok?'ok':r.reason);
  }
  ana.x=CAR.x+1.5;ana.y=CAR.y;
  const muros=()=>(a.sys.stonewards.state.defenses?.pieces??[]).filter(p=>p.kind==='muro');
  assert.ok(muros().length>=1,answers.join(' '));
  assert.ok(routeCrosses(before,0,muros(),MURO_BLOCK_R),'the block stands on his way');
  a.world.step();
  const via=chaveiro.state.route.via;
  assert.ok(via?.muros?.length,'replanned around the muros');
  assert.notEqual(chaveiro.route,before);
  assert.ok(!routeCrosses(chaveiro.route,0,muros(),MURO_BLOCK_R-.05),'the new way keeps off every muro\'s blocker');
  // Checkpoint: the route comes back from via (around the same muros) and the run plays on identically.
  const world=a.world.checkpoint(),systems=structuredClone(a.sys.state());
  const copies=new Map([...players].map(([id,p])=>[id,structuredClone(p)]));
  const b=make(city.fork(),copies,systems);b.world.load(world);
  assert.deepEqual(b.sys.chaveiro!.route.points,chaveiro.route.points);
  let closest=Infinity;
  for(let i=0;i<ticks(30);i++){
    a.world.step();b.world.step();
    const m=chaveiro.moto();
    for(const w of muros())closest=Math.min(closest,Math.hypot(m.x-w.x,m.y-w.y));
  }
  assert.ok(closest>=MURO_BLOCK_R-.05,`the moto never rides into a muro (closest ${closest.toFixed(2)} u)`);
  assert.equal(stateHash({world:b.world.state(),systems:b.sys.state()}),stateHash({world:a.world.state(),systems:a.sys.state()}));
});

test('assembled run in mode ninhos: no piece within CAR_NEST_KEEP_OUT of a living nest (ninho); farther out builds', ()=>{
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain:city.fork(),seed:21,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},cityTutorial:false,objective:'chaveiro',mode:'ninhos'});
  const ana=player('ana',CAR.x+1.5,CAR.y,{hp:1e6,stats:{...BASE_STATS,maxHp:1e6},grana:1e4});players.set('ana',ana);
  world.step();
  const nests=sys.nests!.state.nests.filter(n=>!n.down);
  assert.ok(nests.length,'living nests');
  // A muro ordered from beside its cell on every free ground cell between `from` and `to` u of a nest's centre.
  const order=(from:number,to:number)=>{
    const out=new Set<string>();
    for(const nest of nests)for(let c=Math.floor((nest.x-to)/FREE_CELL);c<=Math.ceil((nest.x+to)/FREE_CELL);c++)for(let r=Math.floor((nest.y-to)/FREE_CELL);r<=Math.ceil((nest.y+to)/FREE_CELL);r++){
      const at=centre(c,r),d=Math.hypot(at.x-nest.x,at.y-nest.y);
      if(d<from||d>to||!onGround(city,{c,r},1,1))continue;
      ana.x=at.x+.4;ana.y=at.y+.4;
      const res=sys.stonewards.build(world,'ana',{piece:'muro',c,r},`m${c}-${r}`);
      out.add(res.ok?'ok':res.reason);
      if(out.size>1||res.ok)return out;
    }
    return out;
  };
  const near=order(0,CAR_NEST_KEEP_OUT-1.5);
  assert.ok(near.has('ninho')&&!near.has('ok'),[...near].join());
  assert.ok(order(CAR_NEST_KEEP_OUT+1.5,CAR_NEST_KEEP_OUT+4).has('ok'));
});

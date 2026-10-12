/**
 * cidade-06 (base-praca), SIM part: the Stonewards base in the Cidade Nevada. On the REAL asset
 * (public/maps/cidade-nevada.json, decoded and hash-checked like tests/maps/city-terrain.test.ts) a barricade closes
 * each plaza mouth as a blocker disc on the room's own terrain fork that stops enemies only (heroes walk through to the
 * forge and back out); the enemy-ai is the only thing that hurts it
 * (D-017), a fallen one opens its avenue to the flow field and a repair rebuilds it; only the wall falling is the
 * defeat, once, and a same-tick victory wins (D-016). Result asserts only, no wall-clock limits (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom,type CityTerrain} from '../../src/maps/city/terrain.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {RADIUS,moveDirection,walkable,type Point} from '../../src/maps/world.ts';
import {DIRS,FlowField,type FlowGrid} from '../../src/maps/flowfield.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks,type EnemyState,type RoundPhase,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {PRIZE_BARRICADE_MARGIN,PRIZE_WALL_CLEAR,createRunSystems,prizeBlocks,type RunOutcomeKind} from '../../src/sim/assemble.ts';
import {createEnemyAi,moveSafely} from '../../src/sim/enemies/ai.ts';
import {createEnemy,enemyDef} from '../../src/sim/enemies/catalog.ts';
import {cityFlowGrid,cityPlanner,citySteer} from '../../src/sim/city/grid.ts';
import {MOUTHS,type Mouth} from '../../src/sim/city/avenues.ts';
import {createStonewardsState,createStonewardsSystem,structureTargets,type StonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {BARRICADE_MAX_HP,BARRICADE_MAX_R,BARRICADE_MIN_R,barricadeCells,sealRadii} from '../../src/sim/stonewards/barricades.ts';
import {REPAIR_FRACTION} from '../../src/sim/stonewards/forge.ts';
import {SIEGE_FLAG,WALL_RADIUS} from '../../src/sim/stonewards/wall.ts';
import {CAMP_RADIUS,RECIPES} from '../../src/rules/index.ts';

// ---------- The real city ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
/** Shared by the process (like cityTerrainFor): every test works on its own fork and checks this one stays clean. */
const shared=loaded.terrain;
const P=shared.asset.points;
const ID=(m:Mouth)=>`barricada-${m}`;
const spawnOf=(m:Mouth)=>P[`spawn${m}` as const];

/** 8-connected path (no corner cutting, the flow field's moves) on a grid between the cells of two points. */
function connected(g:FlowGrid,a:Point,b:Point):boolean{
  const w=g.width,h=g.height,cs=g.cellSize;
  const cell=(p:Point)=>Math.floor(p.x/cs)+Math.floor(p.y/cs)*w,from=cell(a),to=cell(b);
  const ok=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&g.walkable(x,y);
  if(!ok(from%w,(from-from%w)/w))return false;
  const seen=new Uint8Array(w*h),queue=[from];seen[from]=1;
  while(queue.length){
    const u=queue.pop()!,ux=u%w,uy=(u-ux)/w;
    if(u===to)return true;
    for(let d=0;d<8;d++){
      const vx=ux+DIRS[d].dx,vy=uy+DIRS[d].dy,v=vx+vy*w;
      if(!ok(vx,vy)||seen[v]||d>=4&&(!ok(vx,uy)||!ok(ux,vy)))continue;
      seen[v]=1;queue.push(v);
    }
  }
  return false;
}
const blockerIds=(t:CityTerrain)=>t.blockers().map(b=>b.id);

function player(id:string,p:Point,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x:p.x,y:p.y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
/** First walkable spot on rings around `p` (0.1 u steps). */
function walkableNear(t:CityTerrain,p:Point):Point{
  for(let r=0;r<4;r+=.1)for(let i=0,n=r?Math.ceil(r*40):1;i<n;i++){
    const q={x:p.x+Math.cos(i/n*2*Math.PI)*r,y:p.y+Math.sin(i/n*2*Math.PI)*r};
    if(walkable(q,t))return q;
  }
  throw new Error('no walkable spot');
}

type FakeCtx=SimContext&{tick:number;events:SimEvent[]};
/** Minimal context for the forge and the damage path (the AI tests use a real SimWorld). */
function fakeCtx(terrain:CityTerrain,players:SimPlayer[],phase:RoundPhase='prepare'):FakeCtx{
  const events:SimEvent[]=[];let n=0;
  const unused=()=>{throw new Error('not used');};
  return {
    tick:0,runStartTick:0,events,terrain,rng:new Rng(1),
    players:new Map(players.map(p=>[p.id,p])),enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),
    offers:new Map(),team:{xp:0,level:1,nextXp:5},round:{index:2,total:10,phase,phaseEndsTick:ticks(30),remaining:0},
    enemyIndex:{rebuild(){},query:()=>[],nearest:()=>undefined},
    nextId:prefix=>`${prefix}${++n}`,emit:e=>{events.push(e);},damageEnemy:unused,damagePlayer:unused,
  } as FakeCtx;
}
/** A city base on its own fork, with the planner wired the way assemble.ts wires it. */
function cityBase(){
  const terrain=shared.fork();
  const rects:unknown[]=[];
  let planner:ReturnType<typeof cityPlanner>|undefined;
  const sys=createStonewardsSystem({terrain,siegeContact:false,onTerrainChanged:rect=>{rects.push(rect);planner?.grid.refresh(rect);planner?.invalidate([rect]);}});
  planner=cityPlanner(terrain);
  return {terrain,sys,planner,rects};
}
/** A spot inside the plaza, within the camp of barricade `m` (repairs) and on the plaza side of it. */
function insideNear(t:CityTerrain,m:Mouth):Point{
  const b=P.bocas[m],c={x:(P.bocas.L.x+P.bocas.O.x)/2,y:(P.bocas.N.y+P.bocas.S.y)/2};
  const d=Math.hypot(c.x-b.x,c.y-b.y);
  return walkableNear(t,{x:b.x+(c.x-b.x)/d*2.5,y:b.y+(c.y-b.y)/d*2.5});
}

// ---------- Size: every mouth sealed on the real asset ----------
test('real asset: each mouth seals with one disc in [1, 4] u; the 4 discs cut every spawn off the plaza on the flow grid',()=>{
  const radii=sealRadii(shared);
  console.log(`seal radii (u): ${MOUTHS.map(m=>`${m} ${radii[m]}`).join(', ')}`);
  for(const m of MOUTHS){
    const r=radii[m];
    assert.ok(r!==null&&r>=BARRICADE_MIN_R&&r<=BARRICADE_MAX_R,`mouth ${m} sealed (r=${r})`);
  }
  const open=cityFlowGrid(shared.fork());
  for(const m of MOUTHS)assert.ok(connected(open,spawnOf(m),P.praca),`without barricades spawn ${m} reaches the plaza`);
  const {terrain,sys}=cityBase();
  assert.deepEqual(blockerIds(terrain),MOUTHS.map(ID).sort());
  assert.deepEqual(sys.state.barricades!.map(b=>[b.id,b.hp,b.maxHp,b.r,b.down]),MOUTHS.map(m=>[ID(m),BARRICADE_MAX_HP,BARRICADE_MAX_HP,radii[m],false]));
  assert.equal(sys.state.unsealed,undefined,'no mouth left open');
  const closed=cityFlowGrid(terrain);
  for(const m of MOUTHS)assert.equal(connected(closed,spawnOf(m),P.praca),false,`spawn ${m} cut off`);
  // Each disc alone closes its own mouth cell (and only the mouth around it changes).
  const cs=shared.asset.unitsPerCell;
  for(const m of MOUTHS){
    const one=shared.fork();one.setBlocker(ID(m),{x:P.bocas[m].x,y:P.bocas[m].y,r:radii[m]!});
    const g=cityFlowGrid(one),cx=Math.floor(P.bocas[m].x/cs),cy=Math.floor(P.bocas[m].y/cs);
    assert.equal(open.walkable(cx,cy),true);assert.equal(g.walkable(cx,cy),false,`disc ${m} closes the mouth cell`);
    const rect=barricadeCells(one,{x:P.bocas[m].x,y:P.bocas[m].y,r:radii[m]!});
    for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){
      if(x>=rect.x0&&x<=rect.x1&&y>=rect.y0&&y<=rect.y1)continue;
      if(g.walkable(x,y)!==open.walkable(x,y))assert.fail(`disc ${m} changed cell (${x},${y}) outside its rect`);
    }
  }
  assert.deepEqual(shared.blockers(),[],'the shared city never gets a blocker');
});

test('island and endless world: no barricades in the state, the structures are exactly the wall as before',()=>{
  const state=createStonewardsState({terrain:defaultTerrain});
  assert.equal('barricades' in state,false);assert.equal('unsealed' in state,false);
  assert.deepEqual(structureTargets(state),[{id:'muralha',x:state.wall.x,y:state.wall.y,radius:WALL_RADIUS}]);
});

// ---------- Flow field ----------
test('a fallen barricade opens its avenue to the flow field and a rebuild seals it again (targetFor flips)',()=>{
  const {terrain,sys,planner,rects}=cityBase();
  for(const m of MOUTHS)assert.deepEqual(planner.targetFor(spawnOf(m)),{kind:'barricade',mouth:m},`all up: spawn ${m} goes for its barricade`);
  for(const m of MOUTHS)assert.equal(planner.route(m)?.blocked,true);
  const ctx=fakeCtx(terrain,[],'wave');
  sys.hit(ctx,ID('N'),BARRICADE_MAX_HP);
  const n=sys.state.barricades!.find(b=>b.id===ID('N'))!;
  assert.equal(n.down,true);assert.equal(n.hp,0);
  assert.deepEqual(ctx.events,[{type:'structure',id:ID('N'),hp:0,maxHp:BARRICADE_MAX_HP}]);
  assert.equal(sys.state.wallDown,false,'a barricade is not the base');
  assert.ok(!blockerIds(terrain).includes(ID('N')));
  assert.equal(rects.length,1,'one terrain change reported');
  assert.deepEqual(planner.targetFor(spawnOf('N')),{kind:'plaza'},'N avenue reaches the plaza now');
  assert.equal(planner.route('N')?.blocked,false);
  assert.ok(connected(planner.grid,spawnOf('N'),P.praca),'grid path through mouth N');
  // A second hit on a fallen barricade does nothing.
  sys.hit(ctx,ID('N'),50);
  assert.equal(ctx.events.length,1);
  // Rebuild: a body in the mouth refuses it ('blocked', free); once clear, the repair raises the disc again.
  const a=player('a',insideNear(terrain,'N'));
  const prep=fakeCtx(terrain,[a]);
  sys.state.balance={coco:99,pedra:99};
  prep.enemies.set('e1',{id:'e1',kind:'bebado',x:n.x,y:n.y+n.r+.1,hp:10,maxHp:10,speed:1,damage:1,radius:.32,xp:1,spawnTick:0,readyTick:0});
  assert.deepEqual(sys.buy(prep,'a','reparo','r1',ID('N')),{ok:false,reason:'blocked'});
  assert.deepEqual(sys.state.balance,{coco:99,pedra:99},'not charged');
  prep.enemies.clear();
  // A hero standing in the mouth does not block it: barricades only block enemies, the hero walks through.
  const b=player('b',{x:n.x,y:n.y});prep.players.set('b',b);
  const done=sys.buy(prep,'a','reparo','r2',ID('N'));
  assert.equal(done.ok,true);
  assert.equal(n.down,false);assert.equal(n.hp,Math.ceil(BARRICADE_MAX_HP*REPAIR_FRACTION));
  assert.ok(blockerIds(terrain).includes(ID('N')));
  assert.equal(rects.length,2);
  assert.deepEqual(planner.targetFor(spawnOf('N')),{kind:'barricade',mouth:'N'},'sealed again');
  assert.equal(connected(planner.grid,spawnOf('N'),P.praca),false);
});

// ---------- Repair ----------
test('two players repairing the same barricade in one tick: never above max, the second refused when full, charged per repair',()=>{
  const {terrain,sys}=cityBase();
  const at=insideNear(terrain,'L'),a=player('a',at),b=player('b',{x:at.x,y:at.y});
  const ctx=fakeCtx(terrain,[a,b]);
  const cost=RECIPES.reparo.cost,l=sys.state.barricades!.find(x=>x.id===ID('L'))!;
  const step=Math.ceil(BARRICADE_MAX_HP*REPAIR_FRACTION);
  sys.state.balance={coco:cost.coco*10,pedra:cost.pedra*10};
  // Room for one step and a half: the first applies a full step, the second only the rest, a third is refused.
  l.hp=BARRICADE_MAX_HP-step-10;
  const r1=sys.buy(ctx,'a','reparo','x',ID('L')),r2=sys.buy(ctx,'b','reparo','x',ID('L')),r3=sys.buy(ctx,'a','reparo','y',ID('L'));
  assert.equal(r1.ok,true);assert.equal(r2.ok,true);assert.deepEqual(r3,{ok:false,reason:'full'});
  assert.equal(l.hp,BARRICADE_MAX_HP);
  assert.deepEqual(sys.state.balance,{coco:cost.coco*8,pedra:cost.pedra*8},'two repairs applied, two charged');
  // Room for less than a step: the first fills it, the second is refused 'full' and not charged.
  l.hp=BARRICADE_MAX_HP-5;
  const s1=sys.buy(ctx,'a','reparo','z',ID('L')),s2=sys.buy(ctx,'b','reparo','z',ID('L'));
  assert.equal(s1.ok,true);assert.deepEqual(s2,{ok:false,reason:'full'});
  assert.equal(l.hp,BARRICADE_MAX_HP);
  assert.deepEqual(sys.state.balance,{coco:cost.coco*7,pedra:cost.pedra*7});
  const hps=ctx.events.filter(e=>e.type==='structure').map(e=>e.type==='structure'?e.hp:0);
  assert.ok(hps.every(h=>h<=BARRICADE_MAX_HP));
  // Eligibility: the repair is at THAT barricade, in the intermission, standing; unknown ids; the old call = the wall.
  l.hp=10;
  const far=player('f',P.praca);ctx.players.set('f',far);
  assert.ok(Math.hypot(far.x-l.x,far.y-l.y)>6);
  assert.deepEqual(sys.buy(ctx,'f','reparo','w',ID('L')),{ok:false,reason:'away'});
  assert.deepEqual(sys.buy(ctx,'a','reparo','w',ID('X')),{ok:false,reason:'target'});
  b.downed={sinceTick:0,bleedOutTick:999,progress:0};
  assert.deepEqual(sys.buy(ctx,'b','reparo','w',ID('L')),{ok:false,reason:'player'});
  const wave=fakeCtx(terrain,[a],'wave');
  assert.deepEqual(sys.buy(wave,'a','reparo','w',ID('L')),{ok:false,reason:'phase'});
  sys.state.wall.hp=100;
  assert.equal(sys.buy(ctx,'f','reparo','w').ok,true,'no target: the wall, from the forge at the fountain');
  assert.equal(sys.state.wall.hp,100+Math.ceil(sys.state.wall.maxHp*REPAIR_FRACTION));
  assert.equal(l.hp,10);
});

// ---------- The AI: one damage path ----------
function aiWorld(){
  const {terrain,sys,planner}=cityBase();
  const world=new SimWorld({terrain,seed:5});
  world.round.index=3;world.round.phase='wave';world.round.phaseEndsTick=1e9;
  const hits:{id:string;amount:number;enemy:string;tick:number}[]=[];
  const ai=createEnemyAi({steer:citySteer(planner,{terrain}),structures:()=>structureTargets(sys.state),
    hitStructure:(ctx,id,amount,e)=>{hits.push({id,amount,enemy:e.id,tick:ctx.tick});sys.hit(ctx,id,amount);}});
  world.register(ai).register(sys);
  return {terrain,sys,world,hits};
}
/** On the N avenue, `d` u out from mouth N. */
const upN=(t:CityTerrain,d:number)=>walkableNear(t,{x:P.bocas.N.x,y:P.bocas.N.y-d});
/** Inside the plaza, far from mouth N (beyond every keep-distance range). */
const plazaFarFromN=(t:CityTerrain)=>walkableNear(t,{x:76.5,y:91});

test('D-017 on a barricade: one hit = one damage, one hit per contact cooldown, siege or not; the contact siege stays off',()=>{
  const {sys,world,hits,terrain}=aiWorld();
  world.players.set('p',player('p',plazaFarFromN(terrain)));
  // One body per barricade (the pocket in front of a sealed mouth holds about one body, the next one waits behind).
  const n=sys.state.barricades!.find(b=>b.id===ID('N'))!,l=sys.state.barricades!.find(b=>b.id===ID('L'))!;
  const plain=createEnemy(world,'bebado',{x:n.x,y:n.y-n.r-.3});
  const siege=createEnemy(world,'bebado',{x:l.x+l.r+.3,y:l.y});siege.memory![SIEGE_FLAG]=1;
  const events:SimEvent[]=[];
  for(let t=0;t<ticks(5);t++)events.push(...world.step());
  const def=enemyDef('bebado');
  for(const e of [plain,siege]){
    const mine=hits.filter(h=>h.enemy===e.id);
    assert.ok(mine.length>=3,`${e.id} (${e===siege?'siege':'plain'}) bashed the barricade: ${mine.length}`);
    assert.ok(mine.every(h=>h.id===(e===siege?ID('L'):ID('N'))&&h.amount===e.damage));
    for(let i=1;i<mine.length;i++)assert.ok(mine[i].tick-mine[i-1].tick>=def.contactCooldown,'one hit per contact cooldown');
  }
  const structure=events.filter(e=>e.type==='structure');
  assert.equal(structure.length,hits.length,'one structure event per hit: no second damage path');
  for(const b of [n,l])assert.equal(b.hp,BARRICADE_MAX_HP-hits.filter(h=>h.id===b.id).reduce((s,h)=>s+h.amount,0));
  assert.equal(sys.state.wall.hp,sys.state.wall.maxHp,'nobody reached the wall');
});

test('bêbado and anão steered up a sealed avenue both bash its barricade; a retreating body and the boss never do',()=>{
  for(const kind of ['bebado','anao-molotov'] as const){
    const {sys,world,hits,terrain}=aiWorld();
    world.players.set('p',player('p',plazaFarFromN(terrain)));
    const e=createEnemy(world,kind,upN(terrain,8));
    for(let t=0;t<ticks(60)&&!hits.length;t++)world.step();
    assert.deepEqual(hits.slice(0,1).map(h=>[h.enemy,h.id,h.amount]),[[e.id,ID('N'),e.damage]],`the ${kind} walked the N avenue to its barricade and hit it`);
  }
  // Together: whoever reaches the mouth first bashes it; retreating bodies and the boss pressed on barricade L never hit.
  const {sys,world,hits,terrain}=aiWorld();
  world.players.set('p',player('p',plazaFarFromN(terrain)));
  const n=sys.state.barricades!.find(b=>b.id===ID('N'))!;
  const bebado=createEnemy(world,'bebado',upN(terrain,8));
  const anao=createEnemy(world,'anao-molotov',upN(terrain,10));
  // Pressed against barricade L from its avenue (out of the N avenue's way): neither may ever hit it.
  const l=sys.state.barricades!.find(b=>b.id===ID('L'))!;
  const retreat=createEnemy(world,'bebado',{x:l.x+l.r+.3,y:l.y-.4});retreat.memory!.retreat=1;
  const boss=createEnemy(world,'tio-pave',{x:l.x+l.r+.5,y:l.y+.5});boss.boss=true;
  for(const e of [retreat,boss])assert.ok(Math.hypot(e.x-l.x,e.y-l.y)-l.r<=e.radius+.27,`${e.id} touches barricade L`);
  for(let t=0;t<ticks(30);t++)world.step();
  assert.ok(hits.some(h=>(h.enemy===bebado.id||h.enemy===anao.id)&&h.id===ID('N')),'barricade N bashed');
  assert.ok(!hits.some(h=>h.enemy===retreat.id),'retreating bodies never hit (D-010)');
  assert.equal(l.hp,BARRICADE_MAX_HP);
  assert.ok(!hits.some(h=>h.enemy===boss.id),'the boss is not the enemy-ai\'s');
  assert.ok(n.hp<BARRICADE_MAX_HP&&!n.down);
});

// ---------- Restore, isolation, defeat ----------
test('a checkpoint restore rebuilds the blockers from the state; forks never share them',()=>{
  const a=cityBase(),ctx=fakeCtx(a.terrain,[],'wave');
  a.sys.hit(ctx,ID('O'),1e9);
  const saved=JSON.parse(JSON.stringify(a.sys.state));
  const b=shared.fork();
  b.setBlocker(ID('O'),{x:P.bocas.O.x,y:P.bocas.O.y,r:1});b.setBlocker('outro',{x:10,y:10,r:1});
  const restored=createStonewardsSystem({terrain:b,siegeContact:false},saved);
  assert.deepEqual(blockerIds(b),[ID('L'),ID('N'),ID('S'),'outro'],'O stays open after the restore, the rest up');
  assert.deepEqual(restored.state.barricades,saved.barricades);
  assert.deepEqual(blockerIds(a.terrain),[ID('L'),ID('N'),ID('S')]);
  const c=cityBase();
  assert.deepEqual(blockerIds(c.terrain),MOUTHS.map(ID).sort(),'another room still has all four');
  assert.deepEqual(shared.blockers(),[]);
  // A rematch raises them again and reports the reopened cells.
  const before=a.rects.length;
  a.sys.reset();
  assert.deepEqual(blockerIds(a.terrain),MOUTHS.map(ID).sort());
  assert.equal(a.rects.length,before+1);
  assert.deepEqual(a.planner.targetFor(spawnOf('O')),{kind:'barricade',mouth:'O'});
});

function cityRun(){
  const terrain=shared.fork(),world=new SimWorld({terrain,seed:9,order:RUN_ORDER});
  world.players.set('p0',player('p0',P.praca));
  const outcomes:RunOutcomeKind[]=[];
  const run=createRunSystems(world,{takeInput:()=>undefined,onOutcome:o=>{outcomes.push(o);}});
  return {terrain,world,run,outcomes};
}

test('city defeat: barricades down are not a defeat; the wall down is, exactly once; a same-tick victory wins (D-016)',()=>{
  const {world,run,outcomes,terrain}=cityRun();
  assert.ok(run.avenues,'the city run has its planner');
  assert.equal(run.stonewards.state.barricades?.length,4);
  let act:(ctx:SimContext)=>void=()=>{};
  world.clearSystems().register({id:'players',step(ctx){act(ctx);}}).register(run.stonewards);
  act=ctx=>{for(const m of MOUTHS)run.stonewards.hit(ctx,ID(m),1e9);};
  world.step();
  assert.deepEqual(outcomes,[]);
  assert.deepEqual(blockerIds(terrain),[]);
  for(const m of MOUTHS)assert.deepEqual(run.avenues!.targetFor(spawnOf(m)),{kind:'plaza'},'assemble refreshed the grid and planner');
  act=ctx=>{run.stonewards.hit(ctx,'muralha',1e9);};
  world.step();
  act=()=>{};
  for(let i=0;i<5;i++)world.step();
  assert.deepEqual(outcomes,['defeat']);
  run.dispose();

  const same=cityRun(),boss=createEnemy(same.world,'bebado',{x:P.praca.x+3,y:P.praca.y});boss.boss=true;
  same.world.clearSystems().register({id:'players',step(ctx){ctx.damageEnemy(boss.id,1e9,'p0');same.run.stonewards.hit(ctx,'muralha',1e9);}}).register(same.run.stonewards);
  same.world.step();
  assert.deepEqual(same.outcomes,['victory'],'the boss fell in the same tick: no defeat');
  same.run.dispose();
});

test('assemble: the city run raises the barricades on its terrain, the AI sees them as blocking structures',()=>{
  const {run,terrain}=cityRun();
  assert.deepEqual(blockerIds(terrain),MOUTHS.map(ID).sort());
  const targets=structureTargets(run.stonewards.state);
  assert.deepEqual(targets.map(t=>[t.id,!!t.blocking]),[['muralha',false],...MOUTHS.map(m=>[ID(m),true])]);
  run.dispose();
});

// ---------- Heroes walk through (barricades stop enemies only) ----------
/** A flow field over the hero rule on the terrain itself (blockers ignored), toward the cells around `goal`. */
function heroField(t:CityTerrain,goal:Point,within:number):FlowField{
  const cs=t.asset.unitsPerCell,w=t.asset.cells.w,h=t.asset.cells.h,probe={x:0,y:0};
  const grid:FlowGrid={width:w,height:h,cellSize:cs,originX:0,originY:0,
    walkable:(cx,cy)=>{probe.x=(cx+.5)*cs;probe.y=(cy+.5)*cs;return walkable(probe,t);}};
  const goals:Point[]=[];
  for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++){
    const c={x:(cx+.5)*cs,y:(cy+.5)*cs};
    if(Math.hypot(c.x-goal.x,c.y-goal.y)<=within&&grid.walkable(cx,cy))goals.push(c);
  }
  return new FlowField(grid,goals);
}
/** Follows `field` with `move` (one 1/30 s step per tick) until a goal cell; the deepest a body got into a barricade. */
function follow(t:CityTerrain,field:FlowField,from:Point,move:(at:Point,dir:Point)=>Point,maxTicks:number){
  let at={x:from.x,y:from.y},ticksUsed=0,deepest=-Infinity;const dir={x:0,y:0};
  for(;ticksUsed<maxTicks&&!field.atGoal(at.x,at.y);ticksUsed++){
    field.directionAt(at.x,at.y,dir);
    if(dir.x===0&&dir.y===0)break;
    at=move(at,dir);
    for(const b of t.blockers())deepest=Math.max(deepest,b.r-Math.hypot(at.x-b.x,at.y-b.y));
  }
  return {at,arrived:field.atGoal(at.x,at.y),deepest};
}

test('all 4 barricades up: a hero walks from the helicopter through a mouth to the forge at the fountain and back out; an enemy cannot',()=>{
  const {terrain,sys}=cityBase();
  assert.deepEqual(blockerIds(terrain),MOUTHS.map(ID).sort());
  // The plaza's middle (the centroid of its 4 mouths): the fountain's mouth S is only 2.4 u from the wall, so the camp
  // radius alone reaches past barricade S; the hero must get into the plaza proper.
  const b=P.bocas,wall=sys.state.wall,start=walkableNear(terrain,P.inicio);
  const middle={x:(b.N.x+b.S.x+b.L.x+b.O.x)/4,y:(b.N.y+b.S.y+b.L.y+b.O.y)/4};
  // Players move with moveDirection (players system, client prediction): the barricades are not in their way.
  const hero=(at:Point,dir:Point)=>moveDirection(at,dir,1/30,terrain);
  const toForge=follow(terrain,heroField(terrain,middle,3.5),start,hero,ticks(120));
  assert.ok(toForge.arrived,`the hero reached the forge (at ${toForge.at.x.toFixed(2)},${toForge.at.y.toFixed(2)})`);
  assert.ok(Math.hypot(toForge.at.x-wall.x,toForge.at.y-wall.y)<=CAMP_RADIUS);
  assert.ok(toForge.deepest>.5,`the hero went through a barricade disc (deepest ${toForge.deepest.toFixed(2)} u)`);
  // At the forge it can buy: a repair of the wall in the intermission.
  const ctx=fakeCtx(terrain,[player('h',toForge.at)]);
  sys.state.balance={coco:99,pedra:99};sys.state.wall.hp=100;
  assert.equal(sys.buy(ctx,'h','reparo','r1').ok,true);
  // And back out to the helicopter (loot in the intermission), through a barricade again.
  const out=follow(terrain,heroField(terrain,start,1),toForge.at,hero,ticks(120));
  assert.ok(out.arrived,`the hero left the plaza (at ${out.at.x.toFixed(2)},${out.at.y.toFixed(2)})`);
  assert.ok(out.deepest>.5,`back out through a barricade disc (deepest ${out.deepest.toFixed(2)} u)`);
  // An enemy body (moveSafely: the enemy view) following the very same field never gets into a disc nor the plaza.
  for(const radius of [RADIUS,.32]){
    const enemy=(at:Point,dir:Point)=>{const b={x:at.x,y:at.y};moveSafely(b,dir.x*.1,dir.y*.1,terrain,radius);return b;};
    const e=follow(terrain,heroField(terrain,middle,3.5),start,enemy,ticks(120));
    assert.equal(e.arrived,false,`radius ${radius}: the enemy did not reach the forge`);
    assert.ok(e.deepest<=-radius+1e-6,`radius ${radius}: the enemy never overlapped a barricade (deepest ${e.deepest.toFixed(3)} u)`);
  }
  assert.deepEqual(shared.blockers(),[]);
});

test('prizes keep off the standing barricades (and only there): island lists unchanged',()=>{
  const {sys}=cityBase(),blocks=prizeBlocks(sys.state);
  for(const b of sys.state.barricades!)assert.ok(blocks.some(k=>k.x===b.x&&k.y===b.y&&k.radius===b.r+PRIZE_BARRICADE_MARGIN),b.id);
  sys.state.barricades![0].down=true;
  assert.equal(prizeBlocks(sys.state).length,blocks.length-1,'a fallen barricade no longer keeps prizes off');
  const island=createStonewardsState({terrain:defaultTerrain});
  assert.deepEqual(prizeBlocks(island),[{x:island.wall.x,y:island.wall.y,radius:PRIZE_WALL_CLEAR}]);
});

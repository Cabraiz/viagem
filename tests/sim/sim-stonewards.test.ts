import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks} from '../../src/contract/types.ts';
import type {EnemyState,RoundPhase,SimEvent,SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {DEFAULT_SEED,defaultTerrain,TerrainField} from '../../src/maps/terrain/field.ts';
import {heroSpeed,moveDirection,obstacles,walkable} from '../../src/maps/world.ts';
import {createStonewardsSystem,HORN_LEAD,HORN_LINES,MAX_PREPARE_TICKS,MAX_STRETCH_PER_RUN,SAY_GAP,type StonewardsSystem} from '../../src/sim/stonewards/system.ts';
import {campNodes,CAMP_PILES} from '../../src/sim/stonewards/resources.ts';
import {ROUNDS} from '../../src/rules/waves.ts';
import {STONEWARDS_INTERMISSION_SECONDS} from '../../src/sim/assemble.ts';
import {RUN_DURATION_TICKS} from '../../src/sim/run.ts';
import {ROOM_CLOSING_MARGIN_MS,RUN_START_WINDOW_MS} from '../../multiplayer/room.ts';
import {PROTOCOL_VERSION} from '../../src/protocol/protocol4.ts';
import {readFileSync} from 'node:fs';
import {CAMP_RADIUS,FORGE_REFUSALS,forgePrice,returnTicks} from '../../src/rules/stonewards.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {createEnemy,enemyDef} from '../../src/sim/enemies/catalog.ts';
import {NODE_CAPACITY,WORK_PER_UNIT,DEPLETED_LINES,nodesNear,nodeValue} from '../../src/sim/stonewards/resources.ts';
import {RECIPES,MAX_TOWERS,TOWER_DURATION,TOWER_DAMAGE,TOWER_COOLDOWN} from '../../src/sim/stonewards/forge.ts';
import {damageWall,placeWall,SIEGE_FLAG,SIEGE_HIT_COOLDOWN,WALL_RADIUS,WALL_DOWN_LINES} from '../../src/sim/stonewards/wall.ts';

type FakeCtx=SimContext&{tick:number;events:SimEvent[];round:{index:number;phase:RoundPhase;phaseEndsTick:number}};

function player(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x,y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
function enemy(id:string,x:number,y:number,extra:Partial<EnemyState>={}):EnemyState{
  return {id,kind:'bebado',x,y,hp:30,maxHp:30,speed:1,damage:10,radius:.35,xp:1,spawnTick:0,readyTick:0,...extra};
}

function fakeCtx(players:SimPlayer[],phase:RoundPhase='prepare'):FakeCtx{
  const events:SimEvent[]=[],enemies=new Map<string,EnemyState>();
  let id=0;
  const unused=()=>{throw new Error('not used by stonewards');};
  return {
    tick:0,events,terrain:defaultTerrain,rng:new Rng(1),
    players:new Map(players.map(p=>[p.id,p])),
    enemies,pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},
    round:{index:1,total:10,phase,phaseEndsTick:ticks(20),remaining:0},
    enemyIndex:{rebuild:unused,query:unused,nearest(x,y,r,filter){
      let best:EnemyState|undefined,bd=Infinity;
      for(const e of [...enemies.values()].sort((a,b)=>a.id<b.id?-1:1)){
        const d=Math.hypot(e.x-x,e.y-y);if(d<=r&&d<bd&&(!filter||filter(e))){best=e;bd=d;}
      }
      return best;
    }},
    nextId:prefix=>`${prefix}${++id}`,
    emit:e=>{events.push(e);},
    damageEnemy(enemyId,amount){const e=enemies.get(enemyId);if(!e)return false;e.hp-=amount;if(e.hp<=0){enemies.delete(enemyId);return true;}return false;},
    damagePlayer:unused,
  };
}
const run=(ctx:FakeCtx,sys:StonewardsSystem,n:number)=>{for(let i=0;i<n;i++){ctx.tick++;sys.step(ctx);}};
const system=(extra:Partial<Parameters<typeof createStonewardsSystem>[0]>={})=>createStonewardsSystem({terrain:defaultTerrain,...extra});
const near=(i:number)=>({x:obstacles[i].x+obstacles[i].radius+.3,y:obstacles[i].y});
/** The forge's base prices in R$ (rules RECIPES; the source of truth) and a Grana no test runs out of. */
const REPARO=RECIPES.reparo.cost,GAMBIARRA=RECIPES.gambiarra.cost,CHINELO=RECIPES['torre-chinelo'].cost,PLENTY=1e6;

test('nodes come from the island obstacles: coco on palms/trees, pedra on rocks, value 1 near the base',()=>{
  const {state}=system();
  assert.equal(state.nodes.length,0,'sparse: nothing touched yet');
  const all=nodesNear(defaultTerrain,{x:12,y:12},50);
  assert.equal(all.length,obstacles.length);
  all.forEach((n,i)=>{
    assert.equal(n.id,`no-${n.kind}-${i}`);
    assert.equal(n.kind,obstacles[i].kind==='rock'?'pedra':'coco');
    assert.equal(n.capacity,NODE_CAPACITY[n.kind]);assert.equal(n.value,1);
  });
});

test('endless nodes: deterministic per seed and chunk, and worth more far from the base',()=>{
  const pick=(seed:number,p:{x:number;y:number},r:number)=>nodesNear(new TerrainField(seed,{world:'infinito'}),p,r);
  for(const seed of [7,4242]){
    const a=pick(seed,{x:0,y:0},70),b=pick(seed,{x:0,y:0},70);
    assert.ok(a.length>20);assert.deepEqual(b,a,'same seed, same nodes');
    // Built from another spot first (another chunk order): the nodes of a chunk do not change.
    const far=new TerrainField(seed,{world:'infinito'});nodesNear(far,{x:5000,y:5000},40);
    assert.deepEqual(nodesNear(far,{x:0,y:0},70),a);
    for(const n of a){
      assert.match(n.id,/^no-(-?\d+_-?\d+-\d+|base-\d)$/);
      assert.equal(n.value,nodeValue(Math.hypot(n.x,n.y)));
    }
    assert.ok(a.some(n=>n.value===1)&&a.some(n=>n.value>=3),'near and far nodes');
    assert.notDeepEqual(pick(seed+1,{x:0,y:0},70).map(n=>n.id+n.x),a.map(n=>n.id+n.x),'another seed, other nodes');
  }
  assert.deepEqual([0,15.9,16,31.9,32,56,500].map(nodeValue),[1,1,2,2,3,4,4]);
});

test('gathering works only in the intermission and only for standing players',()=>{
  const coco=obstacles.findIndex(o=>o.kind!=='rock');
  const a=player('a',near(coco).x,near(coco).y),d=player('d',a.x,a.y),o=player('o',a.x,a.y,{online:false});
  downedish(d);
  const ctx=fakeCtx([a,d,o],'wave'),sys=system();
  run(ctx,sys,WORK_PER_UNIT.coco*2);
  assert.equal(sys.state.balance.units,0);
  ctx.round.phase='prepare';
  run(ctx,sys,WORK_PER_UNIT.coco*2);
  assert.equal(sys.state.balance.units,2);
  assert.deepEqual(sys.state.gathered,{a:2});
});
function downedish(p:SimPlayer){p.hp=0;p.downed={sinceTick:0,bleedOutTick:600,progress:0};}
const nodeAt=(sys:StonewardsSystem,i:number)=>sys.state.nodes.find(n=>n.id===`no-${obstacles[i].kind==='rock'?'pedra':'coco'}-${i}`);

test('two players on the same node gather faster but never more than its capacity',()=>{
  const rock=obstacles.findIndex(o=>o.kind==='rock');
  const a=player('a',near(rock).x,near(rock).y),b=player('b',a.x,a.y+.1);
  const ctx=fakeCtx([a,b]),sys=system();
  run(ctx,sys,WORK_PER_UNIT.pedra);
  assert.equal(sys.state.balance.units,2);
  run(ctx,sys,ticks(15));
  assert.equal(sys.state.balance.units,NODE_CAPACITY.pedra);
  assert.equal((sys.state.gathered.a??0)+(sys.state.gathered.b??0),NODE_CAPACITY.pedra);
  assert.equal(nodeAt(sys,rock)!.remaining,0);
  assert.equal(sys.state.nodes.length,1,'one node touched, one record');
});

test('a far node pays its value per unit, and running dry says a joke once',()=>{
  const terrain=new TerrainField(4242,{world:'infinito'});
  const far=nodesNear(terrain,{x:0,y:0},80).find(n=>n.kind==='coco'&&n.value>=3)!;
  assert.ok(far,'a value-3 coco within 80 units');
  const a=player('a',far.x+far.radius+.3,far.y),ctx=fakeCtx([a]);
  (ctx as {terrain:TerrainField}).terrain=terrain;ctx.round.phaseEndsTick=ticks(999);
  const sys=createStonewardsSystem({terrain});
  run(ctx,sys,WORK_PER_UNIT.coco*NODE_CAPACITY.coco+5);
  assert.equal(sys.state.balance.units,far.value*NODE_CAPACITY.coco);
  assert.ok(Math.abs(sys.state.gathered.a-far.value*NODE_CAPACITY.coco)<1e-9);
  const says=ctx.events.filter(e=>e.type==='say');
  assert.equal(says.length,1);
  assert.ok(says[0].type==='say'&&says[0].key==='no-coco'&&(DEPLETED_LINES.coco as readonly string[]).includes(says[0].line)&&says[0].source==='a');
});

test('nodes refill once per intermission',()=>{
  const rock=obstacles.findIndex(o=>o.kind==='rock');
  const a=player('a',near(rock).x,near(rock).y);
  const ctx=fakeCtx([a]),sys=system();
  run(ctx,sys,ticks(10));
  assert.equal(nodeAt(sys,rock)!.remaining,0);
  run(ctx,sys,ticks(5));
  assert.equal(nodeAt(sys,rock)!.remaining,0,'no refill inside the same intermission');
  ctx.round.phase='wave';run(ctx,sys,5);
  ctx.round.index=2;ctx.round.phase='prepare';ctx.round.phaseEndsTick=ctx.tick+ticks(20);
  a.x=40;run(ctx,sys,1);
  assert.equal(nodeAt(sys,rock),undefined,'full again: no record');
});

test('simultaneous purchases respect the team balance',()=>{
  const a=player('a',12,17),b=player('b',12.5,17);
  const ctx=fakeCtx([a,b]),sys=system();
  // D-048: the forge is paid in the team's Grana (R$); the pile of material is not touched.
  sys.state.grana=2*REPARO-1;sys.state.balance={units:80};sys.state.wall.hp=100;
  const r1=sys.buy(ctx,'a','reparo'),r2=sys.buy(ctx,'b','reparo');
  assert.equal(r1.ok,true);assert.deepEqual(r2,{ok:false,reason:'balance'});
  assert.equal(sys.state.grana,REPARO-1);assert.deepEqual(sys.state.balance,{units:80});
  assert.equal(FORGE_REFUSALS.balance,'Falta grana.');
});

test('a repair applies once: resent request ids are refused and not charged',()=>{
  const a=player('a',12,17);
  const ctx=fakeCtx([a]),sys=system();
  sys.state.grana=4*REPARO;sys.state.wall.hp=100;
  const first=sys.buy(ctx,'a','reparo','req-1');
  assert.equal(first.ok,true);
  assert.equal(sys.state.wall.hp,100+Math.ceil(sys.state.wall.maxHp*.25));
  assert.deepEqual(sys.buy(ctx,'a','reparo','req-1'),{ok:false,reason:'duplicate'});
  assert.equal(sys.state.grana,3*REPARO);
  assert.equal(ctx.events.filter(e=>e.type==='structure').length,1);
  sys.state.wall.hp=sys.state.wall.maxHp;
  assert.deepEqual(sys.buy(ctx,'a','reparo','req-2'),{ok:false,reason:'full'});
  assert.equal(sys.state.grana,3*REPARO);
});

test('purchases are refused outside the intermission, for downed players and for unknown recipes',()=>{
  const a=player('a',12,17),d=player('d',12,17);downedish(d);
  const ctx=fakeCtx([a,d],'wave'),sys=system();
  sys.state.grana=PLENTY;
  assert.deepEqual(sys.buy(ctx,'a','torre-chinelo'),{ok:false,reason:'phase'});
  ctx.round.phase='prepare';
  assert.deepEqual(sys.buy(ctx,'d','torre-chinelo'),{ok:false,reason:'player'});
  assert.deepEqual(sys.buy(ctx,'x','torre-chinelo'),{ok:false,reason:'player'});
  for(const id of ['__proto__','constructor','toString'])assert.deepEqual(sys.buy(ctx,'a',id),{ok:false,reason:'recipe'});
  assert.equal(sys.state.grana,PLENTY);
});

test('gambiarra raises one weapon below max and never touches evolutions',()=>{
  const a=player('a',12,17,{build:{weapons:[{id:'chinelo',level:8},{id:'boleto-evo',level:1},{id:'cafe',level:3}],passives:[]}});
  const ctx=fakeCtx([a]),sys=system();
  sys.state.grana=GAMBIARRA+forgePrice('gambiarra',{gambiarra:1});
  const r=sys.buy(ctx,'a','gambiarra');
  assert.ok(r.ok&&r.item==='cafe'&&r.level===4);
  assert.ok((RECIPES.gambiarra.lines as readonly string[]).includes(r.ok?r.line:''));
  a.build.weapons[2].level=8;
  assert.deepEqual(sys.buy(ctx,'a','gambiarra'),{ok:false,reason:'no-weapon'});
  assert.equal(sys.state.grana,forgePrice('gambiarra',{gambiarra:1}),'one gambiarra charged; the refusal charges nothing');
  assert.deepEqual(sys.state.forgeBought,{gambiarra:1},'nor counts for the inflação');
  assert.deepEqual(ctx.events.filter(e=>e.type!=='say'),[{type:'upgrade',player:'a',item:'cafe',level:4}]);
  assert.deepEqual(ctx.events.filter(e=>e.type==='say').map(e=>e.type==='say'&&[e.source,e.key]),[['a','gambiarra']],'D-013: the forge talks once');
});

test('chinelo towers shoot the nearest live enemy, respect the cap and expire',()=>{
  const a=player('a',12,17);
  const ctx=fakeCtx([a]),sys=system();
  sys.state.grana=PLENTY;
  for(let i=0;i<MAX_TOWERS;i++)assert.equal(sys.buy(ctx,'a','torre-chinelo').ok,true);
  assert.deepEqual(sys.buy(ctx,'a','torre-chinelo'),{ok:false,reason:'full'});
  sys.state.towers.splice(1);
  ctx.enemies.set('e2',enemy('e2',13.5,17,{hp:10000,maxHp:10000}));
  ctx.enemies.set('e1',enemy('e1',12.5,17,{hp:TOWER_DAMAGE}));
  run(ctx,sys,1);
  assert.equal(ctx.enemies.has('e1'),false);
  run(ctx,sys,TOWER_COOLDOWN);
  assert.equal(ctx.enemies.get('e2')!.hp,10000-TOWER_DAMAGE);
  run(ctx,sys,TOWER_DURATION);
  assert.equal(sys.state.towers.length,0);
  const hp=ctx.enemies.get('e2')!.hp;run(ctx,sys,20);
  assert.equal(ctx.enemies.get('e2')!.hp,hp);
});

test('siege enemies hit the wall on a cooldown; the fall is a defeat exactly once',()=>{
  let defeats=0;
  const ctx=fakeCtx([player('a',12,17)],'wave'),sys=system({wallMaxHp:25,onWallDestroyed:()=>{defeats++;}});
  const w=sys.state.wall;
  ctx.enemies.set('s1',enemy('s1',w.x+WALL_RADIUS,w.y,{memory:{[SIEGE_FLAG]:1}}));
  ctx.enemies.set('s2',enemy('s2',w.x-WALL_RADIUS,w.y,{memory:{[SIEGE_FLAG]:1},frozenUntil:9999}));
  ctx.enemies.set('n',enemy('n',w.x,w.y+WALL_RADIUS));
  ctx.enemies.set('r',enemy('r',w.x,w.y,{memory:{[SIEGE_FLAG]:1,retreat:1}}));
  run(ctx,sys,1);
  assert.equal(w.hp,15);
  run(ctx,sys,SIEGE_HIT_COOLDOWN-1);
  assert.equal(w.hp,15);
  run(ctx,sys,1);assert.equal(w.hp,5);
  ctx.enemies.set('s3',enemy('s3',w.x,w.y-WALL_RADIUS,{memory:{[SIEGE_FLAG]:1}}));
  run(ctx,sys,1);
  assert.equal(w.hp,0);assert.equal(defeats,1);assert.equal(sys.state.wallDown,true);
  run(ctx,sys,SIEGE_HIT_COOLDOWN*3);
  assert.equal(defeats,1);
  assert.equal(damageWall(ctx,sys.state,50),false);
  sys.state.grana=REPARO;ctx.round.phase='prepare';
  assert.deepEqual(sys.buy(ctx,'a','reparo'),{ok:false,reason:'wall-down'});
});

test('a wall brought down by another system is still reported once',()=>{
  let defeats=0;
  const ctx=fakeCtx([player('a',12,17)],'wave'),sys=system({onWallDestroyed:()=>{defeats++;}});
  assert.equal(damageWall(ctx,sys.state,1e9),true);
  run(ctx,sys,3);
  assert.equal(defeats,1);
});

test('the return horn sounds once per intermission, 5 s before it ends, never in the opening',()=>{
  const lines:string[]=[];
  const ctx=fakeCtx([player('a',12,17)]),sys=system({onHorn:(_,line)=>{lines.push(line);}});
  ctx.round.phaseEndsTick=ticks(3);
  run(ctx,sys,ticks(3));
  assert.equal(lines.length,0,'opening countdown before round 1');
  ctx.tick=0;ctx.round.index=2;ctx.round.phaseEndsTick=ticks(20);
  run(ctx,sys,ticks(20)-HORN_LEAD-1);
  assert.equal(lines.length,0);
  run(ctx,sys,1);
  assert.equal(lines.length,1);
  run(ctx,sys,HORN_LEAD);
  assert.equal(lines.length,1);
  assert.ok((HORN_LINES as readonly string[]).includes(lines[0]));
});

test('the wall sits on walkable land near the center, clear of obstacles, on several seeds',()=>{
  for(const seed of [1,2,3,42,0xdeadbeef,defaultTerrain.seed]){
    const terrain=seed===defaultTerrain.seed?defaultTerrain:new TerrainField(seed);
    const at=placeWall(terrain);
    assert.ok(walkable(at,terrain),`seed ${seed}`);
    assert.ok(Math.hypot(at.x-12,at.y-12)<=6);
    assert.ok(obstacles.every(o=>Math.hypot(at.x-o.x,at.y-o.y)>o.radius+WALL_RADIUS));
    assert.deepEqual(placeWall(terrain),at);
  }
});

test('same inputs replay the same state and events',()=>{
  const replay=()=>{
    const a=player('a',near(0).x,near(0).y,{build:{weapons:[{id:'chinelo',level:1},{id:'cafe',level:1}],passives:[]}});
    const ctx=fakeCtx([a]),sys=system();
    run(ctx,sys,ticks(6));
    sys.state.grana+=PLENTY;
    sys.buy(ctx,'a','gambiarra');sys.buy(ctx,'a','gambiarra');sys.buy(ctx,'a','torre-chinelo');
    return JSON.stringify([sys.state,ctx.events,a.build]);
  };
  assert.equal(replay(),replay());
});

test('hardening: NaN siege enemies, odd player ids, per-player request ids, fractional levels',()=>{
  const ctx=fakeCtx([player('a',12,17,{build:{weapons:[{id:'boleto',level:7.5},{id:'boleto',level:2}],passives:[]}}),player('b',12,17)],'wave'),sys=system();
  const w=sys.state.wall;
  ctx.enemies.set('n1',enemy('n1',Number.NaN,Number.NaN,{memory:{[SIEGE_FLAG]:1}}));
  ctx.enemies.set('n2',enemy('n2',1,1,{radius:Number.NaN,memory:{[SIEGE_FLAG]:1}}));
  run(ctx,sys,5);
  assert.equal(w.hp,w.maxHp);
  ctx.round.phase='prepare';sys.state.grana=PLENTY;
  assert.deepEqual(sys.buy(ctx,'a','gambiarra'),{ok:false,reason:'no-weapon'});
  w.hp=10;
  assert.equal(sys.buy(ctx,'a','reparo','1').ok,true);
  assert.equal(sys.buy(ctx,'b','reparo','1').ok,true);
  assert.deepEqual(sys.buy(ctx,'b','reparo','1'),{ok:false,reason:'duplicate'});
  // Ids that collide with Object.prototype keys still count correctly.
  const rock=obstacles.findIndex(o=>o.kind==='rock');
  const odd=['__proto__','constructor'].map(id=>player(id,near(rock).x,near(rock).y));
  const ctx2=fakeCtx(odd),sys2=system();
  run(ctx2,sys2,ticks(15));
  const g=sys2.state.gathered;
  assert.equal(Object.hasOwn(g,'__proto__')&&Object.hasOwn(g,'constructor'),true);
  assert.ok(Math.abs(g['__proto__']+g['constructor']-sys2.state.balance.units)<1e-9);
  assert.equal(sys2.state.balance.units,NODE_CAPACITY.pedra);
});

test('two gatherers on one node split the credit evenly',()=>{
  const rock=obstacles.findIndex(o=>o.kind==='rock');
  const a=player('a',near(rock).x,near(rock).y),b=player('b',a.x,a.y+.1);
  const ctx=fakeCtx([a,b]),sys=system();
  run(ctx,sys,ticks(15));
  assert.deepEqual(sys.state.gathered,{a:NODE_CAPACITY.pedra/2,b:NODE_CAPACITY.pedra/2});
});

test('the fall clears towers and is not reported again after a checkpoint restore',()=>{
  let defeats=0;
  const ctx=fakeCtx([player('a',12,17)]),sys=system({onWallDestroyed:()=>{defeats++;}});
  sys.state.grana=PLENTY;
  const t=sys.buy(ctx,'a','torre-chinelo');assert.ok(t.ok);
  damageWall(ctx,sys.state,1e9);
  run(ctx,sys,1);
  assert.equal(defeats,1);assert.equal(sys.state.towers.length,0);
  assert.deepEqual(ctx.events.at(-1),{type:'structure',id:t.ok?t.tower:'',hp:0,maxHp:80});
  const restored=createStonewardsSystem({terrain:defaultTerrain,onWallDestroyed:()=>{defeats++;}},JSON.parse(JSON.stringify(sys.state)));
  run(ctx,restored,3);
  assert.equal(defeats,1);
});

test('a checkpoint restore between purchases replays the same picks',()=>{
  const weapons=()=>({weapons:['chinelo','boleto','cafe','pombo','audio','guarda-chuva'].map(id=>({id,level:1})),passives:[]});
  const setup=()=>{const a=player('a',12,17,{build:weapons()});const ctx=fakeCtx([a]);ctx.rng=new Rng(99);return {a,ctx};};
  const straight=setup(),sys=system();
  sys.state.grana=PLENTY;
  const picks=[1,2,3,4].map(()=>{const r=sys.buy(straight.ctx,'a','gambiarra');return r.ok?r.item+r.line:'';});
  const split=setup(),first=system();
  first.state.grana=PLENTY;
  const before=[1,2].map(()=>{const r=first.buy(split.ctx,'a','gambiarra');return r.ok?r.item+r.line:'';});
  const restored=createStonewardsSystem({terrain:defaultTerrain},JSON.parse(JSON.stringify(first.state)));
  split.ctx.rng=new Rng(12345);
  const after=[1,2].map(()=>{const r=restored.buy(split.ctx,'a','gambiarra');return r.ok?r.item+r.line:'';});
  assert.deepEqual([...before,...after],picks);
});

test('reset starts a rematch from scratch, even after the wall fell',()=>{
  let defeats=0;
  const ctx=fakeCtx([player('a',12,17)]),sys=system({onWallDestroyed:()=>{defeats++;}});
  sys.state.grana=PLENTY;
  sys.buy(ctx,'a','torre-chinelo','r1');
  damageWall(ctx,sys.state,1e9);run(ctx,sys,1);
  assert.equal(defeats,1);
  const state=sys.state;
  sys.reset();
  assert.equal(sys.state,state,'same object, so holders of the state see the reset');
  assert.deepEqual(sys.state,createStonewardsSystem({terrain:defaultTerrain}).state);
  assert.equal('forgeBought' in sys.state,false,'the inflação starts over');
  ctx.tick=0;sys.state.grana=CHINELO;
  assert.equal(sys.buy(ctx,'a','torre-chinelo','r1').ok,true,'at its base price again');
  damageWall(ctx,sys.state,1e9);run(ctx,sys,1);
  assert.equal(defeats,2);
});

test('gambiarra leaves weapons of a pending upgrade card alone',()=>{
  const a=player('a',12,17,{build:{weapons:[{id:'cafe',level:3},{id:'boleto',level:2}],passives:[]}});
  const ctx=fakeCtx([a]),sys=system();
  ctx.offers.set('a',[{id:'rnd-1',playerId:'a',source:'round',level:2,choices:[{itemId:'cafe',level:4},{itemId:'tenis',level:1}],deadlineTick:999,defaultIndex:0}]);
  sys.state.grana=PLENTY;
  for(let i=0;i<3;i++){const r=sys.buy(ctx,'a','gambiarra');assert.ok(r.ok&&r.item==='boleto');}
  assert.equal(a.build.weapons[0].level,3);
});

test('zueira: every recipe, horn and fall has pt-BR jokes',()=>{
  for(const r of Object.values(RECIPES)){assert.ok(r.name&&r.describe);assert.ok(r.lines.length>=3);}
  assert.ok(RECIPES.gambiarra.lines.includes('Gambiarra aprovada pelo INMETRO, confia.'));
  assert.ok(HORN_LINES.length>=3&&WALL_DOWN_LINES.length>=3);
  assert.ok(DEPLETED_LINES.coco.length>=3&&DEPLETED_LINES.pedra.length>=3);
});

// ---------- VGM-046B / base-stonewards-mapa / E8 ----------

test('the horn sounds as early as the farthest hero needs to walk back, never later than 5 s before the end',()=>{
  const out=player('out',12,12+CAMP_RADIUS+24),home=player('home',12,17);
  const ctx=fakeCtx([out,home]),sys=system();
  ctx.round.index=3;ctx.round.phaseEndsTick=ticks(30);
  // The horn times the hero's real walk (maps heroSpeed: the 2× walk, 6.2 u/s on the island).
  const lead=returnTicks(Math.hypot(out.x-sys.state.wall.x,out.y-sys.state.wall.y),heroSpeed(defaultTerrain));
  assert.ok(lead>HORN_LEAD&&lead<ticks(30),`lead ${lead}`);
  assert.ok(lead<returnTicks(Math.hypot(out.x-sys.state.wall.x,out.y-sys.state.wall.y)),'shorter than at the base walk');
  run(ctx,sys,ticks(30)-lead-1);
  assert.equal(ctx.events.filter(e=>e.type==='horn').length,0);
  run(ctx,sys,1);
  const horns=ctx.events.filter(e=>e.type==='horn');
  assert.equal(horns.length,1);
  assert.ok(horns[0].type==='horn'&&horns[0].endsTick===ticks(30)&&(HORN_LINES as readonly string[]).includes(horns[0].line!));
  assert.equal(sys.state.hornEndsTick,ticks(30));
  // Nobody out: plain HORN_LEAD.
  const ctx2=fakeCtx([home]),sys2=system();ctx2.round.index=2;ctx2.round.phaseEndsTick=ticks(30);
  run(ctx2,sys2,ticks(30)-HORN_LEAD-1);assert.equal(ctx2.events.filter(e=>e.type==='horn').length,0);
  run(ctx2,sys2,1);assert.equal(ctx2.events.filter(e=>e.type==='horn').length,1);
});

test('a hero 300 units out (≈55 s at the 2× walk) who leaves on the horn is back in the camp before the round (endless map)',()=>{
  const terrain=new TerrainField(4242,{world:'infinito'});
  const sys=createStonewardsSystem({terrain,extendPrepare:(c,endsTick)=>{c.round.phaseEndsTick=endsTick;}});
  const w=sys.state.wall;
  // A straight way home (no lake on the line), so the test measures the horn, not the pathing.
  let start:{x:number;y:number}|undefined;
  for(let deg=0;deg<360&&!start;deg+=5){
    const a=deg*Math.PI/180,ok=Array.from({length:1200},(_,i)=>({x:w.x+Math.cos(a)*(300-i*.25),y:w.y+Math.sin(a)*(300-i*.25)})).every(p=>walkable(p,terrain));
    if(ok)start={x:w.x+Math.cos(a)*300,y:w.y+Math.sin(a)*300};
  }
  assert.ok(start,'a clear line home');
  const hero=player('far',start!.x,start!.y),ctx=fakeCtx([hero]);
  (ctx as {terrain:TerrainField}).terrain=terrain;
  ctx.round.index=4;ctx.round.phaseEndsTick=ticks(30);
  let hornTick=-1;
  for(let t=0;t<ticks(90)&&ctx.tick<ctx.round.phaseEndsTick;t++){
    ctx.tick++;sys.step(ctx);
    if(hornTick<0&&ctx.events.some(e=>e.type==='horn'))hornTick=ctx.tick;
    if(hornTick>=0)Object.assign(hero,moveDirection(hero,{x:w.x-hero.x,y:w.y-hero.y},1/20,terrain));
  }
  assert.equal(hornTick,1,'sounds at once: 20 s were never enough');
  assert.ok(ctx.round.phaseEndsTick>ticks(48),`stretched to ${ctx.round.phaseEndsTick/20} s`);
  assert.ok(ctx.round.phaseEndsTick<=MAX_PREPARE_TICKS,'never past the cap');
  assert.ok(Math.hypot(hero.x-w.x,hero.y-w.y)<=CAMP_RADIUS,`home with ${(Math.hypot(hero.x-w.x,hero.y-w.y)).toFixed(1)} u to go`);
});

test('the horn never stretches past the cap, nor in the opening, nor twice',()=>{
  const sys=createStonewardsSystem({terrain:defaultTerrain,extendPrepare:(c,endsTick)=>{c.round.phaseEndsTick=endsTick;}});
  // 800 u at the 2× walk (6.2 u/s): ≈144 s back, past the 75 s cap.
  const far=player('far',12,12+800),ctx=fakeCtx([far]);
  ctx.round.index=1;ctx.round.phaseEndsTick=ticks(3);
  run(ctx,sys,ticks(3));
  assert.equal(ctx.round.phaseEndsTick,ticks(3),'opening countdown: no horn, no stretch');
  ctx.round.phase='wave';run(ctx,sys,2);
  ctx.round.index=2;ctx.round.phase='prepare';ctx.round.phaseEndsTick=ctx.tick+ticks(30);
  const start=ctx.tick+1;
  run(ctx,sys,1);
  assert.equal(ctx.round.phaseEndsTick,start+MAX_PREPARE_TICKS,'capped from the first tick of the intermission');
  run(ctx,sys,ticks(10));
  assert.equal(ctx.events.filter(e=>e.type==='horn').length,1);
});

test('the forge works only inside the camp',()=>{
  const sys=system(),w=sys.state.wall;
  const out=player('out',w.x,w.y+CAMP_RADIUS+.5),in_=player('in',w.x,w.y+CAMP_RADIUS-.5);
  const ctx=fakeCtx([out,in_]);
  sys.state.grana=2*REPARO;w.hp=10;
  assert.deepEqual(sys.buy(ctx,'out','reparo'),{ok:false,reason:'away'});
  assert.equal(sys.state.grana,2*REPARO);
  assert.equal(sys.buy(ctx,'in','reparo').ok,true);
  assert.ok(FORGE_REFUSALS.away&&FORGE_REFUSALS.balance);
});

test('D-013: the forge says one line per player every 2 s; purchases still apply',()=>{
  const a=player('a',12,17,{build:{weapons:[{id:'chinelo',level:1}],passives:[]}}),b=player('b',12.4,17);
  const ctx=fakeCtx([a,b]),sys=system();
  sys.state.grana=PLENTY;sys.state.wall.hp=10;
  assert.ok(sys.buy(ctx,'a','reparo').ok);assert.ok(sys.buy(ctx,'a','gambiarra').ok);assert.ok(sys.buy(ctx,'b','torre-chinelo').ok);
  let says=ctx.events.filter(e=>e.type==='say');
  assert.deepEqual(says.map(e=>e.type==='say'&&e.source),['a','b']);
  run(ctx,sys,SAY_GAP);
  assert.ok(sys.buy(ctx,'a','reparo').ok);
  says=ctx.events.filter(e=>e.type==='say');assert.equal(says.length,3);
});

test('siegeContact:false: the 046A contact siege never hurts the wall (D-017)',()=>{
  const ctx=fakeCtx([player('a',12,17)],'wave'),sys=system({siegeContact:false});
  const w=sys.state.wall;
  ctx.enemies.set('s1',enemy('s1',w.x+WALL_RADIUS,w.y,{memory:{[SIEGE_FLAG]:1}}));
  run(ctx,sys,SIEGE_HIT_COOLDOWN*5);
  assert.equal(w.hp,w.maxHp);
});

/** Island room simulation with the whole run wired (assemble.ts), in the wave of round 2. */
function runSim(players=1){
  const s=new Simulation(DEFAULT_SEED);
  for(let i=0;i<players;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  return s;
}

test('E8 integrated: a siege enemy on the wall deals exactly its damage per contact cooldown, never double; others ignore it',()=>{
  const s=runSim(1),w=s.world,wall=s.run.stonewards.state.wall;
  // Keep the director out (no waves), the only player far on the island and unhurt.
  s.run.director.state.stage='done';
  const p=s.players.get('p0')!;Object.assign(p,{x:4,y:12});
  const siege=createEnemy(w,'bebado',{x:wall.x+WALL_RADIUS+.3,y:wall.y},1);siege.memory={[SIEGE_FLAG]:1};
  const plain=createEnemy(w,'bebado',{x:wall.x,y:wall.y-WALL_RADIUS-.3},1);
  const def=enemyDef('bebado'),hits:number[]=[];
  for(let t=0;t<def.contactCooldown*6+10;t++){
    p.hp=p.stats.maxHp;p.invulnerableUntil=w.tick+5;p.build.weapons=[];
    const before=wall.hp;s.step();if(wall.hp<before)hits.push(before-wall.hp);
  }
  assert.ok(hits.length>=6,`hits ${hits.length}`);
  assert.ok(hits.every(h=>h===siege.damage),`each hit is one bêbado bite: ${hits.join(',')}`);
  assert.ok(hits.length<=Math.ceil((def.contactCooldown*6+10)/def.contactCooldown),'one hit per contact cooldown, never two paths');
  assert.ok(Math.hypot(plain.x-wall.x,plain.y-wall.y)>WALL_RADIUS+plain.radius+.5,'the plain bêbado left the wall for the player');
});

test('the wall falling is a defeat exactly once, and the D-016 boss blow still wins a same-tick tie',()=>{
  const s=runSim(2),wall=s.run.stonewards.state.wall;
  s.run.director.state.stage='done';
  wall.hp=3;
  const siege=createEnemy(s.world,'tio-pave',{x:wall.x+WALL_RADIUS+.3,y:wall.y},1);siege.memory={[SIEGE_FLAG]:1};
  for(const p of s.players.values())Object.assign(p,{x:4,y:12});
  for(let t=0;t<40&&!s.outcome;t++)s.step();
  // The director is 'done' here (runEnded): the D-016 rule blocks the defeat, like a boss already down.
  assert.equal(s.outcome,undefined);assert.equal(s.run.stonewards.state.wallDown,true);
  const s2=runSim(2),wall2=s2.run.stonewards.state.wall;
  let outcomes=0;
  // A wave of round 3 with the director frozen (no spawns): only the siege enemy and the wall matter.
  (s2.run.director as {step:(ctx:unknown)=>void}).step=()=>{};
  s2.run.director.state.stage='wave';Object.assign(s2.world.round,{index:3,phase:'wave',phaseEndsTick:99999});
  wall2.hp=3;
  const e=createEnemy(s2.world,'tio-pave',{x:wall2.x+WALL_RADIUS+.3,y:wall2.y},1);e.memory={[SIEGE_FLAG]:1};
  for(const p of s2.players.values())Object.assign(p,{x:4,y:12});
  for(let t=0;t<60;t++){const before=s2.outcome;s2.step();if(s2.outcome&&!before)outcomes++;}
  assert.equal(s2.outcome,'defeat');assert.equal(outcomes,1);
  assert.equal(s2.run.revive.defeated,false,'not a team wipe: the wall');
});

test('review onda 6: the stretches of a run share one budget, and a stretched intermission carries its offers',()=>{
  const terrain=new TerrainField(4242,{world:'infinito'});
  const sys=createStonewardsSystem({terrain,extendPrepare:(c,endsTick)=>{c.round.phaseEndsTick=endsTick;}});
  const far=player('far',300,300),ctx=fakeCtx([far]);(ctx as {terrain:TerrainField}).terrain=terrain;
  let total=0;
  for(let round=2;round<=10;round++){
    ctx.round.phase='wave';run(ctx,sys,2);
    ctx.round.index=round;ctx.round.phase='prepare';const planned=ctx.tick+ticks(30);ctx.round.phaseEndsTick=planned;
    run(ctx,sys,2);total+=ctx.round.phaseEndsTick-planned;
  }
  assert.equal(total,MAX_STRETCH_PER_RUN,'nine far heroes stretch 90 s in all, not 9 × 45 s');
  assert.equal(sys.state.stretched,MAX_STRETCH_PER_RUN);
});

test('a stretched intermission moves the round offer due at its old end (assemble wiring)',()=>{
  const s=new Simulation(4242,{world:'infinito',experimental:true});s.add('p0','P0','cidadao-comum');s.resetRun();
  const w=s.world;
  // Director frozen in the intermission of round 3; the only hero 150 units out (the horn must stretch it).
  (s.run.director as {step:(c:unknown)=>void}).step=()=>{};
  s.run.director.state.stage='prepare';
  const old=w.tick+ticks(10);Object.assign(w.round,{index:3,total:10,phase:'prepare',phaseEndsTick:old,remaining:0});
  const p=s.players.get('p0')!;
  for(let a=0;a<360;a+=10){const q={x:Math.cos(a*Math.PI/180)*150,y:Math.sin(a*Math.PI/180)*150};if(walkable(q,s.terrain)){Object.assign(p,q);break;}}
  w.offers.set('p0',[{id:'rnd-2-p0',playerId:'p0',source:'round',level:2,choices:[{itemId:'tenis',level:1}],deadlineTick:old,defaultIndex:0},
    {id:'lvl-5-p0',playerId:'p0',source:'level',level:5,choices:[{itemId:'ima',level:1}],deadlineTick:old+ticks(10),defaultIndex:0}]);
  s.step();
  assert.ok(w.round.phaseEndsTick>old,'stretched');
  assert.equal(s.run.director.state.round.phaseEndsTick,w.round.phaseEndsTick,'the director knows the new end');
  assert.equal(w.offers.get('p0')![0].deadlineTick,w.round.phaseEndsTick,'the round offer follows the new end');
  assert.equal(w.offers.get('p0')![1].deadlineTick,old+ticks(10),'others keep their own clock');
});

test('the camp piles: six nodes a few steps out of the camp on every endless seed, on open ground',()=>{
  for(const seed of [1,7,42,4242,0xdeadbeef]){
    const terrain=new TerrainField(seed,{world:'infinito'});
    const piles=campNodes(terrain);
    assert.equal(piles.length,CAMP_PILES);
    assert.deepEqual(piles.map(n=>n.kind).sort(),['coco','coco','coco','pedra','pedra','pedra']);
    for(const n of piles){
      const d=Math.hypot(n.x,n.y);assert.ok(d>CAMP_RADIUS&&d<CAMP_RADIUS+3,`${seed}: ${d}`);
      assert.ok(walkable({x:n.x+.6,y:n.y},terrain)||walkable({x:n.x-.6,y:n.y},terrain),'a hero can stand by it');
    }
    assert.ok(nodesNear(terrain,{x:0,y:5},12).some(n=>n.id.startsWith('no-base-')),'seen from the spawn');
  }
});

test('a worst-case run fits the room: every round to its timeout, every horn stretched, boss at its nominal time',()=>{
  const opening=3,rounds=ROUNDS.reduce((sum,r)=>sum+r.maxDuration,0);
  const worst=opening+rounds+9*STONEWARDS_INTERMISSION_SECONDS+MAX_STRETCH_PER_RUN/20;
  assert.ok(worst*20<=RUN_DURATION_TICKS,`${worst} s under the 20 min safety cap`);
  assert.ok(worst*1000+ROOM_CLOSING_MARGIN_MS<=RUN_START_WINDOW_MS,`${(worst/60).toFixed(1)} min + margin within the start window`);
});

test('the release workflow checks the protocol this client speaks',()=>{
  // The workflow reads the protocol from public/multiplayer.json and refuses to publish the site in front of a Worker
  // that speaks another one; that file must match the protocol this client speaks.
  const yml=readFileSync(new URL('../../.github/workflows/pages.yml',import.meta.url),'utf8');
  assert.ok(yml.includes(`require('./public/multiplayer.json').protocol`));
  assert.ok(yml.includes('grep -q "\\"protocol\\":$WANT[,}]"'));
  // The full-size protocol stress (6 clients) runs only in CI; dropping that step would hide the 4G budget margin.
  assert.match(yml,/^\s*- run: npm run test:protocol:stress\s*$/m,'CI runs the protocol stress (an active step, not a comment)');
  const config=JSON.parse(readFileSync(new URL('../../public/multiplayer.json',import.meta.url),'utf8'));
  assert.equal(config.protocol,PROTOCOL_VERSION);
});

test('inflação (D-048 balance): each gambiarra or chinelo bought this run raises its price by its base; the repair never inflates',async()=>{
  const {forgePrice,RECIPES,INFLATING}=await import('../../src/rules/index.ts');
  assert.deepEqual([...INFLATING],['gambiarra','torre-chinelo']);
  const g=RECIPES.gambiarra.cost,c=RECIPES['torre-chinelo'].cost,r=RECIPES.reparo.cost;
  assert.equal(forgePrice('gambiarra'),g);assert.equal(forgePrice('gambiarra',{gambiarra:1}),2*g);assert.equal(forgePrice('gambiarra',{gambiarra:3,'torre-chinelo':9}),4*g);
  assert.equal(forgePrice('torre-chinelo',{'torre-chinelo':2}),3*c);assert.equal(forgePrice('reparo',{gambiarra:5,reparo:5}),r,'defence keeps its price');
  assert.equal(forgePrice('gambiarra',{gambiarra:-3}),g,'never below the base');
});

test('inflação in the sim: two gambiarras charge base then 2× base, a reparo its base whatever was bought; reset forgets it',()=>{
  const a=player('a',12,17,{build:{weapons:[{id:'chinelo',level:1},{id:'cafe',level:1}],passives:[]}});
  const ctx=fakeCtx([a]),sys=system();
  sys.state.grana=PLENTY;sys.state.wall.hp=10;
  assert.equal('forgeBought' in sys.state,false,'absent until the first purchase');
  const paid=(id:string)=>{const g=sys.state.grana;assert.equal(sys.buy(ctx,'a',id).ok,true,id);return g-sys.state.grana;};
  assert.equal(paid('gambiarra'),GAMBIARRA,'the first at the base');
  assert.deepEqual(sys.state.forgeBought,{gambiarra:1});
  assert.equal(paid('gambiarra'),2*GAMBIARRA,'the second at 2× the base');
  assert.deepEqual(sys.state.forgeBought,{gambiarra:2});
  assert.equal(paid('torre-chinelo'),CHINELO,'each recipe inflates on its own');
  assert.equal(paid('reparo'),REPARO,'the repair keeps its base');
  assert.deepEqual(sys.state.forgeBought,{gambiarra:2,'torre-chinelo':1},'the repair is not counted');
  // A refusal (balance) charges nothing and counts nothing.
  sys.state.grana=forgePrice('gambiarra',sys.state.forgeBought)-1;
  assert.deepEqual(sys.buy(ctx,'a','gambiarra'),{ok:false,reason:'balance'});
  assert.deepEqual(sys.state.forgeBought,{gambiarra:2,'torre-chinelo':1});
  // The counts survive a checkpoint (JSON) and a new run (reset) starts at the base.
  const restored=createStonewardsSystem({terrain:defaultTerrain},JSON.parse(JSON.stringify(sys.state)));
  assert.deepEqual(restored.state.forgeBought,{gambiarra:2,'torre-chinelo':1});
  sys.reset();
  assert.equal('forgeBought' in sys.state,false,'reset with the run');
  sys.state.grana=PLENTY;ctx.tick+=SAY_GAP;
  assert.equal(paid('gambiarra'),GAMBIARRA,'the base again');
});

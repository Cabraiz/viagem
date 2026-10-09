import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {BASE_STATS,ticks} from '../src/game/sim/types.ts';
import type {EnemyState,RoundPhase,SimContext,SimEvent,SimPlayer} from '../src/game/sim/types.ts';
import {defaultTerrain,TerrainField} from '../src/game/terrain/field.ts';
import {obstacles,walkable} from '../src/game/world.ts';
import {createStonewardsSystem,HORN_LEAD,HORN_LINES,type StonewardsSystem} from '../src/game/sim/stonewards/system.ts';
import {NODE_CAPACITY,WORK_PER_UNIT,DEPLETED_LINES} from '../src/game/sim/stonewards/resources.ts';
import {RECIPES,MAX_TOWERS,TOWER_DURATION,TOWER_DAMAGE,TOWER_COOLDOWN} from '../src/game/sim/stonewards/forge.ts';
import {damageWall,placeWall,SIEGE_FLAG,SIEGE_HIT_COOLDOWN,WALL_RADIUS,WALL_DOWN_LINES} from '../src/game/sim/stonewards/wall.ts';

type FakeCtx=SimContext&{tick:number;events:SimEvent[];round:{index:number;phase:RoundPhase;phaseEndsTick:number}};

function player(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x,y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
function enemy(id:string,x:number,y:number,extra:Partial<EnemyState>={}):EnemyState{
  return {id,kind:'gosma',x,y,hp:30,maxHp:30,speed:1,damage:10,radius:.35,xp:1,spawnTick:0,readyTick:0,...extra};
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

test('nodes come from the island obstacles: coco on palms/trees, pedra on rocks',()=>{
  const {state}=system();
  assert.equal(state.nodes.length,obstacles.length);
  state.nodes.forEach((n,i)=>{
    assert.equal(n.kind,obstacles[i].kind==='rock'?'pedra':'coco');
    assert.equal(n.remaining,NODE_CAPACITY[n.kind]);
  });
});

test('gathering works only in the intermission and only for standing players',()=>{
  const coco=obstacles.findIndex(o=>o.kind!=='rock');
  const a=player('a',near(coco).x,near(coco).y),d=player('d',a.x,a.y),o=player('o',a.x,a.y,{online:false});
  downedish(d);
  const ctx=fakeCtx([a,d,o],'wave'),sys=system();
  run(ctx,sys,WORK_PER_UNIT.coco*2);
  assert.equal(sys.state.balance.coco,0);
  ctx.round.phase='prepare';
  run(ctx,sys,WORK_PER_UNIT.coco*2);
  assert.equal(sys.state.balance.coco,2);
  assert.deepEqual(sys.state.gathered,{a:2});
});
function downedish(p:SimPlayer){p.hp=0;p.downed={sinceTick:0,bleedOutTick:600,progress:0};}

test('two players on the same node gather faster but never more than its capacity',()=>{
  const rock=obstacles.findIndex(o=>o.kind==='rock');
  const a=player('a',near(rock).x,near(rock).y),b=player('b',a.x,a.y+.1);
  const ctx=fakeCtx([a,b]),sys=system();
  run(ctx,sys,WORK_PER_UNIT.pedra);
  assert.equal(sys.state.balance.pedra,2);
  run(ctx,sys,ticks(15));
  assert.equal(sys.state.balance.pedra,NODE_CAPACITY.pedra);
  assert.equal((sys.state.gathered.a??0)+(sys.state.gathered.b??0),NODE_CAPACITY.pedra);
  assert.equal(sys.state.nodes[rock].remaining,0);
});

test('nodes refill once per intermission',()=>{
  const rock=obstacles.findIndex(o=>o.kind==='rock');
  const a=player('a',near(rock).x,near(rock).y);
  const ctx=fakeCtx([a]),sys=system();
  run(ctx,sys,ticks(10));
  assert.equal(sys.state.nodes[rock].remaining,0);
  run(ctx,sys,ticks(5));
  assert.equal(sys.state.nodes[rock].remaining,0,'no refill inside the same intermission');
  ctx.round.phase='wave';run(ctx,sys,5);
  ctx.round.index=2;ctx.round.phase='prepare';ctx.round.phaseEndsTick=ctx.tick+ticks(20);
  run(ctx,sys,1);
  assert.equal(sys.state.nodes[rock].remaining,NODE_CAPACITY.pedra);
});

test('simultaneous purchases respect the team balance',()=>{
  const a=player('a',12,17),b=player('b',12.5,17);
  const ctx=fakeCtx([a,b]),sys=system();
  sys.state.balance={coco:5,pedra:5};sys.state.wall.hp=100;
  const r1=sys.buy(ctx,'a','reparo'),r2=sys.buy(ctx,'b','reparo');
  assert.equal(r1.ok,true);assert.deepEqual(r2,{ok:false,reason:'balance'});
  assert.deepEqual(sys.state.balance,{coco:3,pedra:2});
});

test('a repair applies once: resent request ids are refused and not charged',()=>{
  const a=player('a',12,17);
  const ctx=fakeCtx([a]),sys=system();
  sys.state.balance={coco:10,pedra:10};sys.state.wall.hp=100;
  const first=sys.buy(ctx,'a','reparo','req-1');
  assert.equal(first.ok,true);
  assert.equal(sys.state.wall.hp,100+Math.ceil(sys.state.wall.maxHp*.25));
  assert.deepEqual(sys.buy(ctx,'a','reparo','req-1'),{ok:false,reason:'duplicate'});
  assert.deepEqual(sys.state.balance,{coco:8,pedra:7});
  assert.equal(ctx.events.filter(e=>e.type==='structure').length,1);
  sys.state.wall.hp=sys.state.wall.maxHp;
  assert.deepEqual(sys.buy(ctx,'a','reparo','req-2'),{ok:false,reason:'full'});
  assert.deepEqual(sys.state.balance,{coco:8,pedra:7});
});

test('purchases are refused outside the intermission, for downed players and for unknown recipes',()=>{
  const a=player('a',12,17),d=player('d',12,17);downedish(d);
  const ctx=fakeCtx([a,d],'wave'),sys=system();
  sys.state.balance={coco:99,pedra:99};
  assert.deepEqual(sys.buy(ctx,'a','torre-chinelo'),{ok:false,reason:'phase'});
  ctx.round.phase='prepare';
  assert.deepEqual(sys.buy(ctx,'d','torre-chinelo'),{ok:false,reason:'player'});
  assert.deepEqual(sys.buy(ctx,'x','torre-chinelo'),{ok:false,reason:'player'});
  for(const id of ['__proto__','constructor','toString'])assert.deepEqual(sys.buy(ctx,'a',id),{ok:false,reason:'recipe'});
  assert.deepEqual(sys.state.balance,{coco:99,pedra:99});
});

test('gambiarra raises one weapon below max and never touches evolutions',()=>{
  const a=player('a',12,17,{build:{weapons:[{id:'chinelo',level:8},{id:'boleto-evo',level:1},{id:'cafe',level:3}],passives:[]}});
  const ctx=fakeCtx([a]),sys=system();
  sys.state.balance={coco:8,pedra:4};
  const r=sys.buy(ctx,'a','gambiarra');
  assert.ok(r.ok&&r.item==='cafe'&&r.level===4);
  assert.ok((RECIPES.gambiarra.lines as readonly string[]).includes(r.ok?r.line:''));
  a.build.weapons[2].level=8;
  assert.deepEqual(sys.buy(ctx,'a','gambiarra'),{ok:false,reason:'no-weapon'});
  assert.deepEqual(sys.state.balance,{coco:4,pedra:2});
  assert.deepEqual(ctx.events,[{type:'upgrade',player:'a',item:'cafe',level:4}]);
});

test('chinelo towers shoot the nearest live enemy, respect the cap and expire',()=>{
  const a=player('a',12,17);
  const ctx=fakeCtx([a]),sys=system();
  sys.state.balance={coco:99,pedra:99};
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
  sys.state.balance={coco:9,pedra:9};ctx.round.phase='prepare';
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
    sys.state.balance.coco+=20;sys.state.balance.pedra+=20;
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
  ctx.round.phase='prepare';sys.state.balance={coco:99,pedra:99};
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
  assert.ok(Math.abs(g['__proto__']+g['constructor']-sys2.state.balance.pedra)<1e-9);
  assert.equal(sys2.state.balance.pedra,NODE_CAPACITY.pedra);
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
  sys.state.balance={coco:99,pedra:99};
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
  sys.state.balance={coco:99,pedra:99};
  const picks=[1,2,3,4].map(()=>{const r=sys.buy(straight.ctx,'a','gambiarra');return r.ok?r.item+r.line:'';});
  const split=setup(),first=system();
  first.state.balance={coco:99,pedra:99};
  const before=[1,2].map(()=>{const r=first.buy(split.ctx,'a','gambiarra');return r.ok?r.item+r.line:'';});
  const restored=createStonewardsSystem({terrain:defaultTerrain},JSON.parse(JSON.stringify(first.state)));
  split.ctx.rng=new Rng(12345);
  const after=[1,2].map(()=>{const r=restored.buy(split.ctx,'a','gambiarra');return r.ok?r.item+r.line:'';});
  assert.deepEqual([...before,...after],picks);
});

test('reset starts a rematch from scratch, even after the wall fell',()=>{
  let defeats=0;
  const ctx=fakeCtx([player('a',12,17)]),sys=system({onWallDestroyed:()=>{defeats++;}});
  sys.state.balance={coco:99,pedra:99};
  sys.buy(ctx,'a','torre-chinelo','r1');
  damageWall(ctx,sys.state,1e9);run(ctx,sys,1);
  assert.equal(defeats,1);
  const state=sys.state;
  sys.reset();
  assert.equal(sys.state,state,'same object, so holders of the state see the reset');
  assert.deepEqual(sys.state,createStonewardsSystem({terrain:defaultTerrain}).state);
  ctx.tick=0;sys.state.balance={coco:9,pedra:9};
  assert.equal(sys.buy(ctx,'a','torre-chinelo','r1').ok,true);
  damageWall(ctx,sys.state,1e9);run(ctx,sys,1);
  assert.equal(defeats,2);
});

test('gambiarra leaves weapons of a pending upgrade card alone',()=>{
  const a=player('a',12,17,{build:{weapons:[{id:'cafe',level:3},{id:'boleto',level:2}],passives:[]}});
  const ctx=fakeCtx([a]),sys=system();
  ctx.offers.set('a',[{id:'rnd-1',playerId:'a',source:'round',level:2,choices:[{itemId:'cafe',level:4},{itemId:'tenis',level:1}],deadlineTick:999,defaultIndex:0}]);
  sys.state.balance={coco:99,pedra:99};
  for(let i=0;i<3;i++){const r=sys.buy(ctx,'a','gambiarra');assert.ok(r.ok&&r.item==='boleto');}
  assert.equal(a.build.weapons[0].level,3);
});

test('zueira: every recipe, horn and fall has pt-BR jokes',()=>{
  for(const r of Object.values(RECIPES)){assert.ok(r.name&&r.describe);assert.ok(r.lines.length>=3);}
  assert.ok(RECIPES.gambiarra.lines.includes('Gambiarra aprovada pelo INMETRO, confia.'));
  assert.ok(HORN_LINES.length>=3&&WALL_DOWN_LINES.length>=3);
  assert.ok(DEPLETED_LINES.coco.length>=3&&DEPLETED_LINES.pedra.length>=3);
});

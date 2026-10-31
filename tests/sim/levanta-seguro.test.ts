// NEW-20261028-ORQ-comeca-armado-e-levanta-seguro (auditoria-jogabilidade-28-10 items 2-5), by seed:
//  - item 3: getting up shoves the critters within REVIVE_PUSH_RADIUS away and leaves 3.5 s of invulnerability;
//  - item 4: alone in the run (no bots) the first fall gets up by itself after 5 s; the second one is the defeat;
//  - item 2 (the heroes still start empty-handed, the user 25/10): in the real match a verde crate sits at most 3 u from
//    each hero's spawn, and every hero is untouchable until he opens his first crate or 20 s pass;
//  - item 5: every crate of the match sits where a hero walking from the spawn can stand within reach of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,ticks} from '../../src/contract/types.ts';
import {carGap} from '../../src/contract/objective.ts';
import type {EnemyState,SimEvent,SimPlayer,RoundPhase} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField,walkable,FlowField,UNREACHABLE,RADIUS,type Point} from '../../src/maps/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {
  REVIVE_INVULNERABLE_TICKS,REVIVE_PUSH_KNOCK,REVIVE_PUSH_RADIUS,REVIVE_TICKS,SOLO_SELF_REVIVE_TICKS,
  createReviveSystem,downPlayer,shoveFromRise,
} from '../../src/sim/revive.ts';
import {NEAR_START_WIDE_REACH,OPEN_REACH,START_GRACE_S,heroReach} from '../../src/sim/crates.ts';
import {cityLoot} from '../../src/sim/stonewards/loot.ts';

type FakeCtx=SimContext&{tick:number;events:SimEvent[]};
function player(id:string,x:number,y:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x,y,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
function enemy(id:string,x:number,y:number,extra:Partial<EnemyState>={}):EnemyState{
  return {id,kind:'bebado',x,y,hp:10,maxHp:10,...extra} as EnemyState;
}
function fakeCtx(players:SimPlayer[],enemies:EnemyState[]=[],phase:RoundPhase='wave'):FakeCtx{
  const events:SimEvent[]=[],unused=()=>{throw new Error('not used');};
  let id=0;
  const all=new Map(enemies.map(e=>[e.id,e]));
  return {
    tick:0,events,terrain:undefined as never,rng:new Rng(1),
    players:new Map(players.map(p=>[p.id,p])),
    enemies:all,pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),offers:new Map(),
    team:{xp:0,level:1,nextXp:5},round:{index:1,total:10,phase,phaseEndsTick:9999,remaining:0},
    enemyIndex:{rebuild:unused,nearest:unused,query:(x,y,r,out=[])=>{for(const e of all.values())if(Math.hypot(e.x-x,e.y-y)<=r)out.push(e);return out;}},
    nextId:prefix=>`${prefix}${++id}`,emit:e=>{events.push(e);},damageEnemy:unused,damagePlayer:unused,
  };
}
const run=(ctx:FakeCtx,sys:{step(c:SimContext):void},n:number)=>{for(let i=0;i<n;i++){ctx.tick++;sys.step(ctx);}};

test('item 3: getting up shoves the critters within REVIVE_PUSH_RADIUS outward (bosses and the other floor stay) and leaves 3.5 s of invulnerability',()=>{
  const a=player('a',10,10),b=player('b',11,10);
  const near=enemy('e1',10,11.5),edge=enemy('e2',10+REVIVE_PUSH_RADIUS,10),far=enemy('e3',13,10);
  const boss=enemy('e4',9,10,{boss:true} as Partial<EnemyState>),deck=enemy('e5',10,9,{andar:1});
  const ctx=fakeCtx([a,b],[near,edge,far,boss,deck]),sys=createReviveSystem();
  downPlayer(ctx,a);
  run(ctx,sys,REVIVE_TICKS);
  assert.equal(a.downed,undefined);
  assert.equal(a.invulnerableUntil,ctx.tick+REVIVE_INVULNERABLE_TICKS);
  assert.equal(REVIVE_INVULNERABLE_TICKS,ticks(3.5));
  assert.deepEqual(near.knock,{x:0,y:REVIVE_PUSH_KNOCK},'straight away from the hero');
  assert.ok(edge.knock&&edge.knock.x>0&&Math.abs(edge.knock.y)<1e-9,'the radius itself counts');
  for(const e of [far,boss,deck])assert.equal(e.knock,undefined,`${e.id} stays`);
  // A critter right on the hero goes some way (deterministic), never nowhere.
  const on=enemy('e6',5,5),c=fakeCtx([player('c',5,5)],[on]);
  assert.equal(shoveFromRise(c,c.players.get('c')!),1);
  assert.ok(Math.hypot(on.knock!.x,on.knock!.y)>REVIVE_PUSH_KNOCK-1e-9);
});

test('item 4: alone (no bots) the first fall gets up by itself after 5 s, with the shove and the invulnerability; the second fall is the defeat',()=>{
  const a=player('a',0,0),crowd=enemy('e1',1,0);
  let defeats=0;
  const ctx=fakeCtx([a],[crowd]),sys=createReviveSystem({onTeamDefeated:()=>{defeats++;}});
  assert.equal(sys.soloChances,1);
  downPlayer(ctx,a);
  run(ctx,sys,SOLO_SELF_REVIVE_TICKS-1);
  assert.ok(a.downed,'still down before 5 s');assert.equal(defeats,0,'the run waits');
  run(ctx,sys,1);
  assert.equal(a.downed,undefined);assert.ok(a.hp>0);
  assert.equal(a.invulnerableUntil,ctx.tick+REVIVE_INVULNERABLE_TICKS);
  assert.ok(crowd.knock&&crowd.knock.x>0,'shoved');
  assert.deepEqual(ctx.events.filter(e=>e.type==='revived'),[{type:'revived',player:'a'}]);
  assert.equal(sys.soloChances,0);
  ctx.tick+=REVIVE_INVULNERABLE_TICKS;downPlayer(ctx,a);run(ctx,sys,SOLO_SELF_REVIVE_TICKS*3);
  assert.ok(a.downed,'no second chance');assert.equal(defeats,1);
  // With a partner (a bot or a friend) nobody gets up alone: the partner revives.
  const x=player('x',0,0),y=player('y',30,30),duo=fakeCtx([x,y]),two=createReviveSystem();
  downPlayer(duo,x);run(duo,two,SOLO_SELF_REVIVE_TICKS*2);
  assert.ok(x.downed);assert.equal(two.soloChances,1);
});

// ---------- the real match (Cidade Nevada, chaveiro, ninhos, manual) ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,field=cityAsField(city),cs=city.asset.unitsPerCell;
type Chest={id:string;kind:string;x:number;y:number;value:number};
function match(seed:number,players:number){
  const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  for(let i=0;i<players;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  let now=1000;
  const heroes=()=>[...Array(players).keys()].map(i=>s.players.get(`p${i}`)!);
  const chests=()=>[...(s as unknown as {world:{pickups:Map<string,Chest>}}).world.pickups.values()].filter(k=>k.kind==='chest');
  return {s,heroes,chests,step:()=>s.step(now+=50)};
}
/** An independent hero flood fill (FlowField over the hero rule) from the spawn: can a hero stand within reach of p? */
const heroGrid={width:city.asset.cells.w,height:city.asset.cells.h,cellSize:cs,originX:0,originY:0,
  walkable:(cx:number,cy:number)=>walkable({x:(cx+.5)*cs,y:(cy+.5)*cs},city)};
const fieldFrom=(from:Point)=>new FlowField(heroGrid,[from],{wallPenalty:0});
const standsBy=(f:FlowField,p:Point)=>{
  const span=Math.ceil(OPEN_REACH/cs),cx=Math.floor(p.x/cs),cy=Math.floor(p.y/cs);
  for(let dy=-span;dy<=span;dy++)for(let dx=-span;dx<=span;dx++)
    if(f.cellCost(cx+dx,cy+dy)!==UNREACHABLE&&Math.hypot((cx+dx+.5)*cs-p.x,(cy+dy+.5)*cs-p.y)<=OPEN_REACH)return true;
  return false;
};

test('item 2: a verde crate by each hero\'s spawn (3 u; out to NEAR_START_WIDE_REACH in the block, itens-sem-nascer-colados), his own, on open ground he reaches, off the Uno (1, 3 and 6 heroes, seeds 1-8)',t=>{
  for(const players of [1,3,6])for(const seed of [1,2,3,4,5,6,7,8]){
    const m=match(seed,players);
    const spawn=m.heroes().map(p=>({x:p.x,y:p.y}));
    m.step();
    const f=fieldFrom(spawn[0]),chests=m.chests(),car=m.s.run.chaveiro!.state.car;
    // Each hero his own: a matching of heroes to verde crates within NEAR_START_WIDE_REACH of their spawn (augmenting paths).
    // itens-sem-nascer-colados: the near crates keep ITEM_MIN_GAP apart, so a hero in the block gets his out to NEAR_START_WIDE_REACH.
    const options=spawn.map(at=>chests.filter(c=>c.value===1&&Math.hypot(c.x-at.x,c.y-at.y)<=NEAR_START_WIDE_REACH+1e-9));
    const owner=new Map<string,number>();
    const assign=(i:number,seen:Set<string>):boolean=>options[i].some(c=>{
      if(seen.has(c.id))return false;
      seen.add(c.id);
      const o=owner.get(c.id);
      if(o===undefined||assign(o,seen)){owner.set(c.id,i);return true;}
      return false;
    });
    spawn.forEach((_,i)=>assert.ok(assign(i,new Set()),`seed ${seed}, ${players} heroes: p${i} has his own verde crate within ${NEAR_START_WIDE_REACH} u`));
    for(const c of chests.filter(c=>owner.has(c.id))){
      assert.ok(standsBy(f,c),`seed ${seed}: ${c.id} reached on foot`);
      assert.ok(walkable(c,city),'on open ground');
      // The heroes spawn beside the Uno: a crate on its body is out of every hero's reach (escuridao-justa, seed 1: bau-17).
      assert.ok(carGap(car,c)>=RADIUS,`seed ${seed}: ${c.id} off the Uno's body (${carGap(car,c).toFixed(2)} u)`);
    }
    if(seed===1)t.diagnostic(`${players} heroes: ${chests.length} crates, ${owner.size} near ones`);
  }
});

test('item 2: untouchable until the first crate opens, or 20 s at most',()=>{
  const m=match(7,2);
  m.step();
  const [a,b]=m.heroes(),t0=m.s.tick;
  for(const p of [a,b])assert.ok((p.invulnerableUntil??0)>=t0+ticks(START_GRACE_S)-2,`${p.id} untouchable at the start`);
  // a walks onto his near crate and stands still: the opening (verde 1 s) ends his grace; b keeps his.
  const crate=m.chests().filter(c=>c.value===1).sort((x,y)=>Math.hypot(x.x-a.x,x.y-a.y)-Math.hypot(y.x-a.x,y.y-a.y))[0];
  a.x=crate.x;a.y=crate.y;
  let opened=false;
  for(let i=0;i<ticks(3)&&!opened;i++){m.step();opened=!m.chests().some(c=>c.id===crate.id);a.hp=Math.max(a.hp,1);}
  assert.ok(opened,'a opened his crate');
  assert.ok((a.invulnerableUntil??0)<=m.s.tick,'a can be hit after his first crate');
  assert.ok((b.invulnerableUntil??0)>m.s.tick,'b still untouchable');
  while(m.s.tick<t0+ticks(START_GRACE_S)+2)m.step();
  assert.ok((b.invulnerableUntil??0)<=m.s.tick,'20 s: b can be hit too');
});

test('item 5: every crate of the match (start, near, placed, trail, floor) sits where a hero from the spawn can stand within reach',t=>{
  // The filter matters: the city has loot points walled off from the spawn (the bases are mazes).
  const m0=match(1,1),spawn0=m0.heroes()[0],reach=heroReach(field,[spawn0])!;
  const f0=fieldFrom(spawn0),cut=cityLoot(field)!.crates.filter(c=>!standsBy(f0,c.node));
  t.diagnostic(`${cut.length} of ${cityLoot(field)!.crates.length} loot points out of reach from the spawn`);
  for(const c of cityLoot(field)!.crates)if(!standsBy(fieldFrom(spawn0),c.node))assert.equal(reach(c.node),false,`${c.node.id} filtered`);
  for(const seed of [1,2,3]){
    const m=match(seed,3),spawn=m.heroes()[0],f=fieldFrom(spawn),seen=new Set<string>();
    for(let i=0;i<ticks(40);i++){
      // The heroes walk east a while (trail crates ahead of them), never hurt.
      for(const p of m.heroes()){const next={x:p.x+.2,y:p.y};if(walkable(next,city))p.x=next.x;p.hp=p.stats.maxHp;delete p.fear;}
      m.step();
      for(const c of m.chests())if(!seen.has(c.id)){seen.add(c.id);assert.ok(standsBy(f,c),`seed ${seed}: crate ${c.id} at ${c.x.toFixed(1)},${c.y.toFixed(1)} out of reach`);}
    }
    assert.ok(seen.size>=10,`seed ${seed}: ${seen.size} crates seen`);
  }
  assert.ok(RADIUS<OPEN_REACH);
});

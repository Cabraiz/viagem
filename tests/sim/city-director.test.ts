/**
 * cidade-05 (diretor-avenidas): on the REAL Cidade Nevada (public/maps/cidade-nevada.json, hash-checked by
 * cityTerrainFrom) the director places hordes through the avenue planner, and bodies steered by citySteer walk the
 * avenues to the plaza. The enemy-ai steer hook lands in another branch, so the walk is simulated here with the same
 * pieces the AI uses: nearest live player as the target, citySteer for the direction (straight at the target when it
 * declines), moveSafely with each body's radius and speed, 20 Hz.
 * D-031: no wall-clock asserts, except the bench, whose limit only applies with BENCH=1 (the number is always logged).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {RADIUS,SPAWN,walkable,type Point} from '../../src/maps/world.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type RoundState,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createDirector,type DirectorOptions,type RoundSummary} from '../../src/sim/director.ts';
import {moveSafely} from '../../src/sim/enemies/ai.ts';
import {MOUTHS,type AvenuePlanner,type Mouth} from '../../src/sim/city/avenues.ts';
import {cityFlowGrid,cityLayoutFrom,cityPlanner,citySteer} from '../../src/sim/city/grid.ts';
import {SCALE_PROFILES,enemySpeed} from '../../src/rules/scale.ts';

// ---------- The real city, built once ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain, CS=city.asset.unitsPerCell;
const PROFILE=SCALE_PROFILES['cidade-nevada'];
/** City common enemy speed (u/s, ≈1.79) and hero speed (u/s, ≈1.99). */
const CITY_SPEED=enemySpeed(PROFILE), HERO_SPEED=PROFILE.hero.speed;
let built:AvenuePlanner|undefined;
/** The shared planner (built on first use, so test 1 reports a constructor failure as such). */
const planner=()=>built??=cityPlanner(city);
const atGoal=(P:AvenuePlanner,p:Point)=>P.insideBase(p)||P.plazaField.atGoal(p.x,p.y);
const xy=(p:Point)=>({x:p.x,y:p.y});
const fmt=(p:Point)=>`(${p.x.toFixed(2)},${p.y.toFixed(2)})`;

// ---------- Director fixture (tests/sim/sim-director.test.ts) ----------
type FakeCtx=SimContext&{tick:number;ids:number;events:SimEvent[];sentAt:number[];round:RoundState;players:Map<string,SimPlayer>};
function fakeCtx(seed:number,terrain:SimContext['terrain']=city):FakeCtx{
  const round:RoundState={index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0};
  const ctx:FakeCtx={
    tick:0,runStartTick:0,ids:0,terrain,rng:new Rng(seed),events:[],sentAt:[],
    players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),
    team:{xp:0,level:1,nextXp:5},offers:new Map(),round,
    enemyIndex:{rebuild(){},query:()=>[],nearest:()=>undefined},
    nextId:prefix=>`${prefix}-${++ctx.ids}`,
    emit(event){ctx.events.push(event);ctx.sentAt.push(ctx.tick);},
    damageEnemy(id,amount){
      const e=ctx.enemies.get(id);if(!e)return false;
      e.hp-=amount;if(e.hp>0)return false;
      ctx.enemies.delete(id);ctx.emit({type:'kill',enemy:id,kind:e.kind,x:e.x,y:e.y});return true;
    },
    damagePlayer(){},
  } as FakeCtx;
  return ctx;
}
function addPlayer(ctx:FakeCtx,id:string,p:Point,extra:Partial<SimPlayer>={}){
  ctx.players.set(id,{id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS},weaponReady:{},...xy(p),...extra});
}
/** The team at the plaza: one at the planner's plaza center, one at the asset's praca point. */
function team(ctx:FakeCtx){addPlayer(ctx,'a',planner().plazaCenter);addPlayer(ctx,'b',city.asset.points.praca);}

interface Log {created:{tick:number;round:number;kind:string;x:number;y:number;scale:number}[];ends:RoundSummary[]}
const newLog=():Log=>({created:[],ends:[]});
function options(log:Log,extra:Partial<DirectorOptions>={}):DirectorOptions{
  return {
    createEnemy(ctx,kind,point,scale){
      const e:EnemyState={id:ctx.nextId('e'),kind,x:point.x,y:point.y,hp:10*scale,maxHp:10*scale,speed:CITY_SPEED,damage:5,radius:.32,xp:1,spawnTick:ctx.tick,readyTick:ctx.tick};
      ctx.enemies.set(e.id,e);log.created.push({tick:ctx.tick,round:ctx.round.index,kind,x:point.x,y:point.y,scale});return e;
    },
    spawnBoss(ctx,point){
      const e:EnemyState={id:ctx.nextId('boss'),kind:'chefe',boss:true,x:point.x,y:point.y,hp:500,maxHp:500,speed:1,damage:10,radius:.8,xp:50,spawnTick:ctx.tick,readyTick:ctx.tick};
      ctx.enemies.set(e.id,e);return e;
    },
    onRoundEnd:(_ctx,r)=>{log.ends.push(r);},
    ...extra,
  };
}
function run(ctx:FakeCtx,director:{step(ctx:SimContext):void},maxTicks:number,after?:(ctx:FakeCtx)=>void,stop?:()=>boolean){
  for(let i=0;i<maxTicks;i++){ctx.tick++;director.step(ctx);after?.(ctx);if(stop?.())break;}
}
const killAfter=(after:number)=>(ctx:FakeCtx)=>{
  for(const e of [...ctx.enemies.values()])if(ctx.tick-e.spawnTick>=after)ctx.damageEnemy(e.id,1e9);
};

// ---------- Walking without the AI hook ----------
type Steer=ReturnType<typeof citySteer>;
const live=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
const dir={x:0,y:0};
/** One enemy-ai walk step: nearest live player; citySteer's direction, else straight at it; stop at contact; moveSafely. */
function walk(ctx:SimContext,steer:Steer,e:EnemyState,speed=e.speed){
  let target:SimPlayer|undefined,best=Infinity;
  for(const p of ctx.players.values())if(live(p)){const d=Math.hypot(p.x-e.x,p.y-e.y);if(d<best){best=d;target=p;}}
  if(!target||best<=e.radius+RADIUS+.05)return;
  if(!steer(ctx,e,target,dir)){dir.x=(target.x-e.x)/best;dir.y=(target.y-e.y)/best;}
  const l=Math.hypot(dir.x,dir.y);
  if(!(l>1e-6))return;
  const step=speed/SIM_HZ/l;
  moveSafely(e,dir.x*step,dir.y*step,ctx.terrain,e.radius);
}

/** A walkable, plaza-connected cell center picked by r. */
function randomSpot(r:Rng):Point{
  const P=planner(),w=city.asset.cells.w,h=city.asset.cells.h;
  for(;;){
    const p={x:(r.int(0,w-1)+.5)*CS,y:(r.int(0,h-1)+.5)*CS};
    if(walkable(p,city)&&P.plazaField.reachable(p.x,p.y))return p;
  }
}
/** Point of mouth m's route at distance s (u) from its plaza end. */
function alongRoute(m:Mouth,s:number):Point{
  const pts=planner().route(m)!.points;
  let left=s;
  for(let i=pts.length-1;i>0;i--){
    const a=pts[i],b=pts[i-1],seg=Math.hypot(b.x-a.x,b.y-a.y);
    if(left<=seg){const f=seg>0?left/seg:0;return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};}
    left-=seg;
  }
  return xy(pts[0]);
}

/** Body kinds cycled over a horde: pernilongo, gosma ×2, fiscal, tio-pavê; every 50th is an elite tio (0.48 × 1.35). */
const KINDS=[{r:.2,v:2.7/1.4},{r:.32,v:1},{r:.32,v:1},{r:.3,v:1.3/1.4},{r:.48,v:1/1.4}];
const ELITE_RADIUS=.48*1.35;
/** 300 bodies placed by the planner over a 4-mouth round (20 groups of 15, nominal at every 2 s), team at the plaza. */
function horde(seed:number){
  const P=planner(),ctx=fakeCtx(seed),rng=new Rng(seed);
  team(ctx);
  const state=P.openRound(9,'normal',rng);
  const requests=Array.from({length:20},(_,i)=>({at:i*ticks(2),size:15}));
  const groups=P.planGroups(requests,[...ctx.players.values()],state,rng,{at0:0,indexBase:0,nowTick:0});
  const bodies:{e:EnemyState;release:number}[]=[];
  for(const g of groups)for(const p of g.points){
    const i=bodies.length,k=KINDS[i%KINDS.length],elite=i%50===49;
    const e:EnemyState={id:`h${i}`,kind:'gosma',x:p.x,y:p.y,hp:10,maxHp:10,speed:CITY_SPEED*(elite?.7:k.v),damage:5,radius:elite?ELITE_RADIUS:k.r,xp:1,spawnTick:g.releaseTick,readyTick:g.releaseTick};
    bodies.push({e,release:g.releaseTick});
  }
  return {P,ctx,state,bodies};
}

// ---------- 1. grid and layout ----------
test('cityFlowGrid/cityLayoutFrom read the real asset; the planner builds with a route per mouth',()=>{
  const a=city.asset,grid=cityFlowGrid(city);
  assert.equal(grid.width,a.cells.w);assert.equal(grid.height,a.cells.h);
  assert.equal(grid.cellSize,a.unitsPerCell);assert.equal(grid.originX??0,0);assert.equal(grid.originY??0,0);
  // A cell is walkable iff the hero rule holds at its center (the rule moveSafely uses).
  let open=0;
  for(let cy=0;cy<grid.height;cy++)for(let cx=0;cx<grid.width;cx++){
    const w=grid.walkable(cx,cy);if(w)open++;
    if(w!==walkable({x:(cx+.5)*CS,y:(cy+.5)*CS},city))assert.fail(`cell ${cx},${cy}: grid says ${w}, the hero rule disagrees`);
  }
  assert.ok(open>1000&&open<grid.width*grid.height,`open cells ${open}`);
  const layout=cityLayoutFrom(city),pts=a.points;
  assert.equal(layout.grid.width,a.cells.w);assert.equal(layout.grid.height,a.cells.h);assert.equal(layout.grid.cellSize,CS);
  const spawnOf={N:pts.spawnN,S:pts.spawnS,L:pts.spawnL,O:pts.spawnO};
  for(const m of MOUTHS){
    assert.deepEqual(xy(layout.spawns[m]),xy(spawnOf[m]),`spawn ${m}`);
    assert.deepEqual(xy(layout.mouths[m]),xy(pts.bocas[m]),`mouth ${m}`);
    for(const [what,p] of [['spawn',layout.spawns[m]],['mouth',layout.mouths[m]]] as const)
      assert.ok(layout.grid.walkable(Math.floor(p.x/CS),Math.floor(p.y/CS)),`${what} ${m} cell walkable at ${fmt(p)}`);
  }
  assert.ok(layout.plaza,'plaza fallback seed from praca');
  assert.deepEqual(xy(layout.plaza!),xy(pts.praca));
  assert.doesNotThrow(()=>planner());
  const lengths:string[]=[];
  for(const m of MOUTHS){
    const r=planner().route(m);
    assert.ok(r,`route ${m}`);assert.equal(r!.blocked,false,`route ${m} open`);
    assert.ok(r!.length>20,`route ${m}: ${r!.length}`);
    lengths.push(`${m} ${r!.length.toFixed(1)} u`);
  }
  console.log(`[cidade-05] routes spawn→plaza: ${lengths.join(', ')}; plaza center ${fmt(planner().plazaCenter)}`);
});

// ---------- 2. acceptance ----------
test('ACCEPTANCE 20 seeds, real city, 4 rounds (modifiers, siege share): every spawn hidden, ≥ 4 u from every player, outside the base, warned 30 ticks before',()=>{
  const P=planner();
  let total=0,offDisc=0,timeouts=0,siege=0;const modes=new Map<string,number>();
  for(let seed=0;seed<20;seed++){
    const ctx=fakeCtx(seed),log=newLog(),r=new Rng(seed*31+7);
    team(ctx);
    // A watcher in the city: anywhere on even seeds, 25 u up an avenue on odd ones; a walker and an offline body.
    addPlayer(ctx,'c1',seed%2?alongRoute(r.pick(MOUTHS),25):randomSpot(r));
    addPlayer(ctx,'c2',P.plazaCenter);
    addPlayer(ctx,'off',randomSpot(r),{online:false});
    // c2 walks out of the plaza along the exit field to an avenue end and back, at the city hero speed.
    let out=true;const wd={x:0,y:0};
    const walker=(c:FakeCtx)=>{
      const p=c.players.get('c2')!;
      if(out)P.retreatDirection(p,wd);else P.directionFor(p,{kind:'plaza'},wd);
      if(Math.hypot(wd.x,wd.y)<1e-6){out=!out;return;}
      moveSafely(p,wd.x*HERO_SPEED/SIM_HZ,wd.y*HERO_SPEED/SIM_HZ,city);
    };
    // Siege share as assemble.ts wires it (one group in four from round 2): siege bodies still flagged in the city.
    const director=createDirector(options(log,{rounds:4,avenues:P,siegeShare:.25,siegeFromRound:2}));
    const seen=new Set<string>();let mode='';
    run(ctx,director,ticks(800),c=>{
      const players=[...c.players.values()];
      for(const e of c.enemies.values()){
        if(seen.has(e.id))continue;
        seen.add(e.id);total++;
        const at=`seed ${seed} tick ${c.tick} ${e.id} at ${fmt(e)}`;
        assert.equal(e.spawnTick,c.tick,`${at}: checked on its spawn tick`);
        assert.ok(P.hiddenFrom(players,e),`${at}: visible to a player (${players.map(p=>`${p.id}${fmt(p)}`).join(' ')})`);
        for(const p of players)assert.ok(Math.hypot(p.x-e.x,p.y-e.y)>=4,`${at}: ${Math.hypot(p.x-e.x,p.y-e.y).toFixed(2)} u from ${p.id}`);
        assert.ok(!P.insideBase(e),`${at}: inside the base`);
        assert.ok(P.plazaField.reachable(e.x,e.y),`${at}: on a walkable cell connected to the plaza`);
        if(!walkable(e,city))offDisc++;
        if(e.memory?.siege===1)siege++;
      }
      const m=director.state.avenues?.mode;
      if(m&&c.round.phase==='wave'&&`${c.round.index}${m}`!==mode){mode=`${c.round.index}${m}`;modes.set(m,(modes.get(m)??0)+1);}
      killAfter(ticks(2))(c);walker(c);
    },()=>log.ends.length>=4);
    assert.equal(log.ends.length,4,`seed ${seed}: four rounds played`);
    assert.ok(log.created.length>0,`seed ${seed}: spawns happened`);
    timeouts+=log.ends.filter(e=>e.timedOut).length;
    const warnings=ctx.events.map((w,i)=>({w,sent:ctx.sentAt[i]})).filter(x=>x.w.type==='spawn-warning');
    for(const {w,sent} of warnings)if(w.type==='spawn-warning')assert.equal(w.atTick-sent,ticks(1.5),`seed ${seed}: warning lead`);
    for(const c of log.created){
      const warned=warnings.some(({w,sent})=>w.type==='spawn-warning'&&w.atTick===c.tick&&c.tick-sent===ticks(1.5)
        &&Math.hypot(w.x-c.x,w.y-c.y)<=w.count*.6+2);
      assert.ok(warned,`seed ${seed}: spawn at tick ${c.tick} ${fmt(c)} has a warning 30 ticks earlier near it`);
    }
  }
  assert.ok(siege>0,'siege groups still flagged memory.siege');
  console.log(`[cidade-05] acceptance: ${total} spawns over 20 seeds × 4 rounds (${siege} siege; modes ${[...modes].map(([m,n])=>`${m} ${n}`).join(', ')}); ${offDisc} on a cell-walkable point the hero disc rejects; ${timeouts} timed-out rounds`);
});

// ---------- 3. first arrival ----------
test('first arrival: team at the plaza, round 1, the first released group walks to the plaza in ≈ 12 s',()=>{
  const P=planner(),steer=citySteer(P),report:string[]=[];
  // Arrival = the planner's: a plaza goal cell, or contact with a player standing in the base (the praca point lies on
  // mouth line S, so bodies coming up S meet that player before any plaza cell). The mouth line (insideBase) comes
  // ~3 s earlier and is only logged.
  const touching=(c:FakeCtx,e:EnemyState)=>[...c.players.values()].some(p=>Math.hypot(p.x-e.x,p.y-e.y)<=e.radius+RADIUS+.1);
  for(let seed=1;seed<=6;seed++){
    const ctx=fakeCtx(seed),log=newLog();team(ctx);
    const director=createDirector(options(log,{rounds:1,avenues:P}));
    let first:Set<string>|undefined,arrival=-1,base=-1;
    run(ctx,director,ticks(60),c=>{
      if(!first){const fresh=[...c.enemies.values()].filter(e=>e.spawnTick===c.tick);if(fresh.length)first=new Set(fresh.map(e=>e.id));}
      for(const e of c.enemies.values())walk(c,steer,e,CITY_SPEED);
      if(first)for(const id of first){
        const e=c.enemies.get(id),at=c.tick-director.state.roundStart;
        if(!e)continue;
        if(base<0&&atGoal(P,e))base=at;
        if(arrival<0&&(P.plazaField.atGoal(e.x,e.y)||P.insideBase(e)&&touching(c,e)))arrival=at;
      }
    },()=>arrival>=0);
    const mode=director.state.avenues?.mode;
    assert.ok(first,`seed ${seed}: a group spawned`);
    assert.ok(arrival>=0,`seed ${seed}: the first group reached the plaza`);
    // 05b's documented corner case: a single-mouth excursão with someone in a plaza corner may take up to ~15 s.
    const limit=mode==='excursao'?ticks(15.5):ticks(13);
    assert.ok(base<=arrival&&arrival<=limit,`seed ${seed} (${mode}): first arrival ${(arrival/SIM_HZ).toFixed(2)} s`);
    assert.ok(arrival>=ticks(9),`seed ${seed}: first arrival ${(arrival/SIM_HZ).toFixed(2)} s is too early (spawned too close)`);
    report.push(`${(arrival/SIM_HZ).toFixed(2)} s (mouth line ${(base/SIM_HZ).toFixed(2)} s, ${mode} ${director.state.avenues?.open.join('')})`);
  }
  console.log(`[cidade-05] first arrival (round 1, team at the plaza), seeds 1-6: ${report.join('; ')}`);
});

// ---------- 4. nobody stuck ----------
test('nobody stuck: 300 bodies (0.2–0.65 u) placed by the planner walk to the plaza with citySteer + moveSafely for 90 s',()=>{
  const {P,ctx,state,bodies}=horde(41),steer=citySteer(P);
  assert.equal(state.open.length,4,'round 9: 4 mouths open');
  assert.equal(bodies.length,300,'the planner placed every member');
  assert.ok(bodies.some(b=>b.e.radius>.64),'an elite-sized body');
  const anchor=new Map<string,{x:number;y:number;since:number}>(),wasWalkable=new Set<string>();
  const stuck:string[]=[],left:string[]=[],reached=new Set<string>();
  let spawnedOff=0;
  for(let t=0;t<=ticks(90);t++){
    (ctx as {tick:number}).tick=t;
    for(const b of bodies)if(b.release===t){
      ctx.enemies.set(b.e.id,b.e);anchor.set(b.e.id,{x:b.e.x,y:b.e.y,since:t});
      if(!walkable(b.e,city))spawnedOff++;
    }
    for(const e of ctx.enemies.values()){
      walk(ctx,steer,e);
      const ok=walkable(e,city);
      if(ok)wasWalkable.add(e.id);else if(wasWalkable.has(e.id)&&left.length<5)left.push(`${e.id} r=${e.radius} at ${fmt(e)} tick ${t}`);
      const a=anchor.get(e.id)!;
      if(atGoal(P,e)){reached.add(e.id);a.x=e.x;a.y=e.y;a.since=t;continue;}
      if(Math.max(Math.abs(e.x-a.x),Math.abs(e.y-a.y))>CS){a.x=e.x;a.y=e.y;a.since=t;}
      else if(t-a.since>ticks(10)){stuck.push(`${e.id} r=${e.radius} in the box at ${fmt(a)} since ${(a.since/SIM_HZ).toFixed(1)} s`);a.since=Infinity;}
    }
  }
  const notWalkable=[...ctx.enemies.values()].filter(e=>!walkable(e,city));
  console.log(`[cidade-05] nobody stuck: ${bodies.length} bodies, ${ctx.enemies.size} released, ${reached.size} reached the plaza in 90 s, ${spawnedOff} spawned on a point the hero disc rejects, ${stuck.length} stuck`);
  assert.equal(ctx.enemies.size,300,'all released within 90 s');
  assert.deepEqual(left,[],'a body that stood on walkable ground left it');
  assert.deepEqual(notWalkable.map(e=>`${e.id} ${fmt(e)}`),[],'every body ends on walkable ground');
  assert.deepEqual(stuck.slice(0,10),[],`${stuck.length} bodies stayed > 10 s in one cell box away from the plaza`);
});

// ---------- 5. retreat ----------
test('retreat in the city: timed-out bodies walk out on walkable ground, never into the base, and are removed in bounded time',()=>{
  const P=planner(),steer=citySteer(P);
  for(const seed of [2,9]){
    const ctx=fakeCtx(seed),log=newLog();team(ctx);
    const director=createDirector(options(log,{rounds:1,avenues:P}));
    let start=-1,last=-1;
    const outside=new Set<string>(),fled=new Set<string>();
    run(ctx,director,ticks(3+45+90),c=>{
      for(const e of c.enemies.values()){
        if(e.memory?.retreat!==1){walk(c,steer,e,CITY_SPEED);continue;}
        if(start<0)start=c.tick;
        last=c.tick;fled.add(e.id);
        const at=`seed ${seed} tick ${c.tick} ${e.id} at ${fmt(e)}`;
        assert.ok(walkable(e,city),`${at}: retreating off walkable ground`);
        if(!P.insideBase(e))outside.add(e.id);
        else assert.ok(!outside.has(e.id),`${at}: walked (back) into the base`);
      }
    },()=>log.ends.length>0);
    assert.equal(log.ends.length,1,`seed ${seed}: the round ended`);
    const [end]=log.ends;
    assert.ok(end.timedOut,`seed ${seed}: timed out`);
    assert.ok(end.spawned>0);
    assert.equal(end.retreated,end.spawned,`seed ${seed}: every body retreated`);
    assert.equal(fled.size,end.spawned);
    assert.equal(ctx.enemies.size,0,`seed ${seed}: all removed from ctx.enemies`);
    const took=last-start+1;
    assert.ok(took<=ticks(40),`seed ${seed}: retreat took ${(took/SIM_HZ).toFixed(1)} s`);
    console.log(`[cidade-05] retreat seed ${seed}: ${end.spawned} bodies gone ${(took/SIM_HZ).toFixed(1)} s after the timeout`);
  }
});

// ---------- 6. checkpoint ----------
test('DirectorState with avenues survives a JSON round-trip mid-round; the copy replays identical spawns',()=>{
  const spot=alongRoute('L',30);
  const build=()=>{const ctx=fakeCtx(31);team(ctx);addPlayer(ctx,'c',spot);return {ctx,log:newLog()};};
  for(const at of [ticks(9),ticks(25)]){
    const a=build(),da=createDirector(options(a.log,{rounds:2,avenues:planner()}));
    run(a.ctx,da,at,killAfter(ticks(3)));
    assert.equal(da.state.stage,'wave',`checkpoint at tick ${at} is mid-round`);
    assert.ok(da.state.avenues,'the avenue state is part of DirectorState');
    const copy=JSON.parse(JSON.stringify(da.state));
    assert.deepEqual(copy.avenues,da.state.avenues,'avenue state is JSON-safe');
    // A fresh room and a fresh planner: same entities and ids, default ctx.round, another root rng.
    const b=build();
    b.ctx.tick=a.ctx.tick;b.ctx.ids=a.ctx.ids;(b.ctx as {rng:Rng}).rng=new Rng(999);
    for(const e of a.ctx.enemies.values())b.ctx.enemies.set(e.id,structuredClone(e));
    const restored=createDirector(options(b.log,{rounds:2,avenues:cityPlanner(city)}),copy);
    const events=a.ctx.events.length,created=a.log.created.length;
    run(a.ctx,da,ticks(400),killAfter(ticks(3)));
    run(b.ctx,restored,ticks(400),killAfter(ticks(3)));
    assert.ok(a.log.created.length>created,'spawns after the checkpoint');
    assert.ok(a.log.ends.length>=1,'rounds kept going');
    assert.deepEqual(b.log.created,a.log.created.slice(created),'identical spawns');
    assert.deepEqual(b.ctx.events,a.ctx.events.slice(events),'identical events');
    assert.deepEqual(b.ctx.round,a.ctx.round);
    assert.deepEqual(JSON.parse(JSON.stringify(restored.state)),JSON.parse(JSON.stringify(da.state)));
  }
});

// ---------- 7. island and endless untouched ----------
test('island and endless untouched: passing avenues to a non-city director changes nothing',()=>{
  const once=(terrain:TerrainField,avenues?:AvenuePlanner)=>{
    const ctx=fakeCtx(7,terrain),log=newLog();addPlayer(ctx,'a',SPAWN);addPlayer(ctx,'b',{x:12,y:10});
    const director=createDirector(options(log,{rounds:1,...(avenues?{avenues}:{})}));
    run(ctx,director,ticks(400),killAfter(ticks(2)),()=>director.state.stage==='done');
    assert.equal(director.state.avenues,undefined,'no avenue state outside the city');
    return {json:JSON.stringify({events:ctx.events,created:log.created,ends:log.ends,state:director.state}),log};
  };
  for(const make of [()=>new TerrainField(3),()=>new TerrainField(3,{world:'infinito'})]){
    const plain=once(make()),withPlanner=once(make(),planner());
    assert.ok(plain.log.created.length>0,'it spawns');
    assert.equal(withPlanner.json,plain.json);
  }
  const island=new TerrainField(3),{log}=once(island);
  for(const c of log.created)assert.ok(island.coast(c.x,c.y)>0&&walkable(c,island),`island spawn ${fmt(c)} on land`);
});

// ---------- 8. bench ----------
test('BENCH: 300 bodies stepping citySteer + moveSafely per tick (≤ 4 ms asserted only with BENCH=1)',()=>{
  const {P,ctx,bodies}=horde(77),steer=citySteer(P);
  for(const b of bodies)ctx.enemies.set(b.e.id,b.e);
  const step=()=>{(ctx as {tick:number}).tick++;for(const e of ctx.enemies.values())walk(ctx,steer,e);};
  // Measured while the horde walks the avenues (all released at once, the farthest ~17 s out), not once it is home.
  for(let i=0;i<5;i++)step();
  const n=200,t0=performance.now();
  for(let i=0;i<n;i++)step();
  const ms=(performance.now()-t0)/n;
  const home=[...ctx.enemies.values()].filter(e=>atGoal(P,e)).length;
  console.log(`[cidade-05] BENCH: ${ctx.enemies.size} bodies, ${ms.toFixed(3)} ms/tick over ${n} ticks (${home} at the plaza at the end)`);
  assert.equal(ctx.enemies.size,300);
  if(process.env.BENCH==='1')assert.ok(ms<=4,`${ms.toFixed(3)} ms/tick`);
});

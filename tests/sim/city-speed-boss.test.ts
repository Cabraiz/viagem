/**
 * cidade-05c (velocidade-chefe): city speeds and the boss's path on the REAL Cidade Nevada.
 *  1. citySpeed (src/sim/city/speed.ts): the monotone piecewise-linear map of the hero fraction (spec §1), checked
 *     against an independent copy of the formula, for any speed list (no ids).
 *  2. Only in the city: the assembled run (assemble.ts createRunSystems) converts the base speed of every enemy the
 *     director creates (× the round's speed multiplier after it); island and endless keep the catalog speed.
 *  3-4. Real assembled sims (SimWorld + createRunSystems: director, enemy AI with the city steer, converted speeds),
 *     players without weapons: the first wave reaches the plaza in ≈ 12 s; a team standing at `inicio` is reached
 *     in ≤ 40 s (the director aims the groups at the team, spec §2).
 *  5. The boss (assemble's controller, so its city steer and converted speed) reaches a player of the team (plaza,
 *     inicio, spread) in 20 seeds without staying > 10 s in one cell while a player is reachable for it.
 *  6. Island/endless untouched: the assembled boss run digests were recorded on the base commit a595d33 (before
 *     cidade-05c) with this file's bossDigest; boss.ts's steer hook is a no-op when it declines.
 * D-031: no wall-clock asserts (elapsed times are only logged).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {RADIUS,walkable,worldSpawn,type Point} from '../../src/maps/world.ts';
import {FlowField,STRAIGHT_COST,type FlowGrid} from '../../src/maps/flowfield.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {AGIOTA_SHOT,ENEMIES,MOLOTOV,enemyDef,isEnemyKind} from '../../src/sim/enemies/catalog.ts';
import {BOSS_TUNING,createBoss} from '../../src/sim/boss.ts';
import {createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {AvenuePlanner} from '../../src/sim/city/avenues.ts';
import {SCALE_PROFILES,enemySpeed,type ScaleProfile} from '../../src/rules/scale.ts';
import {citySpeed} from '../../src/sim/city/speed.ts';

// ---------- The real city, built once ----------
const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain, CS=city.asset.unitsPerCell, INICIO=city.asset.points.inicio;
const INF=SCALE_PROFILES.infinito, CITY=SCALE_PROFILES['cidade-nevada'];
const fmt=(p:Point)=>`(${p.x.toFixed(2)},${p.y.toFixed(2)})`;
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(2)} s`;
const median=(xs:readonly number[])=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[s.length>>1]:NaN;};
const close=(a:number,b:number,eps=1e-9)=>Math.abs(a-b)<=eps*Math.max(1,Math.abs(a),Math.abs(b));

/** Spec §1, written out independently: the hero fraction r mapped piecewise (common enemy → common enemy, hero → hero). */
function specCitySpeed(speed:number,from:ScaleProfile=INF,to:ScaleProfile=CITY){
  const r=speed/from.hero.speed,a=from.enemySpeedRatio,b=to.enemySpeedRatio;
  const m=r<=a?r*b/a:r<=1?b+(r-a)*(1-b)/(1-a):r;
  return m*to.hero.speed;
}

// ---------- Assembled runs ----------
type RunPlayerLike=SimPlayer&{ack:number;score:number};
interface Rig {world:SimWorld;sys:RunSystems;players:Map<string,SimPlayer>}
/** A run as the room assembles it (SimWorld + createRunSystems), with no input: players stand still. */
function assembled(terrain:SimWorld['terrain'],seed:number):Rig{
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain,seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{}});
  return {world,sys,players};
}
/** A player without weapons (nothing dies) and too much hp to go down: only positions matter here. */
function addPlayer(players:Map<string,SimPlayer>,id:string,p:Point){
  const player:RunPlayerLike={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0};
  players.set(id,player);
}
const plannerOf=(rig:Rig):AvenuePlanner=>{assert.ok(rig.sys.avenues,'the city run has an avenue planner');return rig.sys.avenues!;};
/** The enemy AI's engagement: melee touching (ai.ts touching + 0.05), the agiota / anão within their fire range. */
function engaged(e:EnemyState,p:Point){
  const d=Math.hypot(p.x-e.x,p.y-e.y),b=isEnemyKind(e.kind)?enemyDef(e.kind).behavior:'';
  if(b==='ranged')return d<=AGIOTA_SHOT.fireRange;
  if(b==='thrower')return d<=MOLOTOV.fireRange;
  return d<=e.radius+RADIUS+.1;
}
const live=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;
const touchesTeam=(rig:Rig,e:EnemyState)=>{for(const p of rig.players.values())if(live(p)&&engaged(e,p))return true;return false;};

// ---------- 1. citySpeed ----------
test('citySpeed: common enemy → city common enemy (≈ 0.9 × hero), monotone, ≤ hero stays ≤ hero, > hero keeps its fraction, generic',()=>{
  const hero=CITY.hero.speed,common=enemySpeed(INF);
  assert.ok(close(common,ENEMIES.bebado.speed),'the infinito common enemy is the catalog bêbado (rules/scale)');
  // Common enemy → the city's common enemy speed, ≈ 0.9 × the city hero (D-026), the planner's CITY_ENEMY_SPEED.
  assert.ok(close(citySpeed(common),enemySpeed(CITY)),`common ${common} → ${citySpeed(common)}, city common ${enemySpeed(CITY)}`);
  const ratio=citySpeed(common)/hero;
  assert.ok(ratio>=.85&&ratio<=.95,`city common / city hero = ${ratio.toFixed(3)}`);
  // The spec's expected numbers.
  for(const [s,want,eps] of [[1.4,1.79,.01],[.95,1.22,.02],[2.7,1.95,.02],[1.6,1.82,.02]] as const)
    assert.ok(Math.abs(citySpeed(s)-want)<=eps,`citySpeed(${s}) = ${citySpeed(s).toFixed(3)}, expected ≈ ${want}`);
  assert.equal(citySpeed(0),0,'0 stays 0');
  assert.ok(close(citySpeed(INF.hero.speed),hero),'the infinito hero speed → the city hero speed');
  // Sweep 0 .. 2 × hero: strictly increasing; ≤ hero stays ≤ city hero; > hero keeps its hero fraction; = the spec map.
  let prev=-Infinity;
  for(let i=0;i<=1240;i++){
    const s=i*.005,c=citySpeed(s);
    assert.ok(Number.isFinite(c)&&c>prev,`not increasing at ${s}: ${c} after ${prev}`);prev=c;
    assert.ok(close(c,specCitySpeed(s)),`citySpeed(${s}) = ${c}, spec map ${specCitySpeed(s)}`);
    if(s<=INF.hero.speed)assert.ok(c<=hero+1e-9,`citySpeed(${s}) = ${c} > city hero ${hero}`);
    else assert.ok(close(c/hero,s/INF.hero.speed),`citySpeed(${s}): fraction ${c/hero}, was ${s/INF.hero.speed}`);
  }
  // Generic: any speed list (here the whole catalog and random speeds, no ids) keeps its order and matches the map.
  const r=new Rng(5);
  const list=[...Object.values(ENEMIES).map(d=>d.speed),BOSS_TUNING.speed,...Array.from({length:40},()=>r.range(0,6))];
  const byFrom=list.map((s,i)=>({s,i})).sort((a,b)=>a.s-b.s||a.i-b.i).map(x=>x.i);
  const byTo=list.map((s,i)=>({s:citySpeed(s),i})).sort((a,b)=>a.s-b.s||a.i-b.i).map(x=>x.i);
  assert.deepEqual(byTo,byFrom,'the order of the speeds is preserved');
  for(const s of list)assert.ok(close(citySpeed(s),specCitySpeed(s)),`citySpeed(${s})`);
  // Explicit profiles: identity on the same profile; any other pair follows the same map.
  const other:ScaleProfile={...CITY,hero:{...CITY.hero,speed:4},enemySpeedRatio:.7};
  for(const s of list){
    assert.ok(close(citySpeed(s,INF,INF),s),`identity infinito→infinito at ${s}`);
    assert.ok(close(citySpeed(s,CITY,CITY),s),`identity cidade→cidade at ${s}`);
    assert.ok(close(citySpeed(s,INF,other),specCitySpeed(s,INF,other)),`infinito→custom at ${s}`);
  }
  console.log(`[cidade-05c] citySpeed: ${Object.values(ENEMIES).map(d=>`${d.id} ${d.speed}→${citySpeed(d.speed).toFixed(3)}`).join(', ')}, boss ${BOSS_TUNING.speed}→${citySpeed(BOSS_TUNING.speed).toFixed(3)}; city hero ${hero.toFixed(3)}, common/hero ${ratio.toFixed(3)}`);
});

// ---------- 2. only in the city ----------
/**
 * Rounds 1..rounds of an assembled run (every regular body killed on its spawn tick): each body the director created
 * (memory.round set) must have speed = convert(catalog speed) × that round's plan.speed.
 */
function directorSpeeds(terrain:SimWorld['terrain'],seed:number,rounds:number,convert:(s:number)=>number){
  const rig=assembled(terrain,seed),{world,sys}=rig,spawn=worldSpawn(terrain);
  addPlayer(rig.players,'a',spawn);
  let checked=0;const bad:string[]=[],mults=new Set<number>();
  for(let i=0;i<ticks(500)&&world.round.index<=rounds;i++){
    world.step();
    for(const e of [...world.enemies.values()]){
      if(e.spawnTick!==world.tick||e.boss||e.memory?.round===undefined||!isEnemyKind(e.kind))continue;
      const plan=sys.director.state.plan!,want=convert(enemyDef(e.kind).speed)*plan.speed;
      mults.add(plan.speed);checked++;
      if(!close(e.speed,want,1e-9))bad.push(`round ${plan.index} ${e.id} ${e.kind}: speed ${e.speed}, expected ${want} (×${plan.speed})`);
      world.damageEnemy(e.id,1e9);
    }
  }
  return {checked,bad,mults:[...mults].sort(),rounds:world.round.index};
}
test('only in the city: the director\'s bodies get citySpeed(catalog) × the round multiplier; island and endless keep the catalog speed',()=>{
  const identity=(s:number)=>s;
  // Seed 4, round 3: modifier 'Modo Segunda-feira' (speed × 0.75) on the base commit, so the multiplier is exercised.
  const c=directorSpeeds(city,4,3,s=>citySpeed(s));
  const i=directorSpeeds(new TerrainField(3),4,3,identity);
  const n=directorSpeeds(new TerrainField(3,{world:'infinito'}),4,1,identity);
  console.log(`[cidade-05c] director speeds: city ${c.checked} bodies (multipliers ${c.mults.join(', ')}), island ${i.checked} (${i.mults.join(', ')}), endless ${n.checked} (${n.mults.join(', ')})`);
  for(const [name,r] of [['city',c],['island',i],['endless',n]] as const){
    assert.ok(r.checked>0,`${name}: bodies were spawned`);
    assert.deepEqual(r.bad.slice(0,8),[],`${name}: ${r.bad.length} bodies with another speed`);
  }
  assert.ok(c.mults.some(m=>m!==1),`city: a round with a speed multiplier ≠ 1 was checked (${c.mults.join(', ')})`);
  // The boss: assemble's controller converts its walking speed in the city only.
  const cityRig=assembled(city,4),P=plannerOf(cityRig);
  addPlayer(cityRig.players,'a',INICIO);
  const cityBoss=cityRig.sys.boss.spawnBoss(cityRig.world,P.plazaCenter)!;
  assert.ok(close(cityBoss.speed,citySpeed(BOSS_TUNING.speed)),`city boss speed ${cityBoss.speed}, expected citySpeed(${BOSS_TUNING.speed}) = ${citySpeed(BOSS_TUNING.speed)}`);
  for(const terrain of [new TerrainField(3),new TerrainField(3,{world:'infinito'})]){
    const rig=assembled(terrain,4),s=worldSpawn(terrain);
    addPlayer(rig.players,'a',s);
    const b=rig.sys.boss.spawnBoss(rig.world,{x:s.x+6,y:s.y+5})!;
    assert.equal(b.speed,BOSS_TUNING.speed,`${terrain.chunks?'endless':'island'} boss keeps its speed`);
  }
});

// ---------- 3. first wave at the plaza ----------
test('first wave: round 1, team at the plaza, real cast and converted speeds (assembled run): the first group reaches the plaza in ≈ 12 s',()=>{
  const report:string[]=[],late:string[]=[];let within13=0;
  for(let seed=1;seed<=6;seed++){
    const rig=assembled(city,seed),{world,sys}=rig,P=plannerOf(rig);
    addPlayer(rig.players,'a',P.plazaCenter);addPlayer(rig.players,'b',city.asset.points.praca);
    let first:Set<string>|undefined,arrival=-1,line=-1;
    for(let i=0;i<ticks(90)&&arrival<0;i++){
      world.step();
      if(!first){const fresh=[...world.enemies.values()].filter(e=>e.spawnTick===world.tick&&e.memory?.round===1);if(fresh.length)first=new Set(fresh.map(e=>e.id));}
      if(first)for(const id of first){
        const e=world.enemies.get(id);if(!e)continue;
        const at=world.tick-sys.director.state.roundStart;
        if(line<0&&P.insideBase(e))line=at;
        // The planner's arrival (city-director): a plaza goal cell, or touching a player standing in the base.
        if(P.plazaField.atGoal(e.x,e.y)||P.insideBase(e)&&touchesTeam(rig,e)){arrival=at;break;}
      }
    }
    const kinds=first?[...first].map(id=>world.enemies.get(id)?.kind??'?').join('/'):'none';
    report.push(`seed ${seed}: ${arrival<0?'never':secs(arrival)} (mouth line ${line<0?'-':secs(line)}, ${sys.director.state.avenues?.mode} ${sys.director.state.avenues?.open.join('')}, ${kinds})`);
    assert.ok(first,`seed ${seed}: a group spawned`);
    assert.ok(arrival>=0,`seed ${seed}: the first group reached the plaza within 90 s`);
    assert.ok(arrival>=ticks(9),`seed ${seed}: first arrival ${secs(arrival)} is too early (spawned too close)`);
    if(arrival<=ticks(13))within13++;
    if(arrival>ticks(14))late.push(`seed ${seed} ${secs(arrival)}`);
  }
  console.log(`[cidade-05c] first wave at the plaza (round 1, assembled, converted speeds), ${within13}/6 within 13 s:\n  ${report.join('\n  ')}`);
  assert.deepEqual(late,[],'every seed within 14 s');
  assert.ok(within13>=5,`${within13}/6 seeds within 13 s`);
});

// ---------- 4. team at inicio ----------
test('team at inicio (nobody in the base): round 1 first contact ≤ 40 s in 6 seeds (assembled run); the horde median is logged',()=>{
  const report:string[]=[],slow:string[]=[],all:number[]=[];let never=0,total=0;
  for(let seed=1;seed<=6;seed++){
    const rig=assembled(city,seed),{world,sys}=rig,P=plannerOf(rig);
    addPlayer(rig.players,'a',INICIO);addPlayer(rig.players,'b',{x:INICIO.x+1,y:INICIO.y});
    for(const p of rig.players.values())assert.ok(!P.insideBase(p),`${p.id} at ${fmt(p)} is outside the base`);
    const touched=new Map<string,number>(),round1=new Set<string>();let first=-1;
    for(let i=0;i<ticks(120);i++){
      world.step();
      if(sys.director.state.stage!=='wave'&&round1.size)break;
      const start=sys.director.state.roundStart;
      for(const e of world.enemies.values()){
        if(e.boss||e.memory?.round!==1)continue;
        round1.add(e.id);
        if(touched.has(e.id)||e.memory?.retreat===1)continue;
        if(touchesTeam(rig,e)){touched.set(e.id,world.tick-start);if(first<0)first=world.tick-start;}
      }
      if(round1.size&&touched.size===round1.size&&round1.size>=(sys.director.state.plan?.total??Infinity))break;
    }
    const times=[...touched.values()];
    all.push(...times);never+=round1.size-touched.size;total+=round1.size;
    report.push(`seed ${seed}: first contact ${first<0?'never':secs(first)}, ${touched.size}/${round1.size} bodies, median ${times.length?secs(median(times)):'-'} (${sys.director.state.avenues?.mode} ${sys.director.state.avenues?.open.join('')})`);
    if(!(first>=0&&first<=ticks(40)))slow.push(`seed ${seed}: ${first<0?'no contact in 120 s':secs(first)}`);
  }
  console.log(`[cidade-05c] team at inicio (round 1, assembled): horde median contact ${secs(median(all))} (${all.length}/${total} bodies engaged, ${never} never within the round or 120 s):\n  ${report.join('\n  ')}`);
  assert.deepEqual(slow,[],'first contact within 40 s');
});

// ---------- 5. the boss reaches the team ----------
/** The city cells whose centre clears a disc of `radius` (moveSafely's rule for bodies wider than the hero). */
const discGrids=new Map<number,FlowGrid>();
function discGrid(radius:number):FlowGrid{
  const r=Math.max(radius,RADIUS),key=Math.round(r*1000);
  let g=discGrids.get(key);
  if(!g){
    const w=city.asset.cells.w,h=city.asset.cells.h,cells=new Uint8Array(w*h);
    for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++)cells[cx+cy*w]=city.clearDisc((cx+.5)*CS,(cy+.5)*CS,r)?1:0;
    discGrids.set(key,g={width:w,height:h,cellSize:CS,originX:0,originY:0,walkable:(cx,cy)=>cells[cx+cy*w]===1});
  }
  return g;
}
/** The boss's walk stops at 2.5 u from its target (boss.ts walk): within BOSS_REACH of a live player it has reached the team. */
const BOSS_REACH=3;
/**
 * Field of the shortest walks of the boss to the cells within 2.5 u of a player (its walking stop). The boss collides
 * by the hero rule (boss.ts walk: clearSegment with axis slides, kept by cidade-05c), so "reachable for its size" is
 * the hero-walkable grid. undefined: no such cell.
 */
function bossReachField(players:readonly Point[]):FlowField|undefined{
  const g=discGrid(RADIUS),goals:Point[]=[],k=Math.ceil(2.5/CS);
  for(const p of players){
    const px=Math.floor(p.x/CS),py=Math.floor(p.y/CS);
    for(let dy=-k;dy<=k;dy++)for(let dx=-k;dx<=k;dx++){
      const cx=px+dx,cy=py+dy,c={x:(cx+.5)*CS,y:(cy+.5)*CS};
      if(cx>=0&&cy>=0&&cx<g.width&&cy<g.height&&g.walkable(cx,cy)&&Math.hypot(c.x-p.x,c.y-p.y)<=2.5)goals.push(c);
    }
  }
  return goals.length?new FlowField(g,goals,{wallPenalty:0}):undefined;
}
/** Shortest walk (u) of the boss from p (its own cell or one of the 8 around it). Infinity: no player reachable for it. */
function walkU(f:FlowField|undefined,p:Point){
  let best=Infinity;
  if(!f)return best;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const x=p.x+dx*CS,y=p.y+dy*CS;
    if(f.reachable(x,y))best=Math.min(best,f.costAt(x,y)/STRAIGHT_COST*CS+Math.hypot(dx,dy)*CS);
  }
  return best;
}
/** Walkable (hero rule) cell centres of the plaza goal. */
function plazaCells(P:AvenuePlanner){
  const hero:Point[]=[];
  for(let cy=0;cy<city.asset.cells.h;cy++)for(let cx=0;cx<city.asset.cells.w;cx++){
    const p={x:(cx+.5)*CS,y:(cy+.5)*CS};
    if(P.plazaField.atGoal(p.x,p.y)&&walkable(p,city))hero.push(p);
  }
  return {hero};
}
/** A walkable spot outside the base, plaza-connected, minD..maxD u from the plaza center (city-director spotAway). */
function spotAway(P:AvenuePlanner,r:Rng,minD:number,maxD:number):Point{
  const w=city.asset.cells.w,h=city.asset.cells.h;
  for(;;){
    const p={x:(r.int(0,w-1)+.5)*CS,y:(r.int(0,h-1)+.5)*CS},d=Math.hypot(p.x-P.plazaCenter.x,p.y-P.plazaCenter.y);
    if(d>=minD&&d<=maxD&&walkable(p,city)&&P.plazaField.reachable(p.x,p.y)&&!P.insideBase(p))return p;
  }
}
test('boss in the city: 20 seeds × team at the plaza / at inicio / spread: the boss (assemble\'s controller: city steer, converted speed) reaches a player, never stuck',()=>{
  const t0=performance.now();
  // One assembled city run whose boss controller is reused (reset) per scenario; boss + telegraphs stepped by hand.
  const rig=assembled(city,1),{world,sys}=rig,P=plannerOf(rig),cells=plazaCells(P),telegraphs=createTelegraphSystem();
  Object.assign(world.round,{index:10,total:10,phase:'wave',phaseEndsTick:1e9,remaining:1});
  const setups=['plaza','inicio','spread'] as const;
  const times:Record<string,number[]>={plaza:[],inicio:[],spread:[]},stuck:string[]=[],failed:string[]=[];
  let ticksRun=0;
  for(const setup of setups)for(let seed=1;seed<=20;seed++){
    const r=new Rng(seed*1009+setup.length*7),at=`${setup} seed ${seed}`;
    // The team, and the plaza cells (walkable, ≥ 4 u from everyone, as the director picks them) from which the boss can
    // walk to it; a team drawn out of reach from the whole plaza is drawn again (inicio is fixed: it must be reachable).
    let spots:Point[]=[],reach:FlowField|undefined,bossSpots:Point[]=[];
    for(let tries=0;tries<20&&!bossSpots.length;tries++){
      if(setup==='plaza')spots=[r.pick(cells.hero),r.pick(cells.hero)];
      else if(setup==='inicio')spots=[INICIO,{x:INICIO.x+1,y:INICIO.y}];
      else spots=[spotAway(P,r,12,60),spotAway(P,r,12,60),spotAway(P,r,12,60)];
      reach=bossReachField(spots);
      bossSpots=cells.hero.filter(c=>spots.every(p=>Math.hypot(p.x-c.x,p.y-c.y)>=4)&&Number.isFinite(walkU(reach,c)));
    }
    assert.ok(bossSpots.length,`${at}: no plaza cell ≥ 4 u from the team ${spots.map(fmt).join(' ')} from which the boss reaches it`);
    const spawn=r.pick(bossSpots);
    // Fresh scenario on the same world (the tick keeps growing, so the steer's fields rebuild on their own phase).
    world.enemies.clear();world.telegraphs.clear();world.pickups.clear();world.projectiles.clear();rig.players.clear();
    sys.boss.reset();world.rng=new Rng(seed*31+setup.length);
    spots.forEach((p,i)=>addPlayer(rig.players,`p${i}`,p));
    const boss=sys.boss.spawnBoss(world,spawn)!;
    assert.ok(boss&&Math.hypot(boss.x-spawn.x,boss.y-spawn.y)<1e-9,`${at}: the boss spawned at ${fmt(spawn)}`);
    const from=world.tick,anchor={x:boss.x,y:boss.y,since:from};let reached=-1;
    for(let i=0;i<ticks(240)&&reached<0;i++){
      world.tick++;ticksRun++;
      sys.boss.step(world);telegraphs.step(world);
      const b=world.enemies.get(boss.id);
      assert.ok(b,`${at}: the boss is still there`);
      const d=Math.min(...spots.map(p=>Math.hypot(p.x-b!.x,p.y-b!.y)));
      if(d<=BOSS_REACH){reached=world.tick-from;break;}
      if(Math.max(Math.abs(b!.x-anchor.x),Math.abs(b!.y-anchor.y))>CS){anchor.x=b!.x;anchor.y=b!.y;anchor.since=world.tick;}
      else if(world.tick-anchor.since>ticks(10)&&Number.isFinite(walkU(reach,b!))){
        stuck.push(`${at}: boss at ${fmt(b!)} since +${secs(anchor.since-from)}, ${walkU(reach,b!).toFixed(1)} u of walk from the team (spawn ${fmt(spawn)}, team ${spots.map(fmt).join(' ')})`);
        anchor.since=Infinity;
      }
    }
    if(reached<0)failed.push(`${at}: not within ${BOSS_REACH} u of a player in 240 s (spawn ${fmt(spawn)}, path ${walkU(reach,spawn).toFixed(1)} u, team ${spots.map(fmt).join(' ')})`);
    else times[setup].push(reached);
  }
  const line=(s:string)=>`${s}: ${times[s].length}/20 reached, median ${secs(median(times[s]))}, slowest ${secs(Math.max(...times[s],0))} [${times[s].map(t=>(t/SIM_HZ).toFixed(1)).join(' ')}]`;
  console.log(`[cidade-05c] boss reach (speed ${citySpeed(BOSS_TUNING.speed).toFixed(3)} u/s, ${ticksRun} ticks, ${(performance.now()-t0).toFixed(0)} ms):\n  ${setups.map(line).join('\n  ')}\n  ${stuck.length} stuck > 10 s${stuck.length?`: ${stuck.slice(0,5).join('; ')}`:''}`);
  assert.deepEqual(stuck.slice(0,10),[],`${stuck.length} times the boss stayed > 10 s in one cell while a player was reachable for its size`);
  assert.deepEqual(failed.slice(0,10),[],`${failed.length} scenarios where the boss never reached the team`);
});

// ---------- 6. island and endless untouched ----------
/** boss.ts BossOptions.steer: the EnemyAiOptions.steer signature. */
type BossSteer=(ctx:SimContext,e:EnemyState,target:Point,out:Point)=>boolean;
test('boss.ts steer hook: a true answer replaces the straight walk with its direction; a false one is the old walk, tick for tick',()=>{
  // An open spot of the city (the widest clearance around the plaza) and a player 25 u to the east, ~straight line.
  const P=assembled(city,2).sys.avenues!,c=P.plazaCenter;
  let spot=c,best=-1;
  for(let dy=-12;dy<=12;dy++)for(let dx=-12;dx<=12;dx++){
    const p={x:c.x+dx*CS,y:c.y+dy*CS};let clear=0;
    while(clear<4&&city.clearDisc(p.x,p.y,clear+.25))clear+=.25;
    if(clear>best){best=clear;spot=p;}
  }
  assert.ok(best>=BOSS_TUNING.radius+.5,`an open spot (clearance ${best} u)`);
  const run=(steer?:BossSteer)=>{
    const players=new Map<string,SimPlayer>(),world=new SimWorld({terrain:city,seed:9,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    addPlayer(players,'far',{x:spot.x+25,y:spot.y});
    const controller=createBoss(steer?{steer}:{}),boss=controller.spawnBoss(world,spot)!,trail:number[][]=[];
    for(let i=0;i<ticks(12);i++){world.tick++;const x=boss.x,y=boss.y;controller.step(world);trail.push([boss.x,boss.y,boss.x-x,boss.y-y,boss.memory?.act??-1]);}
    return {trail,boss};
  };
  const plain=run(),declined=run(()=>false);
  assert.deepEqual(declined.trail,plain.trail,'a steer that declines leaves the walk byte-identical');
  // Steered north (perpendicular to the player): every plain walking step (not a dash) goes that way at the boss speed.
  let calls=0,target:Point|undefined;
  const steered=run((_ctx,_e,t,out)=>{calls++;target=t;out.x=0;out.y=-1;return true;});
  assert.ok(calls>0,'the boss asks its steer while walking');
  assert.equal((target as SimPlayer|undefined)?.id,'far','the steer gets the chased player as its target');
  const walks=steered.trail.filter(([x,y,dx,dy,act])=>act===0&&Math.hypot(dx,dy)>1e-9&&city.clearDisc(x,y,BOSS_TUNING.radius+.1));
  assert.ok(walks.length>0,'the boss walked');
  const step=steered.boss.speed/SIM_HZ;
  for(const [,, dx,dy] of walks.slice(0,5)){
    const l=Math.hypot(dx,dy);
    assert.ok(dy/l<-.999,`step (${dx.toFixed(3)},${dy.toFixed(3)}) follows the steer's direction (0,-1)`);
    assert.ok(Math.abs(l-step)<1e-6,`step length ${l} = speed/SIM_HZ ${step}`);
  }
  const plainWalks=plain.trail.filter(([x,y,dx,dy,act])=>act===0&&Math.hypot(dx,dy)>1e-9&&city.clearDisc(x,y,BOSS_TUNING.radius+.1)).slice(0,3);
  assert.ok(plainWalks.length&&plainWalks.every(([,, dx,dy])=>dx/Math.hypot(dx,dy)>.99),'without a steer the boss walks straight at the player (east)');
});
/**
 * Island/endless assembled run (director, enemy AI, boss, telegraphs...) with the boss spawned at the start next to a
 * standing and a wandering player: the boss's per-tick trail, the controller state and the bodies at the end as a
 * short sha256. BOSS_BASELINE was recorded with this function on the base commit a595d33 (before cidade-05c).
 */
function bossDigest(world:'ilha'|'infinito'){
  const terrain=world==='ilha'?new TerrainField(3):new TerrainField(3,{world:'infinito'});
  const rig=assembled(terrain,5),s=worldSpawn(terrain);
  addPlayer(rig.players,'a',s);addPlayer(rig.players,'b',{x:s.x+3,y:s.y-2});
  const boss=rig.sys.boss.spawnBoss(rig.world,{x:s.x+6,y:s.y+5})!;
  const trail:number[][]=[];
  for(let i=0;i<ticks(40);i++){
    const p=rig.players.get('b')!;p.x=s.x+3+Math.sin(i/40)*4;p.y=s.y-2+Math.cos(i/34)*3;
    rig.world.step();
    const b=rig.world.enemies.get(boss.id);trail.push(b?[b.x,b.y,b.speed,b.memory?.act??-1,b.phase??0]:[]);
  }
  const bodies=[...rig.world.enemies.values()].map(e=>[e.id,e.kind,e.x,e.y,e.speed,e.radius,e.hp]);
  const json=JSON.stringify({trail,boss:rig.sys.boss.state,bodies,telegraphs:[...rig.world.telegraphs.values()],round:rig.world.round});
  return createHash('sha256').update(json).digest('hex').slice(0,16);
}
const BOSS_BASELINE:Readonly<Record<string,string>>={ilha:'75a2225f4fc40291',infinito:'0df5554c3395e49b'};
test('island and endless untouched: the assembled boss run matches the digest recorded before cidade-05c',()=>{
  const got={ilha:bossDigest('ilha'),infinito:bossDigest('infinito')};
  console.log(`[cidade-05c] island/endless boss digests: ${JSON.stringify(got)}`);
  assert.deepEqual(got,BOSS_BASELINE,'island/endless boss behavior differs from the base commit a595d33');
});

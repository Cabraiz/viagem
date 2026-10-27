/**
 * cidade-05c (velocidade-chefe): city speeds and the boss's path on the REAL Cidade Nevada.
 *  1. citySpeed (src/sim/city/speed.ts): the monotone piecewise-linear map of the hero fraction (spec §1), checked
 *     against an independent copy of the formula, for any speed list (no ids).
 *  2. Only in the city: every body the director spawns walks at citySpeed(catalog speed × the round's plan.speed) —
 *     one conversion, on the EFFECTIVE speed (addendum v2 §3); island and endless keep catalog × plan.speed.
 *  3-4. Real assembled sims (SimWorld + createRunSystems: director, enemy AI with the city steer, converted speeds),
 *     players without weapons: the first wave reaches the plaza in ≈ 12 s; a team standing at `inicio` is reached
 *     in ≤ 40 s (the director aims the groups at the team, spec §2).
 *  5. The boss (assemble's controller: its city steer and speed map) reaches a player of the team (plaza, inicio,
 *     spread, split) in 20 seeds without staying > 10 s in one cell while a player is reachable for it; and
 *     (addendum §1) never walks away: its walk to the first contact ≤ 2 × the hero path at its spawn + 20 u.
 *  6. Island/endless untouched: the assembled boss run digests were recorded on the base commit a595d33 (before
 *     cidade-05c) with this file's bossDigest; boss.ts's steer hook is a no-op when it declines.
 *  7. Addendum v2 (after the review of 572ede3): effective speeds (kinds × round multipliers, boss phases, dash) stay
 *     on the same side of the hero; siege groups besiege the base while the team is away; chaseCost unit tests for
 *     the planner and the director's "someone in the base" rule; the citySteer fields and the director's team field
 *     follow grid.refresh edits; the 45° charge rule in the city.
 * D-031: no wall-clock asserts (elapsed times are only logged).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {RADIUS,clearSegment,walkable,worldSpawn,type Point} from '../../src/maps/world.ts';
import {FlowField,STRAIGHT_COST,UNREACHABLE,type CellRect,type FlowGrid} from '../../src/maps/flowfield.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS,SIM_HZ,ticks,type EnemyState,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {SIEGE_FROM_ROUND,createRunSystems,type RunSystems} from '../../src/sim/assemble.ts';
import {AGIOTA_SHOT,ENEMIES,MOLOTOV,enemyDef,isEnemyKind} from '../../src/sim/enemies/catalog.ts';
import {BOSS_TUNING,PHASE_ASSEMBLY,PHASE_ENRAGED,createBoss} from '../../src/sim/boss.ts';
import {createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {NEUTRAL_CITY_BALANCE} from '../../src/sim/city/balance.ts';
import {MOUTHS,OPPOSITE,type AvenuePlanner,type AvenueMode,type AvenueState,type Mouth,type PlayerLike} from '../../src/sim/city/avenues.ts';
import {CITY_ENEMY_SPEED,WIDE_RADII,cityFlowGrid,cityPlanner,citySteer,type CityFlowGrid} from '../../src/sim/city/grid.ts';
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
/** A city planner for the unit tests (the same as assemble's: cityPlanner on the real city). */
const PLAN=cityPlanner(city);
const fmt=(p:Point)=>`(${p.x.toFixed(2)},${p.y.toFixed(2)})`;
const secs=(t:number)=>`${(t/SIM_HZ).toFixed(2)} s`;
const median=(xs:readonly number[])=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[s.length>>1]:NaN;};
const close=(a:number,b:number,eps=1e-9)=>Math.abs(a-b)<=eps*Math.max(1,Math.abs(a),Math.abs(b));
/** Path distance (u, flow-field cost) from p to the nearest of `goals` on `grid`; Infinity when unreachable. */
function pathCost(grid:FlowGrid,goals:readonly Point[]){
  const f=new FlowField(grid,goals);
  return (p:Point)=>{const c=f.costAt(p.x,p.y);return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*grid.cellSize;};
}
/** Plaza walk (u) of p on the planner's plaza field; Infinity when unreachable. */
const plazaU=(P:AvenuePlanner,p:Point)=>{const c=P.plazaField.costAt(p.x,p.y);return c===UNREACHABLE?Infinity:c/STRAIGHT_COST*CS;};

/** Spec §1, written out independently: the hero fraction r mapped piecewise (common enemy → common enemy, hero → hero). */
function specCitySpeed(speed:number,from:ScaleProfile=INF,to:ScaleProfile=CITY){
  const r=speed/from.hero.speed,a=from.enemySpeedRatio,b=to.enemySpeedRatio;
  const m=r<=a?r*b/a:r<=1?b+(r-a)*(1-b)/(1-a):r;
  return m*to.hero.speed;
}

// ---------- Assembled runs ----------
type RunPlayerLike=SimPlayer&{ack:number;score:number};
interface Rig {world:SimWorld;sys:RunSystems;players:Map<string,SimPlayer>}
/**
 * A run as the room assembles it (SimWorld + createRunSystems), with no input: players stand still. The city's round-1
 * tutorial walk (cidade-08, tests/sim/city-tutorial.test.ts) is off: these tests read the round table's round 1.
 */
function assembled(terrain:SimWorld['terrain'],seed:number):Rig{
  const players=new Map<string,SimPlayer>();
  const world=new SimWorld({terrain,seed,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  // Travel and reach are measured with the plaza open: the barricades (cidade-06) are a defense, tested in city-barricades.
  // Neutral city knobs (cidade-11): speed and reach are measured on the round table itself, not the tuned difficulty.
  // The round table's nine kinds (no D-040 rotation): the seeds below were picked for its rounds and modifiers.
  const sys=createRunSystems(world,{takeInput:()=>undefined,onOutcome:()=>{},barricades:false,cityTutorial:false,cityBalance:NEUTRAL_CITY_BALANCE,rotation:false});
  return {world,sys,players};
}
/** A player without weapons (nothing dies) and too much hp to go down: only positions matter here. */
function addPlayer(players:Map<string,SimPlayer>,id:string,p:Point){
  const player:RunPlayerLike={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0};
  players.set(id,player);
  return player;
}
const plannerOf=(rig:Rig):AvenuePlanner=>{assert.ok(rig.sys.avenues,'the city run has an avenue planner');return rig.sys.avenues!;};
const gridOf=(P:AvenuePlanner)=>{const g=(P as AvenuePlanner&{grid?:CityFlowGrid}).grid;assert.ok(g,'the city planner exposes its grid');return g!;};
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

// ---------- 2. only in the city, on the effective speed ----------
/**
 * Rounds 1..rounds of an assembled run (every regular body killed on its spawn tick): each body the director created
 * (memory.round set) must have speed = convert(catalog speed × that round's plan.speed) — the one conversion after
 * the multiplier (addendum v2 §3).
 */
function directorSpeeds(terrain:SimWorld['terrain'],seed:number,rounds:number,convert:(s:number)=>number){
  const rig=assembled(terrain,seed),{world,sys}=rig,spawn=worldSpawn(terrain);
  addPlayer(rig.players,'a',spawn);
  let checked=0;const bad:string[]=[],mults=new Set<number>();
  for(let i=0;i<ticks(500)&&world.round.index<=rounds;i++){
    world.step();
    for(const e of [...world.enemies.values()]){
      if(e.spawnTick!==world.tick||e.boss||e.memory?.round===undefined||!isEnemyKind(e.kind))continue;
      const plan=sys.director.state.plan!,want=convert(enemyDef(e.kind).speed*plan.speed);
      mults.add(plan.speed);checked++;
      if(!close(e.speed,want,1e-9))bad.push(`round ${plan.index} ${e.id} ${e.kind}: speed ${e.speed}, expected ${want} (×${plan.speed})`);
      world.damageEnemy(e.id,1e9);
    }
  }
  return {checked,bad,mults:[...mults].sort(),rounds:world.round.index};
}
test('only in the city: the director\'s bodies get citySpeed(catalog × the round multiplier) (× 0.75 and × 1.25 rounds included); island and endless keep catalog × multiplier',()=>{
  const identity=(s:number)=>s;
  // City seeds whose round 3 has a speed modifier: 31 'Modo Segunda-feira' (× 0.75), 17 'Sinal do Recreio' (× 1.25); 4 and
  // 22 before vida-inimigos-estilo-clash moved the stream with ×0.7 bodies from round 2.
  const c31=directorSpeeds(city,31,3,s=>citySpeed(s)),c17=directorSpeeds(city,17,3,s=>citySpeed(s));
  const i=directorSpeeds(new TerrainField(3),4,3,identity);
  const n=directorSpeeds(new TerrainField(3,{world:'infinito'}),4,1,identity);
  console.log(`[cidade-05c] director speeds: city seed 31 ${c31.checked} bodies (multipliers ${c31.mults.join(', ')}), seed 17 ${c17.checked} (${c17.mults.join(', ')}), island ${i.checked} (${i.mults.join(', ')}), endless ${n.checked} (${n.mults.join(', ')})`);
  for(const [name,r] of [['city 31',c31],['city 17',c17],['island',i],['endless',n]] as const){
    assert.ok(r.checked>0,`${name}: bodies were spawned`);
    assert.deepEqual(r.bad.slice(0,8),[],`${name}: ${r.bad.length} bodies with another speed`);
  }
  const mults=new Set([...c31.mults,...c17.mults]);
  for(const m of [.75,1,1.25])assert.ok(mults.has(m),`city: a round with speed multiplier ${m} was checked (${[...mults].join(', ')})`);
  // The boss controller keeps the authored speed on its body outside the city (its walk is measured in section 7).
  for(const terrain of [new TerrainField(3),new TerrainField(3,{world:'infinito'})]){
    const rig=assembled(terrain,4),s=worldSpawn(terrain);
    addPlayer(rig.players,'a',s);
    const b=rig.sys.boss.spawnBoss(rig.world,{x:s.x+6,y:s.y+5})!;
    assert.equal(b.speed,BOSS_TUNING.speed,`${terrain.chunks?'endless':'island'} boss keeps its speed`);
  }
});

// ---------- 3. first wave at the plaza ----------
/**
 * Round 1 of an assembled city run with the team standing at `team`: ticks after the round start until a member of
 * the first group reaches the plaza (the planner's arrival: a plaza goal cell, or touching a player in the base).
 */
function firstWave(seed:number,team:readonly Point[]){
  const rig=assembled(city,seed),{world,sys}=rig,P=plannerOf(rig);
  team.forEach((p,i)=>addPlayer(rig.players,`p${i}`,p));
  let first:Set<string>|undefined,arrival=-1,line=-1;
  for(let i=0;i<ticks(90)&&arrival<0;i++){
    world.step();
    if(!first){const fresh=[...world.enemies.values()].filter(e=>e.spawnTick===world.tick&&e.memory?.round===1);if(fresh.length)first=new Set(fresh.map(e=>e.id));}
    if(first)for(const id of first){
      const e=world.enemies.get(id);if(!e)continue;
      const at=world.tick-sys.director.state.roundStart;
      if(line<0&&P.insideBase(e))line=at;
      if(P.plazaField.atGoal(e.x,e.y)||P.insideBase(e)&&touchesTeam(rig,e)){arrival=at;break;}
    }
  }
  const kinds=first?[...first].map(id=>world.enemies.get(id)?.kind??'?').join('/'):'none';
  return {spawned:!!first,arrival,text:`${arrival<0?'never':secs(arrival)} (mouth line ${line<0?'-':secs(line)}, ${sys.director.state.avenues?.mode} ${sys.director.state.avenues?.open.join('')}, ${kinds})`};
}
test('first wave: round 1, team at the plaza, real cast and converted speeds (assembled run): the first group reaches the plaza in ≈ 12 s',()=>{
  const report:string[]=[],late:string[]=[];let within13=0;
  for(let seed=1;seed<=6;seed++){
    const w=firstWave(seed,[PLAN.plazaCenter,city.asset.points.praca]);
    report.push(`seed ${seed}: ${w.text}`);
    assert.ok(w.spawned,`seed ${seed}: a group spawned`);
    assert.ok(w.arrival>=0,`seed ${seed}: the first group reached the plaza within 90 s`);
    assert.ok(w.arrival>=ticks(9),`seed ${seed}: first arrival ${secs(w.arrival)} is too early (spawned too close)`);
    if(w.arrival<=ticks(13))within13++;
    if(w.arrival>ticks(14))late.push(`seed ${seed} ${secs(w.arrival)}`);
  }
  console.log(`[cidade-05c] first wave at the plaza (round 1, assembled, converted speeds), ${within13}/6 within 13 s:\n  ${report.join('\n  ')}`);
  assert.deepEqual(late,[],'every seed within 14 s');
  // NEW-20261013-ORQ-cidade-escala-1-7: on the 1.7× map the base is 1.7× bigger and the S groups (the team stands by
  // mouth S) walk ~2 s longer from the mouth line to the plaza: measured 13.55 / 13.00 / 13.50 s on S (mouth line 8.75 /
  // 8.25 / 8.65 s), 12.05 / 11.90 / 11.15 s on N/O; on the .w3x-sized city 12.90 / 12.35 / 12.85 s on S, 6/6 within 13 s.
  // Every seed still within 14 s (above); within 13 s: 4 of 6.
  // NEW-20261020-ORQ-zoom-fixo-pc: the computer's camera (contract HERO_DESKTOP_SCREEN_PX) pushes the S spots out a little:
  // 13.85 / 13.20 s on S, 3 of 6 within 13 s, all still within 14 s.
  assert.ok(within13>=3,`${within13}/6 seeds within 13 s`);
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
const BOSS_SETUPS=['plaza','inicio','spread','split'] as const;
type BossSetup=typeof BOSS_SETUPS[number];
/** reached: ticks to the first contact (-1 never); walked: u the boss moved until then; pathU: its hero path at spawn. */
interface BossRun {setup:BossSetup;seed:number;spawn:Point;team:Point[];reached:number;walked:number;pathU:number}
let bossMemo:{runs:BossRun[];stuck:string[];ticksRun:number;ms:number}|undefined;
/**
 * 20 seeds × team at the plaza / at inicio / spread (3 players 12-60 u from the plaza) / split (one in the plaza,
 * one 40-70 u away), the boss spawned on a plaza cell ≥ 4 u from everyone from which it can walk to the team. One
 * assembled city run whose boss controller (assemble's: city steer, speed map) is reused (reset) per scenario; boss
 * and telegraphs stepped by hand. Shared by the two boss tests below (computed once).
 */
function bossRuns(){
  if(bossMemo)return bossMemo;
  const t0=performance.now();
  const rig=assembled(city,1),{world,sys}=rig,P=plannerOf(rig),cells=plazaCells(P),telegraphs=createTelegraphSystem();
  Object.assign(world.round,{index:10,total:10,phase:'wave',phaseEndsTick:1e9,remaining:1});
  const runs:BossRun[]=[],stuck:string[]=[];
  let ticksRun=0;
  for(const setup of BOSS_SETUPS)for(let seed=1;seed<=20;seed++){
    const r=new Rng(seed*1009+setup.length*7),at=`${setup} seed ${seed}`;
    // The team, and the plaza cells (walkable, ≥ 4 u from everyone, as the director picks them) from which the boss can
    // walk to it; a team drawn out of reach from the whole plaza is drawn again (inicio is fixed: it must be reachable).
    let spots:Point[]=[],reach:FlowField|undefined,bossSpots:Point[]=[];
    for(let tries=0;tries<20&&!bossSpots.length;tries++){
      if(setup==='plaza')spots=[r.pick(cells.hero),r.pick(cells.hero)];
      else if(setup==='inicio')spots=[INICIO,{x:INICIO.x+1,y:INICIO.y}];
      else if(setup==='split')spots=[r.pick(cells.hero),spotAway(P,r,40,70)];
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
    const from=world.tick,anchor={x:boss.x,y:boss.y,since:from};let reached=-1,walked=0;
    for(let i=0;i<ticks(240)&&reached<0;i++){
      world.tick++;ticksRun++;
      const x=boss.x,y=boss.y;
      sys.boss.step(world);telegraphs.step(world);
      const b=world.enemies.get(boss.id);
      assert.ok(b,`${at}: the boss is still there`);
      walked+=Math.hypot(b!.x-x,b!.y-y);
      const d=Math.min(...spots.map(p=>Math.hypot(p.x-b!.x,p.y-b!.y)));
      if(d<=BOSS_REACH){reached=world.tick-from;break;}
      if(Math.max(Math.abs(b!.x-anchor.x),Math.abs(b!.y-anchor.y))>CS){anchor.x=b!.x;anchor.y=b!.y;anchor.since=world.tick;}
      else if(world.tick-anchor.since>ticks(10)&&Number.isFinite(walkU(reach,b!))){
        stuck.push(`${at}: boss at ${fmt(b!)} since +${secs(anchor.since-from)}, ${walkU(reach,b!).toFixed(1)} u of walk from the team (spawn ${fmt(spawn)}, team ${spots.map(fmt).join(' ')})`);
        anchor.since=Infinity;
      }
    }
    runs.push({setup,seed,spawn,team:spots,reached,walked,pathU:walkU(reach,spawn)});
  }
  return bossMemo={runs,stuck,ticksRun,ms:performance.now()-t0};
}
test('boss in the city: 20 seeds × team at the plaza / at inicio / spread / split: the boss (assemble\'s controller: city steer, speed map) reaches a player, never stuck',()=>{
  const {runs,stuck,ticksRun,ms}=bossRuns();
  const line=(s:BossSetup)=>{
    const t=runs.filter(r=>r.setup===s&&r.reached>=0).map(r=>r.reached);
    return `${s}: ${t.length}/20 reached, median ${secs(median(t))}, slowest ${secs(Math.max(...t,0))} [${t.map(x=>(x/SIM_HZ).toFixed(1)).join(' ')}]`;
  };
  console.log(`[cidade-05c] boss reach (walk ${citySpeed(BOSS_TUNING.speed).toFixed(3)} u/s in phase 1, ${ticksRun} ticks, ${ms.toFixed(0)} ms):\n  ${BOSS_SETUPS.map(line).join('\n  ')}\n  ${stuck.length} stuck > 10 s${stuck.length?`: ${stuck.slice(0,5).join('; ')}`:''}`);
  const failed=runs.filter(r=>r.reached<0).map(r=>`${r.setup} seed ${r.seed}: not within ${BOSS_REACH} u of a player in 240 s (spawn ${fmt(r.spawn)}, path ${r.pathU.toFixed(1)} u, team ${r.team.map(fmt).join(' ')})`);
  assert.deepEqual(stuck.slice(0,10),[],`${stuck.length} times the boss stayed > 10 s in one cell while a player was reachable for its size`);
  assert.deepEqual(failed.slice(0,10),[],`${failed.length} scenarios where the boss never reached the team`);
});
test('boss detour (addendum §1, hero-size steer): spread and split, 20 seeds each: the boss walks ≤ 2 × its hero path to the nearest player at spawn + 20 u before the first contact',()=>{
  const {runs}=bossRuns(),bad:string[]=[],lines:string[]=[];
  for(const setup of ['spread','split'] as const){
    const list=runs.filter(r=>r.setup===setup);
    lines.push(`${setup}: reach [${list.map(r=>r.reached<0?'never':(r.reached/SIM_HZ).toFixed(1)).join(' ')}] s; walked/path u [${list.map(r=>`${r.walked.toFixed(0)}/${r.pathU.toFixed(0)}`).join(' ')}]`);
    for(const r of list){
      const limit=2*r.pathU+20;
      if(!(r.reached>=0&&r.walked<=limit))bad.push(`${setup} seed ${r.seed}: walked ${r.walked.toFixed(1)} u (limit ${limit.toFixed(1)}, hero path ${r.pathU.toFixed(1)} u), ${r.reached<0?'never reached':`reached in ${secs(r.reached)}`} (spawn ${fmt(r.spawn)}, team ${r.team.map(fmt).join(' ')})`);
    }
  }
  console.log(`[cidade-05c] boss detour (walked ≤ 2 × hero path + 20 u):\n  ${lines.join('\n  ')}`);
  assert.deepEqual(bad.slice(0,10),[],`${bad.length} scenarios where the boss walked the long way round`);
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
 * velocidade-heroi-e-projetil re-recorded the endless one (its director's spawn ring and warning lead follow the 2× walk;
 * the island's is unchanged); the same tree with HERO_SPEED_MULT = 1, PROJECTILE_SPEED_MULT = 1 and the ring 5..8 + 3
 * gives the previous hash exactly.
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
// infinito re-recorded for D-046 (the widest camera moves the endless spawn ring out, the catch-up runs to the default zoom's screen) and velocidade-heroi-e-projetil (2× walk, half-speed shots); the island is unchanged.
// Both re-recorded for balanco-pos-1-7's enemy radius × ENEMY_RADIUS_SCALE 1.15 (the boss's, every body's and the
// enemy-ai's neighbour reach, which is the boss's radius; were
// ilha 75a2225f4fc40291, infinito e2d8811cc8c12ed9), the one change allowed to move them.
// Both again for heroi-empurra-inimigos (heroes and critters solid to each other; were ilha 251d5c145e1bf470,
// infinito dba3b8b9445b3997).
// Both again for vida-inimigos-estilo-clash: role hp (ROLE_HITS), ×0.7 bodies from round 2, ×1.4 XP.
const BOSS_BASELINE:Readonly<Record<string,string>>={ilha:'f2cdd64acf0330fc',infinito:'9d8dabc1887c3e50'};
test('island and endless untouched: the assembled boss run matches the digest recorded before cidade-05c',()=>{
  const got={ilha:bossDigest('ilha'),infinito:bossDigest('infinito')};
  console.log(`[cidade-05c] island/endless boss digests: ${JSON.stringify(got)}`);
  assert.deepEqual(got,BOSS_BASELINE,'island/endless boss behavior differs from the base commit a595d33');
});

// ---------- 7. addendum v2 ----------
/** Island/endless: a walkable boss spot 6-8 u from the spawn with a clear straight line to it (the player stands at the spawn). */
function openIslandSpot(terrain:SimWorld['terrain']){
  const s=worldSpawn(terrain);
  for(const d of [7,6,8])for(let i=0;i<16;i++){
    const a=i/16*Math.PI*2,at={x:s.x+Math.cos(a)*d,y:s.y+Math.sin(a)*d};
    if(walkable(at,terrain)&&clearSegment(at,s,terrain))return {at,player:s};
  }
  throw new Error('no open boss spot near the spawn');
}
/** A fresh boss of `rig`'s controller at `at`, one player at `player`, ready to act; phase 1, 2 or 3 (enraged). */
function freshBoss(rig:Rig,at:Point,player:Point,phase=1,seed=1){
  const {world,sys}=rig;
  Object.assign(world.round,{index:10,total:10,phase:'wave',phaseEndsTick:1e9,remaining:1});
  world.enemies.clear();world.telegraphs.clear();world.pickups.clear();rig.players.clear();
  sys.boss.reset();world.rng=new Rng(seed);
  addPlayer(rig.players,'p',player);
  const b=sys.boss.spawnBoss(world,at)!;
  assert.ok(b&&Math.hypot(b.x-at.x,b.y-at.y)<1e-9,`the boss spawned at ${fmt(at)}`);
  b.readyTick=world.tick;
  if(phase===PHASE_ASSEMBLY)b.phase=PHASE_ASSEMBLY;
  if(phase===PHASE_ENRAGED)sys.boss.enrage(world);
  assert.equal(b.phase??1,phase,'boss phase');
  // Walk only (no attack, no summons) until told otherwise.
  b.memory!.next=Infinity;b.memory!.summonAt=Infinity;
  return b;
}
/** Measured walking speed (u/s): the longest step of 10 walking ticks (a free step is speed / SIM_HZ). */
function walkSpeed(rig:Rig,at:Point,player:Point,phase:number){
  const b=freshBoss(rig,at,player,phase);
  let max=0;
  for(let i=0;i<10;i++){const x=b.x,y=b.y;rig.world.tick++;rig.sys.boss.step(rig.world);max=Math.max(max,Math.hypot(b.x-x,b.y-y));}
  return max*SIM_HZ;
}
/**
 * The boss at `at` attacks once, `player` its only target, after 12 walking ticks in place (the steer's players
 * field is built on this team; the boss is put back at `at` after each). 'line' = a charge, 'circle' = a slam.
 */
function attackOnce(rig:Rig,at:Point,player:Point,seed:number){
  const b=freshBoss(rig,at,player,1,seed),{world,sys}=rig;
  for(let k=0;k<12;k++){world.tick++;sys.boss.step(world);b.x=at.x;b.y=at.y;}
  world.telegraphs.clear();
  b.memory!.next=world.tick+1;world.tick++;sys.boss.step(world);
  const shapes=[...world.telegraphs.values()].filter(t=>t.owner===b.id).map(t=>t.shape);
  return {b,shapes};
}
/** Dash of the boss: the first charge within 24 tries; its length (u), moving ticks and speed (u/s). */
function dash(rig:Rig,at:Point,player:Point){
  for(let t=0;t<24;t++){
    const {b,shapes}=attackOnce(rig,at,player,100+t);
    if(!shapes.includes('line'))continue;
    const act=b.memory!.act;let length=0,n=0;
    for(let i=0;i<ticks(4);i++){
      const x=b.x,y=b.y;rig.world.tick++;rig.sys.boss.step(rig.world);
      const d=Math.hypot(b.x-x,b.y-y);if(d>1e-9){length+=d;n++;}
      if(b.memory!.act!==act)break;
    }
    return {length,ticks:n,speed:n?length/(n/SIM_HZ):0};
  }
  return undefined;
}
/**
 * City spots for the boss and a player, by the hero-size path (the planner grid): `against` = the player 4.5-6.5 u
 * away behind a corner (straight line blocked, ≥ 2.5 u of it clear for a charge, the path's first step > 70° off that
 * line); `along` = the player 7-10 u away in plain sight (clear line, the path's first step < 15° off it).
 */
let chargeSpotsMemo:{against:[Point,Point][];along:[Point,Point][]}|undefined;
function chargeSpots(){
  if(chargeSpotsMemo)return chargeSpotsMemo;
  const grid=gridOf(PLAN),r=new Rng(77),against:[Point,Point][]=[],along:[Point,Point][]=[],dir={x:0,y:0};
  const w=city.asset.cells.w,h=city.asset.cells.h;
  for(let tries=0;tries<600&&(against.length<4||along.length<2);tries++){
    const p={x:(r.int(20,w-21)+.5)*CS,y:(r.int(20,h-21)+.5)*CS};
    if(!walkable(p,city))continue;
    let field:FlowField|undefined;
    const fieldOf=()=>field??=new FlowField(grid,[p]);
    let gotAgainst=against.length>=4,gotAlong=along.length>=2;
    for(let i=0;i<32&&(!gotAgainst||!gotAlong);i++){
      const a=i/32*Math.PI*2,ux=Math.cos(a),uy=Math.sin(a);
      for(const d of [4.5,5.5,6.5,7,8.5,10]){
        const b={x:p.x-ux*d,y:p.y-uy*d},wantAgainst=d<=6.5;
        if(wantAgainst?gotAgainst:gotAlong)continue;
        if(!walkable(b,city))continue;
        const lineClear=clearSegment(b,p,city);
        if(wantAgainst){
          if(lineClear||!clearSegment(b,{x:b.x+ux*2.5,y:b.y+uy*2.5},city))continue;
        }else if(!lineClear)continue;
        const f=fieldOf();
        if(!f.reachable(b.x,b.y))continue;
        f.directionAt(b.x,b.y,dir);
        const l=Math.hypot(dir.x,dir.y);if(l<1e-6)continue;
        const cos=(dir.x*ux+dir.y*uy)/l;
        if(wantAgainst&&cos<Math.cos(70*Math.PI/180)){against.push([b,p]);gotAgainst=true;}
        if(!wantAgainst&&cos>Math.cos(15*Math.PI/180)){along.push([b,p]);gotAlong=true;}
      }
    }
  }
  return chargeSpotsMemo={against,along};
}

test('speeds (addendum §3): catalog kinds × round multipliers {0.75, 1, 1.25} and the boss (phases 1/2/enraged, dash): the city speed is ≤ the city hero exactly when the endless speed is ≤ the endless hero; monotone',()=>{
  const MULTS=[.75,1,1.25],PHASE_MULT=[1,BOSS_TUNING.phase2Speed,BOSS_TUNING.phase2Speed*BOSS_TUNING.enragedSpeed];
  /** endless: the authored effective speed; before: 572ede3 (converted base × multiplier); after: now. */
  const rows:{name:string;endless:number;before:number;after:number}[]=[];
  // Enemies: the director gives exactly citySpeed(catalog × plan.speed) (section 2 checks it on real × 0.75 / × 1.25 rounds).
  for(const d of Object.values(ENEMIES))for(const m of MULTS)rows.push({name:`${d.id} ×${m}`,endless:d.speed*m,before:citySpeed(d.speed)*m,after:citySpeed(d.speed*m)});
  // The boss, measured: assemble's controllers in the city (a player in plain sight) and on the island/endless.
  const cityRig=assembled(city,3),{along}=chargeSpots();
  assert.ok(along.length,'a city spot with the player in plain sight');
  const [cAt,cPlayer]=along[0];
  const islandRig=assembled(new TerrainField(3),3),endlessRig=assembled(new TerrainField(3,{world:'infinito'}),3);
  const isl=openIslandSpot(islandRig.world.terrain),end=openIslandSpot(endlessRig.world.terrain);
  const bossLines:string[]=[];
  [1,PHASE_ASSEMBLY,PHASE_ENRAGED].forEach((phase,k)=>{
    const authored=BOSS_TUNING.speed*PHASE_MULT[k];
    const c=walkSpeed(cityRig,cAt,cPlayer,phase);
    const i=walkSpeed(islandRig,isl.at,isl.player,phase);
    const e=walkSpeed(endlessRig,end.at,end.player,phase);
    bossLines.push(`phase ${phase}: island ${i.toFixed(3)}, endless ${e.toFixed(3)}, city ${c.toFixed(3)} (expected ${citySpeed(authored).toFixed(3)})`);
    assert.ok(close(i,authored,1e-6),`island boss phase ${phase}: walks ${i}, authored ${authored}`);
    assert.ok(close(e,authored,1e-6),`endless boss phase ${phase}: walks ${e}, authored ${authored}`);
    assert.ok(close(c,citySpeed(authored),1e-6),`city boss phase ${phase}: walks ${c}, expected citySpeed(${authored.toFixed(3)}) = ${citySpeed(authored)}`);
    rows.push({name:`boss phase ${phase}`,endless:i,before:citySpeed(BOSS_TUNING.speed)*PHASE_MULT[k],after:c});
  });
  // The dash: chargeLength over dashTicks authored; in the city its speed is mapped (to within a tick of rounding).
  const authoredDash=BOSS_TUNING.chargeLength/(BOSS_TUNING.dashTicks/SIM_HZ);
  const cd=dash(cityRig,cAt,cPlayer),id=dash(islandRig,isl.at,isl.player);
  assert.ok(cd&&id,'the boss charged in the city and on the island');
  bossLines.push(`dash: island ${id!.speed.toFixed(2)} u/s (${id!.length.toFixed(2)} u in ${id!.ticks} ticks), city ${cd!.speed.toFixed(2)} u/s (${cd!.length.toFixed(2)} u in ${cd!.ticks} ticks), citySpeed(${authoredDash}) = ${citySpeed(authoredDash).toFixed(2)}`);
  assert.ok(id!.speed<=authoredDash*(1+1e-9),`island dash ${id!.speed} ≤ authored ${authoredDash}`);
  assert.equal(id!.ticks,BOSS_TUNING.dashTicks,'island dash lasts dashTicks');
  assert.ok(cd!.speed<=citySpeed(authoredDash)*(1+.5/Math.max(1,cd!.ticks-.5))+1e-9,`city dash ${cd!.speed.toFixed(3)} u/s ≤ citySpeed(${authoredDash}) = ${citySpeed(authoredDash).toFixed(3)} (+ tick rounding)`);
  assert.ok(cd!.speed>=citySpeed(authoredDash)*.85,`city dash ${cd!.speed.toFixed(3)} u/s ≈ citySpeed(${authoredDash}) = ${citySpeed(authoredDash).toFixed(3)} (clear line)`);
  rows.push({name:'boss dash',endless:id!.speed,before:authoredDash,after:cd!.speed});
  // Same side of the hero, before the fix and now; monotone now.
  const side=(r:{endless:number},v:number)=>(r.endless<=INF.hero.speed+1e-9)===(v<=CITY.hero.speed+1e-9);
  const crossedBefore=rows.filter(r=>!side(r,r.before)).map(r=>r.name),crossed=rows.filter(r=>!side(r,r.after)).map(r=>`${r.name}: endless ${r.endless.toFixed(3)} (hero ${INF.hero.speed}), city ${r.after.toFixed(3)} (hero ${CITY.hero.speed.toFixed(3)})`);
  const sorted=[...rows].sort((a,b)=>a.endless-b.endless),inversions:string[]=[];
  for(let k=1;k<sorted.length;k++){
    const a=sorted[k-1],b=sorted[k];
    if(b.endless>a.endless+1e-9?!(b.after>a.after):!(b.after>=a.after-1e-9))inversions.push(`${a.name} ${a.endless.toFixed(3)}→${a.after.toFixed(3)} vs ${b.name} ${b.endless.toFixed(3)}→${b.after.toFixed(3)}`);
  }
  console.log(`[cidade-05c] effective speeds, hero endless ${INF.hero.speed} / city ${CITY.hero.speed.toFixed(3)} u/s (name: endless → before (572ede3) → after):\n  ${rows.map(r=>`${r.name}: ${r.endless.toFixed(3)} → ${r.before.toFixed(3)}${side(r,r.before)?'':' (past the hero)'} → ${r.after.toFixed(3)}`).join('\n  ')}\n  boss measured: ${bossLines.join('; ')}\n  before: ${crossedBefore.length} past the hero (${crossedBefore.join(', ')}); after: ${crossed.length}`);
  assert.deepEqual(crossed,[],'effective city speeds on the other side of the hero than their endless speeds');
  assert.deepEqual(inversions,[],'effective city speeds out of the endless order');
});

test('siege while the team is away (inicio): siege groups are placed like plaza-aimed groups (not toward the team) and every siege body reaches the base before its round ends',()=>{
  const report:string[]=[],far:string[]=[],late:string[]=[];let total=0;
  for(const seed of [1,2]){
    const rig=assembled(city,seed),{world,sys}=rig,P=plannerOf(rig);
    addPlayer(rig.players,'a',INICIO);addPlayer(rig.players,'b',{x:INICIO.x+1,y:INICIO.y});
    const team:PlayerLike[]=[...rig.players.values()];
    const teamCost=pathCost(gridOf(P),team);
    interface Siege {round:number;spawn:number;plazaU:number;ref:number;teamU:number;inBase:number;end?:string}
    const sieges=new Map<string,Siege>(),aimed=new Map<number,number[]>();
    for(let i=0;i<ticks(900)&&world.round.index<=SIEGE_FROM_ROUND+1;i++){
      world.step();
      const fresh=[...world.enemies.values()].filter(e=>e.spawnTick===world.tick&&!e.boss&&e.memory?.round!==undefined);
      // Plaza-aimed reference for this tick's siege bodies: the planner's plaza scan (no chaseCost) of a group of the same
      // size on the same mouth, for the same viewers.
      const byMouth=new Map<Mouth|undefined,EnemyState[]>();
      for(const e of fresh){
        if(e.memory?.siege!==1){
          // Regular bodies (aimed at the team) only matter for the report; dropping them keeps the run short. The
          // round still ends on its timer (nobody kills the siege bodies), and the city has no last call.
          const round=e.memory!.round;
          if(round>=SIEGE_FROM_ROUND)(aimed.get(round)??aimed.set(round,[]).get(round)!).push(plazaU(P,e));
          world.damageEnemy(e.id,1e9);continue;
        }
        const m=P.retreatMouth(e);(byMouth.get(m)??byMouth.set(m,[]).get(m)!).push(e);
      }
      for(const [m,list] of byMouth){
        const avenues=sys.director.state.avenues!,open=m&&avenues.open.includes(m)?[m]:avenues.open;
        let ref=-Infinity;
        for(const o of open){
          const state:AvenueState={round:avenues.round,mode:'normal',open:[o],alternate:0,uses:{N:0,S:0,L:0,O:0}};
          const [g]=P.planGroups([{at:0,size:list.length}],team,state,new Rng(seed));
          for(const q of g?.points??[])ref=Math.max(ref,plazaU(P,q));
        }
        for(const e of list)sieges.set(e.id,{round:e.memory!.round,spawn:world.tick,plazaU:plazaU(P,e),ref,teamU:teamCost(e),inBase:-1});
      }
      for(const [id,s] of sieges){
        if(s.inBase>=0||s.end)continue;
        const e=world.enemies.get(id);
        if(!e)s.end='gone';
        else if(P.insideBase(e))s.inBase=world.tick-s.spawn;
        else if(e.memory?.retreat===1||world.round.index!==s.round||sys.director.state.stage!=='wave')s.end=`retreated ${secs(world.tick-s.spawn)} after its spawn, ${plazaU(P,e).toFixed(0)} u from the plaza`;
      }
    }
    for(let round=SIEGE_FROM_ROUND;round<=SIEGE_FROM_ROUND+1;round++){
      const list=[...sieges].filter(([,s])=>s.round===round);
      total+=list.length;
      const reached=list.filter(([,s])=>s.inBase>=0);
      report.push(`seed ${seed} round ${round}: ${list.length} siege bodies, ${reached.length} reached the base (median ${reached.length?secs(median(reached.map(([,s])=>s.inBase))):'-'}); spawn walk to the plaza median ${median(list.map(([,s])=>s.plazaU)).toFixed(1)} u (max ${Math.max(...list.map(([,s])=>s.plazaU)).toFixed(1)}, plaza-aimed reference max ${Math.max(...list.map(([,s])=>s.ref)).toFixed(1)}), to the team median ${median(list.map(([,s])=>s.teamU)).toFixed(0)} u; regular (team-aimed) bodies: plaza walk median ${median(aimed.get(round)??[]).toFixed(1)} u`);
      for(const [id,s] of list){
        // 3 u of slack on the 1.7× city; 5 u on asset v4 (mapa-175-com-viaduto): its smaller plaza spreads the hidden spots
        // of a group more (measured 12.6 u for an 8.4 u reference, with the team 88 u away and team-aimed bodies at ~44 u).
        if(!(s.plazaU<=s.ref+5))far.push(`seed ${seed} round ${round} ${id}: ${s.plazaU.toFixed(1)} u from the plaza, a plaza-aimed group is ${s.ref.toFixed(1)} u (team ${s.teamU.toFixed(0)} u away)`);
        if(s.inBase<0)late.push(`seed ${seed} round ${round} ${id}: ${s.end??'still walking at the end of the run'}`);
      }
    }
  }
  console.log(`[cidade-05c] siege with the team at inicio (rounds ${SIEGE_FROM_ROUND}-${SIEGE_FROM_ROUND+1}, ${total} siege bodies):\n  ${report.join('\n  ')}`);
  assert.ok(total>=4,`siege bodies were spawned (${total})`);
  assert.deepEqual(far.slice(0,8),[],`${far.length} siege bodies placed away from the base (aimed at the team?)`);
  assert.deepEqual(late.slice(0,8),[],`${late.length} siege bodies did not reach the base before their round ended`);
});

test('chaseCost (planner, unit): openRound opens the avenue nearest the team; planGroups puts a group at the hidden spot nearest the team (aim \'plaza\' keeps the plaza scan); unreachable → the plaza behavior',()=>{
  const P=PLAN,grid=gridOf(P);
  // openRound: a team at the far end of each avenue gets that avenue first (normal, 1 and 2 mouths; alternado; excursão).
  for(const m of MOUTHS){
    const end=P.route(m)!.points[0],chaseCost=pathCost(grid,[end]);
    for(const [round,mode] of [[1,'normal'],[4,'normal'],[1,'excursao'],[1,'alternado']] as [number,AvenueMode][]){
      const s=P.openRound(round,mode,new Rng(round),undefined,{chaseCost});
      assert.equal(s.open[0],m,`team at the end of avenue ${m}: ${mode} round ${round} opens ${s.open.join('')}`);
      if(mode==='alternado')assert.deepEqual([...s.open].sort(),[m,OPPOSITE[m]].sort(),'alternado: the pair holding that avenue');
    }
    assert.deepEqual(P.openRound(1,'cerco',new Rng(1),undefined,{chaseCost}).open,[...MOUTHS],'cerco: all four, unchanged');
  }
  // planGroups: team at inicio. The first member stands at (about) the hidden spot of the avenue nearest the team.
  const team:PlayerLike[]=[{id:'a',x:INICIO.x,y:INICIO.y,online:true},{id:'b',x:INICIO.x+1,y:INICIO.y,online:true}];
  const chaseCost=pathCost(grid,team),state=P.openRound(1,'normal',new Rng(5),undefined,{chaseCost}),mouth=state.open[0];
  const route=P.route(mouth)!;
  let nearest=Infinity,samples=0;
  for(let k=1;k<route.points.length;k++){
    const a=route.points[k-1],b=route.points[k],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.25));
    for(let j=0;j<=n;j++){
      const q={x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n};
      if(P.insideBase(q)||!P.plazaField.reachable(q.x,q.y)||!P.hiddenFrom(team,q))continue;
      samples++;nearest=Math.min(nearest,chaseCost(q));
    }
  }
  assert.ok(samples>0&&Number.isFinite(nearest),`avenue ${mouth} has hidden spots reaching the team`);
  const lines:string[]=[];
  for(const size of [1,4]){
    const [g]=P.planGroups([{at:0,size}],team,state,new Rng(6),{chaseCost});
    const [plaza]=P.planGroups([{at:0,size}],team,state,new Rng(6));
    assert.equal(g.points.length,size,`size ${size}: every member placed`);
    for(const q of g.points){
      assert.ok(P.hiddenFrom(team,q),`member at ${fmt(q)} is hidden from the team`);
      assert.ok(!P.insideBase(q)&&P.plazaField.reachable(q.x,q.y),`member at ${fmt(q)} outside the base, plaza-connected`);
    }
    const c=Math.min(...g.points.map(chaseCost)),cp=Math.min(...plaza.points.map(chaseCost));
    lines.push(`size ${size}: aimed ${c.toFixed(1)} u from the team (nearest hidden route spot ${nearest.toFixed(1)} u, ${plazaU(P,g.points[0]).toFixed(1)} u from the plaza), plaza-aimed ${cp.toFixed(1)} u (${plazaU(P,plaza.points[0]).toFixed(1)} u from the plaza)`);
    assert.ok(c<=nearest+1.2,`size ${size}: nearest member ${c.toFixed(2)} u from the team, the nearest hidden spot of avenue ${mouth} is ${nearest.toFixed(2)} u`);
    assert.ok(c+5<cp,`size ${size}: aimed ${c.toFixed(1)} u vs plaza-aimed ${cp.toFixed(1)} u from the team`);
    // travel = the walk to the team at the planner's speed (the member's own spot is within jitter + a scan step of its route point).
    const travel=g.arrivalTick-g.releaseTick,want=ticks(chaseCost(g.points[0])/CITY_ENEMY_SPEED);
    assert.ok(Math.abs(travel-want)<=ticks(1.2/CITY_ENEMY_SPEED)+1,`size ${size}: travel ${travel} ticks, walk to the team ${want} ticks`);
    // aim 'plaza' (a siege group): the plaza scan, chaseCost or not.
    assert.deepEqual(P.planGroups([{at:0,size,aim:'plaza'}],team,state,new Rng(6),{chaseCost}),[plaza],`size ${size}: aim 'plaza' ignores chaseCost`);
  }
  // Unreachable team (chaseCost Infinity everywhere): exactly the plaza behavior.
  const never=()=>Infinity,requests=[{at:0,size:3},{at:ticks(4),size:5}];
  for(const [round,mode] of [[1,'normal'],[5,'normal'],[2,'alternado'],[3,'cerco']] as [number,AvenueMode][]){
    const a=P.openRound(round,mode,new Rng(9),undefined,{chaseCost:never}),b=P.openRound(round,mode,new Rng(9));
    assert.deepEqual(a,b,`openRound ${mode} ${round}: unreachable team = no chaseCost`);
    assert.deepEqual(P.planGroups(requests,team,a,new Rng(10),{chaseCost:never}),P.planGroups(requests,team,b,new Rng(10)),`planGroups ${mode}: unreachable team = no chaseCost`);
  }
  console.log(`[cidade-05c] chaseCost unit (team at inicio, avenue ${mouth}): ${lines.join('; ')}`);
});

test('chaseCost in the director: one live player in the base keeps the groups aimed at the plaza (first group at the plaza in ≈ 12 s although a teammate waits at inicio)',()=>{
  const report:string[]=[],bad:string[]=[];
  for(let seed=1;seed<=3;seed++){
    const w=firstWave(seed,[INICIO,PLAN.plazaCenter]);
    report.push(`seed ${seed}: ${w.text}`);
    // 9–14 s, 9–16 s since velocidade-heroi-e-projetil: the 2× walk doubles the spawn lead (CITY_VIEW_LEAD), the first
    // group starts farther out and lands ~1.8 s later (13.25 / 11.65 / 13.0 s → 15.05 / 12.45 / 14.95 s; option (a)).
    if(!(w.spawned&&w.arrival>=ticks(9)&&w.arrival<=ticks(16)))bad.push(`seed ${seed}: ${w.text}`);
  }
  console.log(`[cidade-05c] one player in the base, one at inicio (round 1, assembled):\n  ${report.join('\n  ')}`);
  assert.deepEqual(bad,[],'the first group reaches the plaza in 9-16 s');
});

test('incremental refresh: random grid.refresh edits → every citySteer field (players + size classes, the boss\'s hero steer) and the director\'s team field equal a fresh build within ≤ 9 ticks',()=>{
  // The real city with a mutable layer of blocked samples (barricades), as cidade-06 will raise them.
  const a0=city.asset,step=a0.samples.step,sw=a0.samples.w,sh=a0.samples.h,blocked=new Uint8Array(sw*sh);
  const wk=(sx:number,sy:number)=>sx>=0&&sx<sw&&sy>=0&&sy<sh&&blocked[(sy|0)*sw+(sx|0)]?false:a0.walkable(sx,sy);
  const asset=Object.create(a0,{walkable:{value:wk},walkableAt:{value:(x:number,y:number)=>wk(x/step+1e-6,y/step+1e-6)}}) as typeof a0;
  const t2=new CityTerrain(asset,city.signature);
  const rig=assembled(t2,7),{world,sys}=rig,P=plannerOf(rig),grid=gridOf(P);
  const a=addPlayer(rig.players,'a',INICIO),b=addPlayer(rig.players,'b',{x:P.plazaCenter.x+20,y:P.plazaCenter.y});
  const EVERY=10;
  const st=citySteer(P,{terrain:t2,refreshTicks:EVERY});
  // One body per size class (and the hero), near the plaza; the boss-size one also through the hero-only steer.
  const dummies=[.2,.3,.45,.7,.9].map((radius,i)=>({id:`d${i}`,kind:'bebado',x:P.plazaCenter.x+(i-2)*2,y:P.plazaCenter.y-3,radius,speed:1,hp:1,maxHp:1,damage:0,xp:0,spawnTick:0,readyTick:0,memory:{}}) as EnemyState);
  const out={x:0,y:0};
  const callAll=()=>{for(const d of dummies)st(world,d,a,out);st.hero(world,dummies[4],a,out);};
  const streets:{cx:number;cy:number}[]=[];
  for(let cy=0;cy<grid.height;cy++)for(let cx=0;cx<grid.width;cx++)if(grid.walkable(cx,cy))streets.push({cx,cy});
  const r=new Rng(7);
  /** Raises (60%) or clears a 2-12 × 2-12 sample block on a street; refreshes the cells its hero disc can touch. */
  function barricade(){
    const c=r.pick(streets),wS=r.int(2,12),hS=r.int(2,12),on=r.next()<.6;
    const sx0=Math.floor((c.cx+.5)*CS/step)-(wS>>1),sy0=Math.floor((c.cy+.5)*CS/step)-(hS>>1);
    for(let sy=sy0;sy<sy0+hS;sy++)for(let sx=sx0;sx<sx0+wS;sx++)if(sx>=0&&sy>=0&&sx<sw&&sy<sh)blocked[sy*sw+sx]=on?1:0;
    const rect:CellRect={x0:Math.floor((sx0*step-RADIUS)/CS)-1,y0:Math.floor((sy0*step-RADIUS)/CS)-1,x1:Math.floor(((sx0+wS)*step+RADIUS)/CS)+1,y1:Math.floor(((sy0+hS)*step+RADIUS)/CS)+1};
    grid.refresh(rect);P.invalidate([rect]);
  }
  const fieldDiff=(f:FlowField,g:FlowField)=>{let n=0;for(let cy=0;cy<f.height;cy++)for(let cx=0;cx<f.width;cx++)if(f.cellCost(cx,cy)!==g.cellCost(cx,cy))n++;return n;};
  // Build everything once on the clean city (the director's team field included), then edit.
  for(let k=0;k<EVERY;k++){world.tick++;callAll();}
  assert.ok(sys.director.cityTeamField(world),'the director has a team field in the city');
  const ROUNDS=6,lines:string[]=[],bad:string[]=[];
  for(let round=0;round<ROUNDS;round++){
    // Round 1: more refreshes than the grid's change log remembers (whole-grid fallback).
    const n=round===1?70:r.int(1,3);
    for(let i=0;i<n;i++)barricade();
    if(round%2===0){b.x=P.plazaCenter.x+r.range(-25,25);b.y=P.plazaCenter.y+r.range(-25,25);if(!walkable(b,t2)){b.x=P.plazaCenter.x;b.y=P.plazaCenter.y;}}
    if(round===3)st.refresh(world);
    for(let k=0;k<EVERY;k++){world.tick++;callAll();}
    // ≤ 9 ticks after the first tick that saw the edits (10 calls): compare with fresh builds on a fresh grid.
    const g2=cityFlowGrid(t2);
    let cells=0;for(let i=0;i<grid.cells.length;i++)if(grid.cells[i]!==g2.cells[i])cells++;
    const fresh=citySteer(P,{terrain:t2,grid:g2,refreshTicks:EVERY});
    for(const d of dummies)fresh(world,d,a,out);
    const diffs:string[]=[];
    if(cells)diffs.push(`grid cells ${cells}`);
    const pf=st.playersField,fpf=fresh.playersField;
    assert.ok(pf&&fpf,'players fields built');
    const dp=fieldDiff(pf!,fpf!);if(dp)diffs.push(`players ${dp}`);
    let compared=1;
    st.widePlayersFields.forEach((ls,k)=>ls.forEach((f,j)=>{
      const g=fresh.widePlayersFields[k]?.[j];
      if(!g){diffs.push(`class ${WIDE_RADII[k]}${j?' corners':''}: no fresh field`);return;}
      compared++;const d=fieldDiff(f,g);if(d)diffs.push(`class ${WIDE_RADII[k]}${j?' corners':''} ${d}`);
    }));
    const team=[...rig.players.values()].filter(live).map(p=>({x:p.x,y:p.y}));
    const tf=sys.director.cityTeamField(world);
    assert.ok(tf,'the director team field');
    const dt=fieldDiff(tf!,new FlowField(g2,team));if(dt)diffs.push(`director team ${dt}`);
    lines.push(`round ${round}: ${n} refreshes (grid version ${grid.version}), ${compared} steer fields + the team field compared${diffs.length?`, DIFF ${diffs.join(', ')}`:''}`);
    if(diffs.length)bad.push(`round ${round} (${n} refreshes): ${diffs.join(', ')}`);
  }
  console.log(`[cidade-05c] incremental refresh vs fresh builds (refreshTicks ${EVERY}):\n  ${lines.join('\n  ')}`);
  assert.deepEqual(bad,[],'fields that did not follow the grid edits within 9 ticks');
});

test('45° charge rule: in the city a boss whose walk turns > 45° off the line to the player (around a corner) never charges, one in plain sight does; on the island it charges as before',()=>{
  const {against,along}=chargeSpots();
  assert.ok(against.length>=3&&along.length>=1,`spots found: ${against.length} around a corner, ${along.length} in plain sight`);
  const cityRig=assembled(city,8),TRIES=8;
  const count=(rig:Rig,at:Point,player:Point)=>{
    let line=0,circle=0;
    for(let t=0;t<TRIES;t++){const {shapes}=attackOnce(rig,at,player,200+t);if(shapes.includes('line'))line++;if(shapes.includes('circle'))circle++;}
    return {line,circle};
  };
  const lines:string[]=[],charged:string[]=[];let slams=0;
  for(const [at,p] of against){
    const c=count(cityRig,at,p);slams+=c.circle;
    lines.push(`corner ${fmt(at)}→${fmt(p)}: ${c.line} charges, ${c.circle} slams`);
    if(c.line)charged.push(`${fmt(at)} → player ${fmt(p)}: ${c.line}/${TRIES} charges`);
  }
  const open=count(cityRig,along[0][0],along[0][1]);
  // Control: the same corners with a boss that has no steer (so no 45° rule) do charge (≥ 2.5 u of clear line).
  const bare=assembled(city,8),control={...bare,sys:{...bare.sys,boss:createBoss({speedMap:citySpeed})}};
  let controlCharges=0;
  for(const [at,p] of against)controlCharges+=count(control,at,p).line;
  const islandRig=assembled(new TerrainField(3),8),isl=openIslandSpot(islandRig.world.terrain);
  const island=count(islandRig,isl.at,isl.player);
  console.log(`[cidade-05c] 45° charge rule (${TRIES} attacks per spot): ${lines.join('; ')}; plain sight ${open.line} charges / ${open.circle} slams; corners without the rule (no steer) ${controlCharges} charges; island ${island.line} charges / ${island.circle} slams`);
  assert.deepEqual(charged,[],'the boss charged into a corner its walk was going around');
  assert.equal(slams,against.length*TRIES,'around a corner every attack is a slam');
  assert.ok(controlCharges>0,'control: without the steer the boss charges at those corners');
  assert.ok(open.line>0,'in plain sight the boss still charges');
  assert.ok(island.line>0,'on the island the boss still charges');
});

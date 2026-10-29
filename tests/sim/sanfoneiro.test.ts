/**
 * NEW-20261029-ORQ-sanfoneiro-regra-arrastar (src/sim/enemies/sanfoneiro.ts): the Sanfoneiro Arrasta-Pé
 *  - tocar: a warned play that drags the heroes inside SANFONA.radius toward him, slower than a hero walks
 *  - not outside the radius, no teleport (one bounded step a tick), walls hold, running against it escapes
 *  - the fole: a warned 'pancada' with a cooldown that shoves the hero back once it lands
 *  - frozen or knocked silly, the sanfona stops; and he stays out of the wave draw (HELD_ROSTER)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,SIM_HZ,ticks,type SimEvent,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {createEnemy,enemyDef} from '../../src/sim/enemies/catalog.ts';
import {ENEMY_PHASE,EnemyAi} from '../../src/sim/enemies/ai.ts';
import {FOLE,SANFONA,SANFONA_STATE,SANFONEIRO_ID,isPlaying} from '../../src/sim/enemies/sanfoneiro.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {MIN_TELEGRAPH_TICKS,createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import {MAX_PROJECTILES} from '../../src/rules/budget.ts';
import {HELD_ROSTER,ROSTER,ROSTER_IDS} from '../../src/rules/index.ts';
import {RADIUS as PLAYER_RADIUS,SPEED as HERO_SPEED,walkable,type Point} from '../../src/maps/world.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';

const TERRAIN=new TerrainField(DEFAULT_SEED,{world:'infinito'});
function openSpot(r:number):Point{
  const clear=(c:Point)=>{
    for(let dx=-r;dx<=r;dx+=.5)for(let dy=-r;dy<=r;dy+=.5)if(dx*dx+dy*dy<=r*r&&!walkable({x:c.x+dx,y:c.y+dy},TERRAIN))return false;
    return true;
  };
  for(let x=-60;x<=60;x+=2)for(let y=-60;y<=60;y+=2)if(clear({x,y}))return {x,y};
  throw new Error(`no open disc of radius ${r}`);
}
const O=openSpot(10);
function arena(seed:number,terrain=TERRAIN){
  const world=new SimWorld({terrain,seed});
  world.round.index=7;world.round.phase='wave';
  const ai=new EnemyAi({projectileCap:MAX_PROJECTILES});
  world.register(ai).register(createProjectileSystem({cap:MAX_PROJECTILES})).register(createTelegraphSystem());
  world.onKill((enemy,_by,ctx)=>ai.onKill(ctx,enemy));
  return world;
}
function hero(world:SimWorld,id:string,x:number,y=O.y):SimPlayer{
  const p:SimPlayer={id,classId:'test',x,y,hp:1000,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS,maxHp:1000},weaponReady:{}};
  world.players.set(id,p);
  return p;
}
const sanfona=(events:SimEvent[],what:'aviso'|'toca'|'para')=>events.filter(e=>e.type==='sanfona'&&e.what===what).length;
const STEP=HERO_SPEED*SANFONA.pullFactor/SIM_HZ;
/** Steps until the play starts ('toca'), then returns that tick's events; fails if it never does. */
function untilPlay(world:SimWorld,events:SimEvent[]){
  for(let i=0;i<ticks(3);i++){const ev=world.step();events.push(...ev);if(sanfona(ev,'toca'))return;}
  assert.fail('he never started playing');
}

test('the numbers: 220 px of drag, slower than a hero, 1 s warning, 2 s play, 6–8 s between plays',()=>{
  assert.ok(Math.abs(SANFONA.radius-3.70)<.01,`${SANFONA.radius}`);
  assert.ok(SANFONA.pullFactor<1&&SANFONA.pullFactor>0);
  assert.equal(SANFONA.warn,ticks(1));assert.equal(SANFONA.play,ticks(2));
  assert.ok(SANFONA.cooldown>=ticks(6)&&SANFONA.cooldown<=ticks(8));
  assert.ok(FOLE.delay>=MIN_TELEGRAPH_TICKS,'the fole is warned');
  assert.ok(FOLE.trigger<SANFONA.trigger);
});

test('kept out of the wave draw: held roster only, enemyDef still knows him (a brutamontes, ~1.2× the hero)',()=>{
  assert.ok(!ROSTER.some(e=>e.id===SANFONEIRO_ID));
  assert.ok(!(ROSTER_IDS as readonly string[]).includes(SANFONEIRO_ID));
  const held=HELD_ROSTER.find(e=>e.id===SANFONEIRO_ID);
  assert.ok(held,'in HELD_ROSTER');assert.equal(held.role,'brutamontes');
  assert.ok(enemyDef(SANFONEIRO_ID).hp>0);
});

test('tocar: warns 1 s standing still, then drags the hero inside the radius toward him; the one outside stays put',()=>{
  const world=arena(3);
  const near=hero(world,'near',O.x+3),far=hero(world,'far',O.x-SANFONA.radius-.4);
  const e=createEnemy(world,SANFONEIRO_ID,O);
  const events:SimEvent[]=[];
  events.push(...world.step());
  assert.equal(sanfona(events,'aviso'),1,'the warning starts at once with a hero inside the trigger');
  const at={x:e.x,y:e.y},start=near.x;
  untilPlay(world,events);
  assert.ok(Math.hypot(e.x-at.x,e.y-at.y)<1e-9,'he stands through the warning');
  assert.equal(e.phase,ENEMY_PHASE.acting);
  const farAt={x:far.x,y:far.y};
  let maxStep=0,prev=near.x;
  for(let i=1;i<SANFONA.play;i++){
    events.push(...world.step());
    maxStep=Math.max(maxStep,Math.abs(near.x-prev));prev=near.x;
    assert.equal(e.memory?.state,SANFONA_STATE.play);
  }
  assert.ok(near.x<start-1,`pulled ${(start-near.x).toFixed(2)} u`);
  assert.ok(maxStep<=STEP+1e-9,`no teleport: ${maxStep} > ${STEP}`);
  assert.ok(near.x-e.x>=e.radius+PLAYER_RADIUS+SANFONA.gap-1e-9,'stops short of his body');
  assert.deepEqual({x:far.x,y:far.y},farAt,'outside the radius nobody moves');
  const pulled=events.filter(ev=>ev.type==='arrastado');
  assert.deepEqual(pulled.map(ev=>ev.type==='arrastado'&&ev.player),['near'],'arrastado once, only for the hero inside');
  for(let i=0;i<3;i++)events.push(...world.step());
  assert.equal(sanfona(events,'para'),1,'the play ends');
  assert.ok(!isPlaying(e.memory?.state));
});

test('the drag is slower than a hero: walking straight away during the play gets him out of the radius',()=>{
  const world=arena(5);
  const p=hero(world,'p',O.x+3);
  const e=createEnemy(world,SANFONEIRO_ID,O);
  const events:SimEvent[]=[];
  untilPlay(world,events);
  let prev=p.x-e.x;
  for(let i=1;i<SANFONA.play&&isPlaying(e.memory?.state);i++){
    p.x+=HERO_SPEED/SIM_HZ; // the hero walks east, away from him
    events.push(...world.step());
    const d=p.x-e.x;
    assert.ok(d>prev,`tick ${i}: ${d.toFixed(3)} ≤ ${prev.toFixed(3)}`);prev=d;
  }
  assert.ok(prev>SANFONA.radius,`escaped at ${prev.toFixed(2)} u`);
});

test('walls hold: dragged into a wall, the hero stops against it and never ends up behind it',()=>{
  const WALL=[O.x+1.4,O.x+1.7];
  const walled=Object.assign(Object.create(TERRAIN),{
    base:{x:O.x-20,y:O.y},spawn:{x:O.x-20,y:O.y},
    clearDisc(x:number,y:number,r:number){return x+r<WALL[0]||x-r>WALL[1];},
  }) as TerrainField;
  const world=arena(7,walled);
  const p=hero(world,'p',O.x+3);
  createEnemy(world,SANFONEIRO_ID,O);
  const events:SimEvent[]=[];
  let moved=false;
  for(let i=0;i<ticks(4);i++){
    const x=p.x;events.push(...world.step());moved||=p.x<x;
    assert.ok(p.x-PLAYER_RADIUS>WALL[1],`tick ${i}: through the wall at ${(p.x-O.x).toFixed(3)}`);
  }
  assert.ok(sanfona(events,'toca')>0,'he played');
  assert.ok(moved,'the hero was dragged up to the wall');
});

test('pancada do fole: warned circle, moderate damage, a shove back, and a cooldown before the next one',()=>{
  const world=arena(9);
  const p=hero(world,'p',O.x+1.2);
  const e=createEnemy(world,SANFONEIRO_ID,O);
  const made:number[]=[],seen=new Set<number>();
  let fired=-1,hpBefore=p.hp,shoved=false;
  for(let i=0;i<ticks(8);i++){
    const before=p.x-e.x,hp=p.hp;
    world.step();
    for(const t of world.telegraphs.values()){
      if(t.owner!==e.id||t.kind!=='pancada'||seen.has(t.id))continue;
      seen.add(t.id);made.push(world.tick);
      assert.equal(t.shape,'circle');assert.ok(t.fireTick-world.tick>=MIN_TELEGRAPH_TICKS);
      if(fired<0){fired=t.fireTick;hpBefore=hp;}
    }
    if(fired>0&&world.tick===fired+1&&made.length===1){
      assert.ok(p.hp<hpBefore,'the fole hurts');
      assert.ok(hpBefore-p.hp<=FOLE.damage*2,`moderate: ${hpBefore-p.hp}`);
      shoved=p.x-e.x>before+.5;
    }
    p.x=Math.min(p.x,e.x+1.2);p.y=e.y; // the hero keeps pressing on him
  }
  assert.ok(made.length>=2,`${made.length} pancadas`);
  assert.ok(shoved,'the hero is pushed back when it lands');
  for(let i=1;i<made.length;i++)assert.ok(made[i]-made[i-1]>=FOLE.cooldown,`${made[i]-made[i-1]} ticks between pancadas`);
});

for(const [what,silence] of [
  ['frozen (scared)',(e:{frozenUntil?:number},tick:number)=>{e.frozenUntil=tick+ticks(1);}],
  ['knocked silly',(e:{knock?:{x:number;y:number}},_tick:number)=>{e.knock={x:.3,y:0};}],
] as const){
  test(`${what}: the sanfona stops and the drag with it`,()=>{
    const world=arena(13);
    const p=hero(world,'p',O.x+3);
    const e=createEnemy(world,SANFONEIRO_ID,O);
    const events:SimEvent[]=[];
    untilPlay(world,events);
    for(let i=0;i<3;i++)events.push(...world.step());
    (silence as (e:object,tick:number)=>void)(e,world.tick);
    const ev=world.step();
    assert.equal(sanfona(ev,'para'),1);
    assert.ok(!isPlaying(e.memory?.state));
    const x=p.x;
    for(let i=0;i<5;i++)world.step();
    assert.equal(p.x,x,'no drag once he stopped');
    assert.ok(e.memory!.actReady>=world.tick,'the cooldown started');
  });
}

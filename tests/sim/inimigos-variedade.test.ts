/**
 * NEW-20261029-ORQ-inimigos-variedade (evidence/auditoria-inimigos-29-10.md §4):
 *  - H: the clones get a feel on top of their role (rules/enemy-feel.ts): speed × hp stays about 1, the sway only where
 *    the role sways, every key a roster id of a cloned role, and enemyDef reads it
 *  - F: the brutamontes stomps too (BRUTE_SLAM), a warned 'pancada' circle around him that a player can walk out of,
 *    standing still (phase acting) until it lands
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,SIM_HZ,ticks,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {BRUTE_SLAM,ENEMIES,createEnemy,enemyDef,roleHp} from '../../src/sim/enemies/catalog.ts';
import {ENEMY_PHASE,EnemyAi,STATE} from '../../src/sim/enemies/ai.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {MIN_TELEGRAPH_TICKS,createTelegraphSystem} from '../../src/sim/telegraphs.ts';
import {MAX_PROJECTILES} from '../../src/rules/budget.ts';
import {ENEMY_FEEL,FEELS,FEEL_ROLES,ROLE_PROFILES,ROSTER,enemyFeel} from '../../src/rules/index.ts';
import {walkable,type Point} from '../../src/maps/world.ts';
import {DEFAULT_SEED,TerrainField} from '../../src/maps/terrain/field.ts';

// ---------- H: the feel ----------
test('every feel keeps the threat: speed × hp within 10 % of 1',()=>{
  for(const [id,f] of Object.entries(FEELS))assert.ok(Math.abs(f.speed*f.hp-1)<=.1,`${id}: ${f.speed*f.hp}`);
});

test('the feel table names only roster clones of the cloned roles; a sway feel only where the role sways',()=>{
  const sways=new Set(['stagger','swarm']);
  for(const [kind,feel] of Object.entries(ENEMY_FEEL)){
    const entry=ROSTER.find(e=>e.id===kind);
    assert.ok(entry&&!entry.legacy,`${kind} is a roster clone`);
    assert.ok((FEEL_ROLES as readonly string[]).includes(entry.role),`${kind}: ${entry.role}`);
    if(FEELS[feel].sway!==1)assert.ok(sways.has(ROLE_PROFILES[entry.role].behavior),`${kind}: ${feel} on ${ROLE_PROFILES[entry.role].behavior}`);
  }
  assert.equal(enemyFeel('bebado'),undefined,'the legacy kinds stay the baseline');
});

test('enemyDef reads the feel: speed, hp, radius and the zig-zag',()=>{
  for(const [kind,id] of Object.entries(ENEMY_FEEL)){
    const entry=ROSTER.find(e=>e.id===kind)!,role=ROLE_PROFILES[entry.role],base=ENEMIES[role.base],f=FEELS[id],def=enemyDef(kind);
    assert.ok(Math.abs(def.speed-base.speed*role.speed*f.speed)<1e-9,`${kind} speed`);
    assert.equal(def.hp,f.hp===1?roleHp(entry.role,base.hp):Math.round(roleHp(entry.role,base.hp)*f.hp),`${kind} hp`);
    assert.ok(Math.abs(def.radius-base.radius*role.radius*entry.cell/role.cell*f.radius)<1e-9,`${kind} radius`);
    if(def.zigzag&&base.zigzag)assert.ok(Math.abs(def.zigzag.amp-base.zigzag.amp*f.sway)<1e-9,`${kind} sway`);
  }
  // Two clones of one role no longer walk the same.
  const corredores=Object.keys(ENEMY_FEEL).filter(k=>ROSTER.find(e=>e.id===k)!.role==='corredor');
  assert.ok(new Set(corredores.map(k=>enemyDef(k).speed)).size>1);
});

// ---------- F: the brutamontes' stomp ----------
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
function arena(seed:number){
  const world=new SimWorld({terrain:TERRAIN,seed});
  world.round.index=7;world.round.phase='wave';
  const ai=new EnemyAi({projectileCap:MAX_PROJECTILES});
  world.register(ai).register(createProjectileSystem({cap:MAX_PROJECTILES})).register(createTelegraphSystem());
  world.onKill((enemy,_by,ctx)=>ai.onKill(ctx,enemy));
  return world;
}
const brutamontes=ROSTER.find(e=>e.role==='brutamontes'&&!e.legacy&&e.priority==='P0')!.id;

test('brutamontes: a warned pancada around him (≥ MIN_TELEGRAPH_TICKS), standing still in phase acting until it lands',()=>{
  const world=arena(11);
  const player:SimPlayer={id:'p',classId:'test',x:O.x+1.5,y:O.y,hp:1000,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS,maxHp:1000},weaponReady:{}};
  world.players.set('p',player);
  const brute=createEnemy(world,brutamontes,O);
  let made=-1,at={x:0,y:0},acting=true;
  for(let i=0;i<ticks(2);i++){
    world.step();
    if(made<0){
      const t=[...world.telegraphs.values()].find(x=>x.owner===brute.id&&x.kind==='pancada');
      if(t){
        made=world.tick;at={x:brute.x,y:brute.y};
        assert.equal(t.shape,'circle');assert.ok(Math.abs(t.radius-(BRUTE_SLAM.radius+brute.radius))<1e-9);
        assert.ok(t.fireTick-made>=MIN_TELEGRAPH_TICKS);
      }
    }else if(world.tick<made+BRUTE_SLAM.delay){
      acting&&=brute.memory?.state===STATE.slam&&brute.phase===ENEMY_PHASE.acting;
      assert.ok(Math.hypot(brute.x-at.x,brute.y-at.y)<.05,'he stands still while the warning runs');
    }
  }
  assert.ok(made>0,'he stomped');assert.ok(acting,'phase acting while he winds up');
});

test('the stomp can be walked out of: from his side, at walking speed, before it lands (the audit\'s rule)',()=>{
  // Walking speed 1.99 tiles/s, a reaction of .3 s and a .22 player radius (auditoria-inimigos-29-10 §2).
  const radius=Math.max(...ROSTER.filter(e=>e.role==='brutamontes').map(e=>enemyDef(e.id).radius));
  assert.ok(BRUTE_SLAM.delay/SIM_HZ*1.99>=BRUTE_SLAM.radius+radius+.22+.3,`${(BRUTE_SLAM.delay/SIM_HZ*1.99).toFixed(2)} tiles`);
  assert.ok(BRUTE_SLAM.cooldown>BRUTE_SLAM.delay+BRUTE_SLAM.recover,'never stomping back to back');
});

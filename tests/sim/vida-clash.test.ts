/**
 * NEW-20261024-ORQ-vida-inimigos-estilo-clash (etapa 3, option B): the enemies' hp is their role's (rules ROLE_HITS).
 *  - STARTER_HIT is the faca verde's damage (the arsenal's row, ARSENAL_DAMAGE included)
 *  - every body of a role (the nine and the pack entries) has the role's hp; only the boss keeps its own
 *  - at the ninhos run's start row, solo, a role takes exactly ROLE_HITS faca verde hits
 *  - no common enemy dies to one hit of the faca verde or the pistola verde, 1–6 players, every phase of the ninhos run
 *    (the warm start's row, the sleepers' row, rows 2..9), at NEST_PACE.hp, rounded like createEnemy
 *  - the horde trade-off: CLASH_BODIES < 1 and CLASH_XP > 1
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CLASH_BODIES,CLASH_XP,ENEMY_ROLES,ROLE_HITS,ROSTER,ROUNDS,STARTER_HIT,playerScale} from '../../src/rules/index.ts';
import {ENEMIES,enemyDef} from '../../src/sim/enemies/catalog.ts';
import {NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';
import {SLEEPER_ROUND} from '../../src/sim/assemble.ts';
import {NEW_WEAPONS} from '../../src/sim/weapons/arsenal.ts';

const verde=(id:string)=>{const w=NEW_WEAPONS.find(w=>w.id===id);assert.ok(w,id);return w.levels[0].damage;};
const nestRow=(row:number)=>ROUNDS[row-1].hpNinhos??ROUNDS[row-1].hpScale;
const commons=ROSTER.filter(e=>e.role!=='chefe');

test('STARTER_HIT is the faca verde', ()=>{
  assert.equal(verde('faca'),STARTER_HIT);
});

test('every body of a role has the role hp; the boss keeps its own', ()=>{
  for(const role of ENEMY_ROLES){
    if(role==='chefe')continue;
    const hps=new Set(ROSTER.filter(e=>e.role===role).map(e=>enemyDef(e.id).hp));
    assert.ok(hps.size<=1,`${role}: ${[...hps].join(', ')}`);
  }
  assert.equal(ENEMIES.chefe.hp,4000);
});

test('start of a ninhos run, solo: each role takes its ROLE_HITS of the faca verde', ()=>{
  const s=nestRow(NEST_PACE.warmRow)*playerScale(1).hp*NEST_PACE.hp;
  for(const e of commons){
    const hp=Math.max(1,Math.round(enemyDef(e.id).hp*s));
    assert.equal(Math.ceil(hp/STARTER_HIT),ROLE_HITS[e.role as keyof typeof ROLE_HITS],`${e.id} (${e.role}) ${hp} hp`);
  }
});

test('no common enemy dies to one faca verde or pistola verde hit, 1-6 players, every ninhos phase', ()=>{
  const hit=Math.max(verde('faca'),verde('pistola'));
  const rows=[NEST_PACE.warmRow,SLEEPER_ROUND,2,3,4,5,6,7,8,9];
  for(let n=1;n<=6;n++)for(const row of rows){
    const s=nestRow(row)*playerScale(n).hp*NEST_PACE.hp;
    for(const e of commons){
      const hp=Math.max(1,Math.round(enemyDef(e.id).hp*s));
      assert.ok(hp>hit,`${e.id} (${e.role}) ${n}p linha ${row}: ${hp} hp ≤ ${hit}`);
    }
  }
});

test('fewer, sturdier bodies pay more XP', ()=>{
  assert.ok(CLASH_BODIES[0]===1&&CLASH_BODIES[1]<1&&CLASH_XP>1);
});

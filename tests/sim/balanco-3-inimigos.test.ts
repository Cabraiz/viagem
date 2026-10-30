/**
 * NEW-20261029-ORQ-balanco-3-inimigos: the liberated cast's numbers (catalog.ts LIBERADO_TUNE).
 *  - the mendigo (the common enemy) has a tune, every tune is a liberated enemy, multipliers positive and finite
 *  - enemyDef applies the tune on top of the role's def: hp × tune.hp, contact damage × tune.damage (rounded, ≥ 1)
 *  - only numbers: speed, radius, behavior and xp stay the role's (the base kind × the role profile)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMIES,LIBERADO_TUNE,enemyDef,roleHp} from '../../src/sim/enemies/catalog.ts';
import {INIMIGOS_LIBERADOS} from '../../src/rules/inimigos-liberados.ts';
import {ROLE_PROFILES,rosterEntry} from '../../src/rules/index.ts';

test('the mendigo has a tune and every tune is a liberated enemy', () => {
  assert.ok(Object.hasOwn(LIBERADO_TUNE,'mendigo'));
  for(const kind of Object.keys(LIBERADO_TUNE))assert.ok(INIMIGOS_LIBERADOS.includes(kind),kind);
  for(const [kind,t] of Object.entries(LIBERADO_TUNE)){
    assert.ok(Number.isFinite(t.hp)&&t.hp>0,`${kind} hp`);
    assert.ok(Number.isFinite(t.damage)&&t.damage>0,`${kind} damage`);
  }
});

test('enemyDef applies the tune on top of the role def, and only to hp and damage', () => {
  for(const [kind,t] of Object.entries(LIBERADO_TUNE)){
    const entry=rosterEntry(kind)!,role=ROLE_PROFILES[entry.role],base=ENEMIES[role.base],def=enemyDef(kind);
    assert.equal(def.id,kind);
    assert.equal(def.hp,Math.round(roleHp(entry.role,base.hp)*t.hp),`${kind} hp`);
    assert.equal(def.damage,Math.max(1,Math.round(base.damage*role.damage*t.damage)),`${kind} damage`);
    assert.equal(def.behavior,role.behavior,`${kind} behavior`);
    assert.equal(def.xp,Math.max(1,Math.round(base.xp*role.xp)),`${kind} xp`);
  }
});

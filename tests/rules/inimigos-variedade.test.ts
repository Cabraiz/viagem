// Card inimigos-variedade (the user 25/10: "muitos inimigos repetidos e iguais"): the map's loose sleepers draw from
// the rotation's early fodder slots, so the art-only rotation gives them more entries (ART_SLOT_WIDEN); a role's
// entries share its numbers (each clone with its feel on top, speed × hp ≈ 1), so the mix changes and the threat does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/index.ts';
import {ART_SLOT_WIDEN,ENEMY_ART_IDS,ROSTER,ROTATION_SIZE,ROTATION_SLOTS,drawRotation,isRotation,rotationSize,roundRoster,slotPools} from '../../src/rules/index.ts';
import {enemyDef} from '../../src/sim/enemies/catalog.ts';
import {enemyFeel} from '../../src/rules/enemy-feel.ts';
import {setRosterOnlyLiberados} from '../../src/rules/enemy-rotation.ts';
// The hidden roster (D-040 mechanics); the liberated rotation (só 3 inimigos) is tests/rules/inimigos-liberados.test.ts.
setRosterOnlyLiberados(false);

const art=new Set(ENEMY_ART_IDS);
const artOf=(role:string)=>ROSTER.filter(e=>e.role===role&&art.has(e.id)).length;

test('art only: the early fodder slots take ART_SLOT_WIDEN entries (within their art), the rest keep ROTATION_SLOTS',()=>{
  const {slots}=slotPools();
  for(const p of slots){
    const wide=ART_SLOT_WIDEN[p.slot.role],have=artOf(p.slot.role);
    if(!p.only)continue;
    assert.equal(p.max,Math.min(wide?.max??p.slot.max,have),p.slot.role);
    assert.equal(p.min,Math.min(wide?.min??p.slot.min,p.max),p.slot.role);
  }
  // Today's art fills the widened slots.
  assert.ok(artOf('corredor')>=ART_SLOT_WIDEN.corredor!.max&&artOf('enxame')>=ART_SLOT_WIDEN.enxame!.max);
});

test('art only: every rotation has ≥ 3 corredores and ≥ 2 enxames, stays valid and within ROTATION_SIZE',()=>{
  for(let seed=1;seed<=200;seed++){
    const r=drawRotation(new Rng(seed));
    const c=r.roles.corredor?.length??0,e=r.roles.enxame?.length??0;
    assert.ok(c>=3&&c<=4,`seed ${seed}: ${c} corredores`);
    assert.ok(e>=2&&e<=3,`seed ${seed}: ${e} enxames`);
    assert.ok(isRotation(r),`seed ${seed}: valid`);
    assert.ok(rotationSize(r)<=ROTATION_SIZE.max,`seed ${seed}: size ${rotationSize(r)}`);
    // The early band (the map's loose sleepers, assemble.ts SLEEPER_ROSTER.solto = round 2) has ≥ 5 kinds.
    const early=Object.values(roundRoster(r,2).roles).flat().length;
    assert.ok(early>=5,`seed ${seed}: ${early} early kinds`);
  }
});

test('a stored rotation past the widened max is refused; the whole roster keeps ROTATION_SLOTS',()=>{
  const r=drawRotation(new Rng(7));
  const corredores=ROSTER.filter(e=>e.role==='corredor'&&art.has(e.id)).map(e=>e.id).slice(0,ART_SLOT_WIDEN.corredor!.max+1);
  assert.equal(isRotation({...r,roles:{...r.roles,corredor:corredores}}),false);
  const slot=ROTATION_SLOTS.find(s=>s.role==='corredor')!;
  const full=drawRotation(new Rng(7),{onlyWithArt:false});
  assert.ok((full.roles.corredor?.length??0)<=slot.max);
});

test('same role, same numbers: swapping the entry inside a role changes only its feel (29/10 H)',()=>{
  // Without its feel (rules/enemy-feel.ts) every entry of a role has the role's numbers; the feel's speed × hp ≈ 1.
  const bare=(id:string)=>{const d=enemyDef(id),f=enemyFeel(id)??{hp:1,speed:1};return {hp:d.hp/f.hp,speed:d.speed/f.speed,d};};
  for(const role of Object.keys(ART_SLOT_WIDEN)){
    const ids=ROSTER.filter(e=>e.role===role&&art.has(e.id)&&!e.legacy).map(e=>e.id);
    const first=bare(ids[0]);
    for(const id of ids){
      const b=bare(id);
      assert.ok(Math.abs(b.hp-first.hp)<=1.5,`${id} hp ${b.hp} vs ${first.hp}`);
      assert.ok(Math.abs(b.speed-first.speed)<1e-9,`${id} speed`);
      assert.deepEqual([b.d.damage,b.d.xp,b.d.behavior],[first.d.damage,first.d.xp,first.d.behavior],id);
      const f=enemyFeel(id);
      if(f)assert.ok(Math.abs(f.speed*f.hp-1)<=.05,`${id} speed × hp`);
    }
  }
});

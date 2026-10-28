// NEW-20261028-ORQ-elenco-de-8 (the user 28/10: "vamos reduzir para ter atualmente 8 inimigos, depois expandimos"):
// with ELENCO_8 (on by default) every run's rotation is the eight hand-tuned kinds, one per role, no mini-chefe, and the
// chefão is always ELENCO_8_CHEFAO; the pack entries stay in the roster, and the flag off brings back the drawn cast.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/index.ts';
import {ELENCO_8,ELENCO_8_CHEFAO,ELENCO_8_ROLES,ENEMY_ART_IDS,LEGACY_ROLE,ROSTER,ROTATION_SIZE,drawRotation,elenco8Rotation,isRotation,pickWaveBoss,
  planRound,playsElenco8,rotationIds,roundRoster,waveBossById,type RoundTheme} from '../../src/rules/index.ts';
import {enemyDef} from '../../src/sim/enemies/catalog.ts';

const EIGHT=['bebado','anao-molotov','pombos','tio-pave','agiota','coach','motoboy','influencer'];

test('on by default: every seed draws the same eight, one per role, no mini-chefe; each has art',()=>{
  assert.equal(ELENCO_8,true);assert.ok(playsElenco8());
  for(let s=0;s<100;s++){
    const r=drawRotation(new Rng(s*7919+1));
    assert.deepEqual(r,elenco8Rotation());
    assert.deepEqual([...rotationIds(r)].sort(),[...EIGHT].sort());
    assert.deepEqual(r.mini,[]);
    for(const [role,ids] of Object.entries(r.roles))assert.deepEqual(ids,[ELENCO_8_ROLES[role as keyof typeof ELENCO_8_ROLES]]);
  }
  for(const id of EIGHT){assert.ok(ENEMY_ART_IDS.includes(id),`${id} has art`);assert.equal(ELENCO_8_ROLES[LEGACY_ROLE[id as keyof typeof LEGACY_ROLE]],id);}
  assert.deepEqual(Object.keys(ELENCO_8_ROLES).sort(),['arremessador','atirador','corredor','enxame','kamikaze','palhaco','refletor','suporte']);
});

test('isRotation: only the eight\'s rotation while on (an older checkpoint is drawn again); off, the art-only draw as before',()=>{
  const eight=elenco8Rotation();
  assert.ok(isRotation(eight));assert.ok(isRotation(JSON.parse(JSON.stringify(eight))),'JSON round-trip (checkpoint)');
  const drawn=drawRotation(new Rng(5),{elenco8:false});
  assert.ok(rotationIds(drawn).length>=ROTATION_SIZE.min-2);
  assert.equal(isRotation(drawn),false,'a 12-18 cast is refused with the eight on');
  assert.ok(isRotation(drawn,{elenco8:false}));
  assert.equal(isRotation(eight,{elenco8:false}),false,'the eight is not a valid drawn rotation (no mini-chefes)');
  assert.equal(isRotation({roles:{...eight.roles,corredor:['ressaca-ambulante']},mini:[]}),false);
});

test('the whole roster (onlyWithArt false: the rotation\'s design, the deterministic run tests) ignores the flag',()=>{
  assert.equal(playsElenco8({onlyWithArt:false}),false);
  assert.ok(rotationIds(drawRotation(new Rng(9),{onlyWithArt:false})).length>=ROTATION_SIZE.min);
});

test('every round plans from the eight only: their numbers are the hand-tuned ones, round 5 keeps the table\'s elite, no lone mini in round 8',()=>{
  const theme:RoundTheme={name:'t'},rotation=elenco8Rotation();
  for(let round=1;round<=9;round++){
    const plan=planRound(round,1,theme,new Rng(round*31),roundRoster(rotation,round));
    for(const g of plan.groups)for(const id of g.members)assert.ok(EIGHT.includes(id),`round ${round}: ${id}`);
    assert.ok(!plan.groups.some(g=>g.solo),`round ${round}: no lone mini-chefe`);
    if(round===5)assert.deepEqual(plan.groups.filter(g=>g.elite).map(g=>g.members[0]),['tio-pave']);
  }
  // A role's bodies are its base kind's numbers: what an entry of the role would have had (catalog.ts rosterDef).
  for(const id of EIGHT){const d=enemyDef(id);assert.equal(d.id,id);assert.ok(d.hp>0&&d.speed>0);}
  assert.ok(ROSTER.length>EIGHT.length+1,'the pack entries stay in the roster');
});

test('the chefão: always ELENCO_8_CHEFAO, one of the four wave bosses',()=>{
  assert.ok(waveBossById(ELENCO_8_CHEFAO));
  assert.equal(new Set(Array.from({length:50},(_,s)=>pickWaveBoss(s).id)).size,1);
  assert.equal(pickWaveBoss(123).id,ELENCO_8_CHEFAO);
});

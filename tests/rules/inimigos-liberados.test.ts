// NEW-20261029-ORQ-so-3-inimigos (the user's request): "o jogo terá só o saci e o mendigo e o arrasta-pé". One list
// (rules/inimigos-liberados.ts) says who plays; the rotation draws only from it (ROSTER_ONLY_LIBERADOS) and the rest of
// the roster stays, hidden. The chefões are untouched (round 8's solo mini-chefe and round 10's chefe).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/index.ts';
import {ELITE_ONLY,INIMIGOS_LIBERADOS,INIMIGO_PADRAO,ROSTER,ROSTER_ONLY_LIBERADOS,drawRotation,inimigoLiberadoId,isInimigoLiberado,
  isRotation,liberadosDoPapel,planRound,roleOf,roundRoster} from '../../src/rules/index.ts';
import {ENEMIES,enemyDef} from '../../src/sim/enemies/catalog.ts';

const SEEDS=Array.from({length:120},(_,i)=>i*7919+3);

test('the list: the mendigo (common) and the saci (the chefão, card saci-chefe-2x), in the roster, the mendigo the default',()=>{
  assert.deepEqual([...INIMIGOS_LIBERADOS],['mendigo','aberracao-saci']);
  assert.ok(Object.isFrozen(INIMIGOS_LIBERADOS));
  assert.equal(INIMIGO_PADRAO,'mendigo');
  for(const id of INIMIGOS_LIBERADOS)assert.ok(ROSTER.some(e=>e.id===id),`${id} is in the roster`);
  assert.equal(roleOf('mendigo'),'corredor');assert.equal(roleOf('aberracao-saci'),'chefe');
  assert.deepEqual([...ELITE_ONLY],[],'no elite: the saci is the chefão (rules/chefao-onda.ts SACI_BOSS)');
  assert.deepEqual(liberadosDoPapel('corredor'),['mendigo']);assert.deepEqual(liberadosDoPapel('atirador'),[]);
  assert.equal(ROSTER_ONLY_LIBERADOS,true,'the game draws only the liberated ones');
});

test('the mendigo plays at the bêbado\'s numbers (melee, stagger)',()=>{
  const m=enemyDef('mendigo'),b=ENEMIES.bebado;
  assert.equal(m.id,'mendigo');assert.equal(m.behavior,'stagger');
  for(const k of ['hp','speed','damage','radius','xp','contactCooldown'] as const)assert.equal(m[k],b[k],k);
});

test('a hidden or unknown enemy falls back to the mendigo, without error (?inimigo=)',()=>{
  for(const id of ['bebado','pombo-rei','chefe','não-existe','',undefined,null,42])assert.equal(inimigoLiberadoId(id),'mendigo',String(id));
  for(const id of INIMIGOS_LIBERADOS){assert.equal(inimigoLiberadoId(id),id);assert.ok(isInimigoLiberado(id));}
  assert.ok(!isInimigoLiberado('bebado'));
});

test('the rotation: only the mendigo in the role slots, the saci never drawn (he is the chefão), legacy role ids refused',()=>{
  for(const s of SEEDS){
    const r=drawRotation(new Rng(s));
    assert.deepEqual(r.roles,{corredor:['mendigo']},`seed ${s}`);
    assert.ok(!r.mini.includes('aberracao-saci'),`seed ${s}: the saci is no rotation mini-chefe`);
    assert.ok(isRotation(r),`seed ${s}: valid`);
    assert.deepEqual(drawRotation(new Rng(s)),r,'deterministic');
  }
  const r=drawRotation(new Rng(1));
  assert.ok(!isRotation({...r,roles:{corredor:['bebado']}}),'a legacy corredor is refused');
  assert.ok(!isRotation({...r,roles:{...r.roles,atirador:['agiota']}}),'a hidden role is refused');
});

test('the rounds: rounds 1-9 spawn only the mendigo, no elite (round 8\'s solo mini-chefe and round 10\'s chefe untouched)',()=>{
  const lib=new Set(INIMIGOS_LIBERADOS);
  for(const s of SEEDS.slice(0,30)){
    const r=drawRotation(new Rng(s));
    for(let round=1;round<=10;round++)for(const players of [1,3,6]){
      const plan=planRound(round,players,{name:'x'},new Rng(s+round),roundRoster(r,round));
      for(const g of plan.groups){
        if(g.boss){assert.equal(round,10);continue;}
        if(g.solo){assert.equal(round,8);continue;}
        for(const k of g.members)assert.ok(lib.has(k),`seed ${s} round ${round}: ${k}`);
      }
      assert.ok(plan.groups.some(g=>!g.boss&&!g.solo&&!g.elite&&g.members.includes('mendigo'))||round===10,`round ${round}: a mendigo horde`);
      assert.equal(plan.groups.filter(g=>g.elite).length,0);
    }
  }
});

// NEW-20261029-ORQ-so-3-inimigos (the user's request): "o jogo terá só o saci e o mendigo e o arrasta-pé". One list
// (rules/inimigos-liberados.ts) says who plays; the rotation draws only from it (ROSTER_ONLY_LIBERADOS) and the rest of
// the roster stays, hidden. The chefões are untouched (round 8's solo mini-chefe and round 10's chefe).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/index.ts';
import {ELITE_ONLY,HELD_ROSTER,INIMIGOS_LIBERADOS,INIMIGO_PADRAO,pesosDoPapel,tetoVivo,vivosNaRodada,ROSTER,ROSTER_ONLY_LIBERADOS,drawRotation,inimigoLiberadoId,isInimigoLiberado,
  isRotation,liberadosDoPapel,planRound,roleOf,roundRoster,SANFONEIRO_TETO} from '../../src/rules/index.ts';
import {ENEMIES,enemyDef} from '../../src/sim/enemies/catalog.ts';

const SEEDS=Array.from({length:120},(_,i)=>i*7919+3);

// NEW-20261030-ORQ-sanfoneiro-brinquedo-no-jogo: the sanfoneiro (his toy art) is liberated and in ROSTER, a common enemy
// (role corredor) next to the mendigo.
test('the list: the mendigo and the sanfoneiro (common), the saci (the chefão, card saci-chefe-2x), in the roster, the mendigo the default',()=>{
  assert.deepEqual([...INIMIGOS_LIBERADOS],['mendigo','aberracao-saci','sanfoneiro']);
  assert.ok(Object.isFrozen(INIMIGOS_LIBERADOS));
  assert.equal(INIMIGO_PADRAO,'mendigo');
  for(const id of INIMIGOS_LIBERADOS)assert.ok(ROSTER.some(e=>e.id===id),`${id} is in the roster`);
  assert.equal(roleOf('mendigo'),'corredor');assert.equal(roleOf('aberracao-saci'),'chefe');
  assert.equal(roleOf('sanfoneiro'),'corredor');
  assert.deepEqual([...ELITE_ONLY],[],'no elite: the saci is the chefão (rules/chefao-onda.ts SACI_BOSS)');
  assert.deepEqual(liberadosDoPapel('corredor'),['mendigo','sanfoneiro']);assert.deepEqual(liberadosDoPapel('atirador'),[]);
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

test('the rotation: only the mendigo and the sanfoneiro in the role slots, the saci never drawn (he is the chefão), legacy role ids refused',()=>{
  for(const s of SEEDS){
    const r=drawRotation(new Rng(s));
    assert.deepEqual(Object.keys(r.roles),['corredor'],`seed ${s}`);
    assert.deepEqual([...r.roles.corredor!].sort(),['mendigo','sanfoneiro'],`seed ${s}`);
    assert.ok(!r.mini.includes('aberracao-saci'),`seed ${s}: the saci is no rotation mini-chefe`);
    assert.ok(isRotation(r),`seed ${s}: valid`);
    assert.deepEqual(drawRotation(new Rng(s)),r,'deterministic');
  }
  const r=drawRotation(new Rng(1));
  assert.ok(!isRotation({...r,roles:{corredor:['bebado']}}),'a legacy corredor is refused');
  assert.ok(!isRotation({...r,roles:{...r.roles,atirador:['agiota']}}),'a hidden role is refused');
});

test('the rounds: rounds 1-9 spawn only the mendigo and the sanfoneiro, no elite (round 8\'s solo mini-chefe and round 10\'s chefe untouched)',()=>{
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
      assert.ok(plan.groups.some(g=>!g.boss&&!g.solo&&!g.elite&&g.members.length>0)||round===10,`round ${round}: a horde`);
      assert.equal(plan.groups.filter(g=>g.elite).length,0);
    }
  }
});

// ORQ 31/10 (card sanfoneiro-brinquedo-no-jogo): none in round 1, then at most a quarter of the round's corredores.
test('SANFONEIRO_TETO in the plans: none before fromRound, then at most share × the corredores, and he still comes',()=>{
  assert.deepEqual({...SANFONEIRO_TETO},{id:'sanfoneiro',fromRound:3,share:.25,alive:2,aliveEarly:1,earlyUntil:3});
  let seen=0;
  for(const s of SEEDS.slice(0,40)){
    const r=drawRotation(new Rng(s));
    for(let round=1;round<=10;round++)for(const players of [1,3,6]){
      const plan=planRound(round,players,{name:'x'},new Rng(s+round),roundRoster(r,round));
      const regular=plan.groups.filter(g=>!g.boss&&!g.solo&&!g.elite).flatMap(g=>g.members);
      const sanf=regular.filter(k=>k===SANFONEIRO_TETO.id).length,corredores=regular.filter(k=>roleOf(k)==='corredor').length;
      if(round<SANFONEIRO_TETO.fromRound)assert.equal(sanf,0,`seed ${s}: round ${round}`);
      else assert.ok(sanf<=Math.floor(SANFONEIRO_TETO.share*corredores),`seed ${s} round ${round} (${players}p): ${sanf} of ${corredores}`);
      seen+=sanf;
    }
  }
  assert.ok(seen>0,'he is drawn from fromRound');
});

// Mode ninhos (sim/assemble.ts sleeperKinds, sim/ninhos/ninhos.ts pickKinds and its createEnemy): the same ceiling.
test('SANFONEIRO_TETO in the nests: pesosDoPapel gives him none before fromRound, then at most share of the role; tetoVivo caps the standing',()=>{
  const {id,fromRound,share,alive,earlyUntil}=SANFONEIRO_TETO;
  assert.deepEqual(pesosDoPapel(['mendigo',id],2,fromRound-1),[['mendigo',2]]);
  const w=pesosDoPapel(['mendigo',id],2,fromRound),mine=w.find(([k])=>k===id)![1];
  assert.ok(Math.abs(mine-share*2)<1e-9,'share × the role weight');
  assert.ok(Math.abs(w.reduce((t,[,x])=>t+x,0)-2)<1e-9,'the role keeps its weight');
  assert.deepEqual(pesosDoPapel(['mendigo'],2,5),[['mendigo',2]]);
  const up=(n:number)=>Array.from({length:n},()=>({kind:id,hp:10}));
  const late=earlyUntil+1;
  assert.equal(tetoVivo(id,up(alive-1),late),id);
  assert.equal(tetoVivo(id,up(alive),late),INIMIGO_PADRAO);
  assert.equal(tetoVivo(id,[...up(alive)].map(e=>({...e,hp:0})),late),id,'the dead do not count');
  assert.equal(tetoVivo('mendigo',up(9),late),'mendigo');
});

test('SANFONEIRO_TETO per round: 1 standing through round 3, 2 from round 4 (ORQ 31/10)',()=>{
  const {id,aliveEarly,earlyUntil,alive}=SANFONEIRO_TETO;
  assert.deepEqual([aliveEarly,earlyUntil,alive],[1,3,2]);
  assert.deepEqual([2,3,4,9].map(vivosNaRodada),[1,1,2,2]);
  const one=[{kind:id,hp:10}];
  assert.equal(tetoVivo(id,[],2),id);
  assert.equal(tetoVivo(id,one,3),INIMIGO_PADRAO);
  assert.equal(tetoVivo(id,one,4),id);
});

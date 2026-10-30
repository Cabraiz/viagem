// NEW-20261029-ORQ-modificadores-so-elenco-ativo: a round modifier that names a hidden enemy (Revoada de Pombos, Rodada
// do Pavê...) is out of the draw, since that enemy no longer spawns. Kept in MODIFIERS as legacy, like the hidden heroes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/index.ts';
import {INIMIGOS_LIBERADOS,MODIFIERS,MODIFIERS_SORTEAVEIS,MODIFIER_FROM_ROUND,ROUND_COUNT,drawTheme,isModifierLegado,modifierKinds,
  modifierLabel} from '../../src/rules/index.ts';

const LEGADO=['uncle-party','mosquito-swarm','lovesick-slimes','taxman-day-off','audit-day','uncle-hug','bug-spray'];
/** Words that name a hidden enemy on screen. */
const ESCONDIDO=/\b(pombos?|tio|pavê|bêbados?|agiota|cobrança|anão|molotov|coach|motoboy|influencer|síndico)\b/i;

test('the seven modifiers of hidden enemies are legacy: kept, out of the draw',()=>{
  assert.deepEqual(MODIFIERS.filter(isModifierLegado).map(m=>m.id),LEGADO);
  for(const id of LEGADO){
    assert.ok(MODIFIERS.some(m=>m.id===id),`${id} is kept`);
    assert.ok(!MODIFIERS_SORTEAVEIS.some(m=>m.id===id),`${id} is not drawn`);
  }
  for(const m of MODIFIERS_SORTEAVEIS)assert.ok(modifierKinds(m).every(k=>INIMIGOS_LIBERADOS.includes(k)),`${m.id} only names liberated enemies`);
  for(let round=MODIFIER_FROM_ROUND;round<ROUND_COUNT;round++)
    assert.ok(MODIFIERS_SORTEAVEIS.some(m=>!m.banRounds.includes(round)),`round ${round} has a modifier to draw`);
});

test('1000 runs with the active cast: no drawn modifier names or needs a hidden enemy',()=>{
  const seen=new Set<string>();
  for(let run=0;run<1000;run++){
    const rng=new Rng(run*7919+11),used:string[]=[];
    for(let round=1;round<=ROUND_COUNT;round++){
      const theme=drawTheme(round,rng,used);
      used.push(theme.name);if(!theme.modifierId)continue;
      used.push(theme.modifierId);seen.add(theme.modifierId);
      const mod=MODIFIERS.find(m=>m.id===theme.modifierId)!;
      assert.ok(!isModifierLegado(mod),`run ${run} round ${round}: ${mod.id} names a hidden enemy`);
      assert.doesNotMatch(theme.modifierLabel!,ESCONDIDO,`run ${run} round ${round}: "${theme.modifierLabel}"`);
    }
  }
  assert.deepEqual([...seen].sort(),MODIFIERS_SORTEAVEIS.map(m=>m.id).sort(),'every drawable modifier still shows up');
  for(const m of MODIFIERS.filter(isModifierLegado))assert.ok(!seen.has(m.id),`${m.id} never drawn`);
  assert.ok(MODIFIERS_SORTEAVEIS.every(m=>!ESCONDIDO.test(modifierLabel(m))),'no drawable label cites a hidden enemy');
});

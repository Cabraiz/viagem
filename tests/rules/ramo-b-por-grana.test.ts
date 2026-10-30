import test from 'node:test';
import assert from 'node:assert/strict';
import {ticks} from '../../src/contract/index.ts';
import {DEFENSES,EVOLVE_PRICE,type DefenseId} from '../../src/rules/towers.ts';

// NEW-20261030-ORQ-ramo-b-e-6p-facil (auditoria-economia-29-10 item 10): DPS per R$ of the evolutions (the root left
// out), each impact counting the enemies its area reaches at ≈ 0.1 per u² (1 + 0.1·π·area²; 1 without area).
const DENSITY=.1;
const dps=(id:DefenseId)=>{const d=DEFENSES[id];return d.damage*d.shots*(1+DENSITY*Math.PI*d.area**2)/(d.cooldown/ticks(1));};
const paid=(tier:number)=>{let r=0;for(let t=2;t<=tier;t++)r+=EVOLVE_PRICE[t as 2|3|4|5];return r;};
const perReal=(id:DefenseId)=>dps(id)/paid(DEFENSES[id].tier);

test('branch B gives at least ~60 % of branch A per R$ from B3 to B5, never more',()=>{
  const pairs:[DefenseId,DefenseId][]=[['morteiro','atiradores-do-telhado'],['lanca-foguetes','ninho-de-metralhadora'],['obuseiro','guarnicao-do-predio']];
  for(const [b,a] of pairs){
    const share=perReal(b)/perReal(a);
    assert.ok(share>=.6&&share<=1,`${DEFENSES[b].label} ${perReal(b).toFixed(2)} vs ${DEFENSES[a].label} ${perReal(a).toFixed(2)} DPS/R$: ${(share*100).toFixed(0)} %`);
  }
});

test('each B evolution adds DPS (the B5 is worth its R$ over the B4)',()=>{
  const line:DefenseId[]=['rojao-de-festa','morteiro','lanca-foguetes','obuseiro'];
  for(let i=1;i<line.length;i++)assert.ok(dps(line[i])>dps(line[i-1]),`${DEFENSES[line[i]].label} > ${DEFENSES[line[i-1]].label}`);
  const marginal=(dps('obuseiro')-dps('lanca-foguetes'))/EVOLVE_PRICE[5];
  const marginalA=(dps('guarnicao-do-predio')-dps('ninho-de-metralhadora'))/EVOLVE_PRICE[5];
  assert.ok(marginal>=.6*marginalA,`B5 marginal ${marginal.toFixed(2)} vs A5 ${marginalA.toFixed(2)} DPS/R$`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NEAR,range,summarize,type BenchOut,type BodyOut} from '../../scripts/bench-inimigos.ts';

const body=(over:Partial<BodyOut>):BodyOut=>({kind:'rato',role:'enxame',elite:false,boss:false,wave:0,spawn:0,maxHp:10,speed:3,damage:2,
  minHero:1,minCar:5,heroDmg:4,carUnits:0,downs:0,life:10,engaged:5,killed:true,...over});

const fixture:BenchOut={root:'x',seeds:[1,2],players:[1],minutes:20,runs:[
  {seed:1,players:1,outcome:'won/chaveiro',min:12,carUnattributed:0,other:{poça:7},downsBy:{},telegraphs:[
    {owner:'BOSS:prefeito',kind:'',hazard:'onda',shape:'circle',radius:4,delay:1.5,damage:20,fire:100,hit:1}],
    bodies:[body({}),body({minHero:NEAR+5,minCar:NEAR+5}),body({kind:'prefeito',role:'chefe',boss:true,wave:-1,maxHp:400,heroDmg:80,downs:1})]},
  {seed:2,players:1,outcome:'lost/downed',min:8,carUnattributed:3,other:{},downsBy:{queda:1},telegraphs:[],
    bodies:[body({wave:1,killed:false,life:null,engaged:null}),body({kind:'cão',role:'corredor',wave:-1,elite:true})]},
]};

test('range: lists and spans',()=>{
  assert.deepEqual(range('1-4,7'),[1,2,3,4,7]);
  assert.deepEqual(range('1,3,6'),[1,3,6]);
});
test('summarize: runs, roles per player count, waves, map, kinds and telegraphs',()=>{
  const md=summarize(fixture);
  assert.match(md,/^# Bench inimigos: 2 seeds × 1p/);
  assert.match(md,/\| s2 1p \| lost\/downed \| 8 \| 2 \| 3 \|/);
  // enxame: 3 bodies in 2 runs, 2 of 3 killed, 1 of the 2 killed died far, 4 hero damage each.
  assert.match(md,/\| enxame \| 1\.5 \| 1 \| 10 \| 67% \| 50% \| 4 \| 0 \| 0 \| 40 \| 10 \| 5 \|/);
  assert.match(md,/\| chefe CHEFÃO \| 0\.5 \| 1 \| 400 \|/);
  assert.match(md,/\| corredor elite \|/);
  assert.match(md,/Dano sem corpo \(perigos de quem já morreu\): poça 7/);
  assert.match(md,/Quedas sem corpo: queda 1/);
  assert.match(md,/\| 1 \| 1 \| 2 \| enxame 2 \| 100% enxame \|/,'wave 1: run 1 only');
  assert.match(md,/\| 2 \| 1 \| 1 \| enxame 1 \|/,'wave 2: run 2 only');
  assert.match(md,/Mapa \(dormentes\/fora de onda\): corredor 0\.5 \(total 0\.5\/run\)/,'the boss is not on the map');
  assert.match(md,/\| rato \| enxame \| 3 \| 2 \|/);
  assert.match(md,/\| BOSS:prefeito \| onda \| circle \| 1 \| 1\.5 \| 4 \| 20 \| 100% \|/);
});
test('bench-ttk counts the real down event',()=>{
  const src=readFileSync('scripts/bench-ttk.ts','utf8');
  assert.match(src,/e\.type==='downed'\)m\.downs\+\+/);
  assert.doesNotMatch(src,/e\.type==='down'\)/);
  assert.match(readFileSync('src/contract/types.ts','utf8'),/type:'downed'/);
});

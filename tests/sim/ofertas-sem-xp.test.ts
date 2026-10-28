import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import {BASE_STATS} from '../../src/contract/types.ts';
import type {EnemyState,SimEvent,SimPlayer,SpatialIndex,TeamProgress,RoundState} from '../../src/contract/types.ts';
import type {SimContext} from '../../src/sim/context.ts';
import {createTeamProgress} from '../../src/sim/progression.ts';
import {OPEN_SECONDS,createCrates} from '../../src/sim/crates.ts';
import {walletOf} from '../../src/sim/wallet.ts';
import {CARTAO_CASHBACK,PASSIVES,PASSIVE_IDS,PASSIVE_MAX_LEVEL,cartaoCashback,computeStats} from '../../src/rules/index.ts';
import {ticks} from '../../src/contract/index.ts';
import {offerGain,offerValue} from '../../src/client/hud/offer-card.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';

// Card ofertas-sem-xp-e-icones (the user, 25/10): "Troque o ganho de XP por outra coisa, já que o XP não é mostrado."
// No level card moves the XP any more; the Cartão Fidelidade pays Grana per crate opened (CARTAO_CASHBACK a level).

type Mutable<T>={-readonly [K in keyof T]:T[K]};
type FakeCtx=Mutable<SimContext>&{players:Map<string,SimPlayer>;events:SimEvent[];team:TeamProgress;round:RoundState};
function naiveIndex<T extends {x:number;y:number;id:string}>():SpatialIndex<T>{
  let items:T[]=[];
  return {rebuild(src){items=[...src];},query(x,y,r,out=[]){for(const i of items)if(Math.hypot(i.x-x,i.y-y)<=r)out.push(i);return out;},nearest:()=>undefined};
}
function makeCtx(seed=1):FakeCtx{
  const counters=new Map<string,number>(),events:SimEvent[]=[];
  return {
    tick:0,runStartTick:0,terrain:{} as never,rng:new Rng(seed),players:new Map(),enemies:new Map(),pickups:new Map(),projectiles:new Map(),
    telegraphs:new Map(),team:createTeamProgress(),offers:new Map(),round:{index:1,total:10,phase:'wave',phaseEndsTick:0,remaining:0},
    enemyIndex:naiveIndex<EnemyState>(),
    nextId:(prefix:string)=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`;},
    emit:(e:SimEvent)=>{events.push(e);},damageEnemy:()=>false,damagePlayer:()=>{},events,
  };
}
function addPlayer(ctx:FakeCtx,id:string,cartao:number):SimPlayer{
  const p:SimPlayer={id,classId:'turista',x:0,y:0,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[{id:'faca',level:1}],passives:cartao?[{id:'cartao',level:cartao}]:[],hand:0},stats:{...BASE_STATS},weaponReady:{}};
  ctx.players.set(id,p);
  return p;
}
/** Grana in the wallet of a hero with the cartão at `level` after opening one verde crate. */
function openOne(level:number){
  const ctx=makeCtx(),crates=createCrates({seed:5,points:[]}),p=addPlayer(ctx,'a',level);
  crates.dropCrate(ctx,{x:0,y:0},1);
  for(let i=0;i<ticks(OPEN_SECONDS[0])+3;i++){crates.step(ctx);ctx.tick++;}
  assert.equal(ctx.events.filter(e=>e.type==='pickup'&&e.kind==='chest').length,1,'the crate opened');
  return walletOf(p);
}

test('no level card moves the XP: no passive has growth, nor says XP in its text, gain or value line',()=>{
  for(const id of PASSIVE_IDS){
    const def=PASSIVES[id];
    assert.equal(def.perLevel.growth,undefined,`${id}: no growth`);
    for(let l=1;l<=def.maxLevel;l++){
      assert.doesNotMatch(def.describe(l),/\bXP\b/,`${id} ${l}: describe`);
      assert.doesNotMatch(offerGain(id,l)??'',/\bXP\b/,`${id} ${l}: gain`);
      assert.doesNotMatch(offerValue(id,l)?.label??'',/\bXP\b/,`${id} ${l}: value`);
    }
    assert.doesNotMatch(`${itemDisplay(id).blurb} ${itemDisplay(id).joke}`,/\bXP\b/,`${id}: blurb`);
    assert.equal(computeStats({weapons:[],passives:[{id,level:def.maxLevel}]}).growth,BASE_STATS.growth,`${id}: XP untouched`);
  }
});

test('Cartão Fidelidade: each crate opened pays CARTAO_CASHBACK × level into the opener\'s wallet; without it, nothing',()=>{
  assert.equal(CARTAO_CASHBACK,3);
  assert.equal(openOne(0),0);
  for(let l=1;l<=PASSIVE_MAX_LEVEL;l++)assert.equal(openOne(l),cartaoCashback(l),`level ${l}`);
  assert.equal(cartaoCashback(5),15);
  assert.equal(offerGain('cartao',1),'+R$ 3 por caixa');
  assert.equal(offerGain('cartao',4),'+R$ 3 por caixa');
  assert.match(PASSIVES.cartao.describe(2),/^Cada caixa aberta: \+R\$ 6\. /);
  assert.equal(itemDisplay('cartao').blurb,'Cada caixa aberta dá grana.');
});

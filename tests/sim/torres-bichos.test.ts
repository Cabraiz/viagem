/**
 * Card NEW-20261031-ORQ-torres-3-base-9-evolucoes-regras (the user, 31/10): 3 initial towers, 9 evolutions, the same
 * damage for all, a força that climbs for R$, at most 12 towers per team.
 *  1. The 12 bichos: 3 initials (from null) with 3 children each; the same effectiveDps (TOWER_DPS_BASE) for all.
 *  2. The kits: only the 3 initials in every pool and every crate path; the 9 evolutions are never a kit.
 *  3. Força: pays levelPrice from the wallet, climbs at once, damage and life follow; max at TOWER_LEVEL_MAX.
 *     Evolve: an initial into one of its 3, BICHO_EVOLVE_PRICE, keeps the força; an evolution evolves no further.
 *  4. The teto: builtFull at TOWER_BUILT_LIMIT; kitsFull counts the kits in the bags too.
 *  5. The bots (towers/bichos/bots.ts): repair, evolve, força, save; never a person's bicho.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,type SimPlayer} from '../../src/contract/types.ts';
import {Rng} from '../../src/contract/rng.ts';
import {BICHO_EVOLVE_PRICE,BICHO_ROOTS,DEFENSES,FORCA_BRANCH,KIT_IDS,KIT_POOL,TOWER_BUILT_LIMIT,TOWER_DPS_BASE,TOWER_LEVEL_MAX,TOWERS_SHOWN,
  childrenOf,effectiveDps,isBicho,isKitId,isTowerKit,kitId,kitPiece,levelDamage,levelHp,levelPrice,type DefenseId} from '../../src/rules/index.ts';
import {drawPrize,otherPrize,rollCrate,rollPrize,rollStarter} from '../../src/sim/crates.ts';
import {bichoUpgrade,builtFull,kitsFull,leveled} from '../../src/sim/towers/bichos/forca.ts';
import {pickBichoOrder} from '../../src/sim/towers/bichos/bots.ts';
import type {DefenseState} from '../../src/sim/towers/system.ts';
import type {TowerBrainView} from '../../src/sim/bot-brain.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {StonewardsState} from '../../src/sim/stonewards/state.ts';

const ROOTS=['bicho-tiro','bicho-bomba','bicho-gosma'];

test('1. the 12: 3 initials with 3 evolutions each, all at the same damage', ()=>{
  assert.deepEqual([...BICHO_ROOTS].sort(),[...ROOTS].sort());
  assert.equal(TOWERS_SHOWN.length,12);
  for(const id of TOWERS_SHOWN)assert.ok(isBicho(id),id);
  for(const r of BICHO_ROOTS){
    const kids=childrenOf(r);
    assert.equal(kids.length,3,r);
    for(const k of kids){assert.ok(isBicho(k.id));assert.deepEqual(childrenOf(k.id),[],`${k.id} evolves no further`);}
  }
  for(const id of TOWERS_SHOWN)assert.ok(Math.abs(effectiveDps(DEFENSES[id as DefenseId])-TOWER_DPS_BASE)<1e-6,`${id}: ${effectiveDps(DEFENSES[id as DefenseId])}`);
});

test('2. only the 3 initials come as kits; the 9 evolutions never', ()=>{
  const ok=new Set([...ROOTS,'muro'].map(p=>kitId(p as never)));
  for(const r of [1,2,3,4,5] as const)for(const p of KIT_POOL[r])assert.ok(ok.has(kitId(p)),`${p} in pool ${r}`);
  for(const r of ROOTS)assert.ok(KIT_IDS.includes(kitId(r as never)),r);
  for(const id of TOWERS_SHOWN)assert.equal(isTowerKit(id as never),ROOTS.includes(id),id);
  const seen=new Set<string>();
  for(const r of [1,2,3,4,5] as const)for(let s=0;s<600;s++){
    const rng=()=>new Rng(s*11+r).fork('kits');
    for(const roll of [rollCrate(rng(),r),rollPrize(rng(),r),rollStarter(rng(),r),otherPrize(rng(),r,s%2===0,'pistola'),drawPrize(rng(),r,s%3===0)])
      for(const i of roll.items)if(isKitId(i.id)){seen.add(i.id);assert.ok(ok.has(i.id),i.id);}
  }
  for(const r of ROOTS)assert.ok(seen.has(kitId(r as never)),`${r} comes out of the crates`);
});

function player(id:string,grana:number,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x:0,y:0,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},grana,...extra} as SimPlayer;
}
function defense(kind:DefenseId,extra:Partial<DefenseState>={}):DefenseState{
  const def=DEFENSES[kind];
  return {id:'d-1',kind,site:'d:1',owner:'ana',x:0,y:0,hp:def.hp,maxHp:def.hp,startTick:0,readyTick:0,fireTick:0,...extra} as DefenseState;
}
const rect={x:-1,y:-1,w:2,h:2} as never;
const ctxOf=(p:SimPlayer)=>({tick:100,players:new Map([[p.id,p]])}) as unknown as SimContext;
const state={} as StonewardsState;

test('3. força: paid from the wallet, at once, damage and life follow; evolve keeps it', ()=>{
  const ana=player('ana',1000),ctx=ctxOf(ana),d=defense('bicho-tiro');
  const base=DEFENSES['bicho-tiro'];
  for(let level=1;level<TOWER_LEVEL_MAX;level++){
    const before=ana.grana!,price=levelPrice(level)!;
    const r=bichoUpgrade(ctx,state,'ana',d,FORCA_BRANCH,rect);
    assert.ok(r.ok,`força ${level}`);
    assert.equal(d.level,level+1);assert.equal(ana.grana,before-price);
    assert.equal(d.maxHp,Math.round(base.hp*levelHp(level+1)));
    assert.equal(leveled(d).damage,base.damage*levelDamage(level+1));
  }
  assert.deepEqual(bichoUpgrade(ctx,state,'ana',d,FORCA_BRANCH,rect),{ok:false,reason:'max'});
  // Evolve: keeps the força, pays BICHO_EVOLVE_PRICE, starts an obra.
  const before=ana.grana!,kid=childrenOf('bicho-tiro')[1]!;
  const r=bichoUpgrade(ctx,state,'ana',d,kid.id,rect);
  assert.ok(r.ok);assert.equal(d.kind,kid.id);assert.equal(d.level,TOWER_LEVEL_MAX);assert.equal(ana.grana,before-BICHO_EVOLVE_PRICE);
  assert.ok(d.readyTick>100);
  assert.equal(bichoUpgrade({...ctx,tick:d.readyTick} as SimContext,state,'ana',d,'A',rect).ok,false,'an evolution evolves no further');
  // No grana, no força.
  const bia=player('bia',5),e=defense('bicho-gosma');
  assert.deepEqual(bichoUpgrade(ctxOf(bia),state,'bia',e,FORCA_BRANCH,rect),{ok:false,reason:'grana'});
  assert.equal(e.level,undefined);
  assert.equal(leveled(e),DEFENSES['bicho-gosma'],'força 1: the catalog numbers, same object');
});

test('4. the teto: 12 built, or built + kits in the bags', ()=>{
  assert.equal(builtFull({list:[],built:TOWER_BUILT_LIMIT-1} as never),false);
  assert.equal(builtFull({list:[],built:TOWER_BUILT_LIMIT} as never),true);
  const bag=player('ana',0,{build:{weapons:[{id:kitId('bicho-bomba' as never),level:1},{id:'pistola',level:1}],passives:[]}});
  assert.equal(kitPiece(bag.build.weapons[0]!.id),'bicho-bomba');
  assert.equal(kitsFull({defenses:{list:[],built:TOWER_BUILT_LIMIT-2}} as never,[bag]),false);
  assert.equal(kitsFull({defenses:{list:[],built:TOWER_BUILT_LIMIT-1}} as never,[bag]),true);
});

test('5. the bots: repair, evolve, força, save; a person\'s bicho is theirs', ()=>{
  const d=(id:string,kind:DefenseId,extra:Partial<TowerBrainView['defenses'][number]>={})=>({id,kind,site:`d:${id}`,ready:true,ruined:false,hp:100,maxHp:100,...extra});
  const view=(defenses:TowerBrainView['defenses'],grana:number):TowerBrainView=>({tick:0,round:1,units:0,grana,sites:[],rail:null,railLaid:false,railReady:false,gustavoes:0,defenses});
  assert.deepEqual(pickBichoOrder(view([d('a','bicho-tiro',{hp:50})],100)),{repair:'a'});
  const evolve=pickBichoOrder(view([d('a','bicho-tiro')],BICHO_EVOLVE_PRICE));
  assert.ok(evolve&&evolve!=='save'&&'upgrade' in evolve&&childrenOf('bicho-tiro').some(k=>k.id===evolve.branch));
  assert.deepEqual(pickBichoOrder(view([d('a','bicho-rajada',{level:2}),d('b','bicho-mira')],levelPrice(1)!)),{upgrade:'b',branch:FORCA_BRANCH});
  assert.equal(pickBichoOrder(view([d('a','bicho-rajada')],0)),'save');
  assert.equal(pickBichoOrder(view([d('a','bicho-rajada',{person:true})],1000)),undefined);
  assert.equal(pickBichoOrder(view([],1000)),undefined);
});

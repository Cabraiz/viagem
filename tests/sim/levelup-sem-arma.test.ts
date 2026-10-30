/**
 * NEW-20261029-ORQ-levelup-sem-arma-e-solo #7: in the D-051 manual combat a hero with empty hands is never offered a
 * card that only changes the weapon in the hand (WEAPON_PASSIVE_IDS: reload, area, damage, projectiles); life, speed,
 * luck and the rest still come. Once a weapon is in the inventory every card can come back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/rng.ts';
import type {PlayerBuild} from '../../src/contract/types.ts';
import {HEAL_CHOICE,rollChoices} from '../../src/rules/offers.ts';
import {PASSIVE_IDS,WEAPON_PASSIVE_IDS,needsWeapon} from '../../src/rules/passives.ts';
import {MANUAL_ITEMS} from '../../src/sim/items.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

const EMPTY:PlayerBuild={weapons:[],passives:[]};

test('the weapon cards are real passives and the rest serve with empty hands',()=>{
  const ids=new Set<string>(PASSIVE_IDS);
  for(const id of WEAPON_PASSIVE_IDS)assert.ok(ids.has(id),id);
  assert.ok(PASSIVE_IDS.some(id=>!needsWeapon(id)),'some card is left for empty hands');
  for(const id of ['marmita','tenis'])assert.equal(needsWeapon(id),false,id);
});

test('rollChoices with the skip: never a weapon card over many seeds, every other card reachable',()=>{
  const seen=new Set<string>();
  for(let seed=1;seed<=400;seed++)for(const c of rollChoices(MANUAL_ITEMS,EMPTY,1+seed%4,new Rng(seed),needsWeapon)){
    assert.ok(!needsWeapon(c.itemId),`seed ${seed}: ${c.itemId}`);seen.add(c.itemId);
  }
  for(const id of PASSIVE_IDS)if(!needsWeapon(id))assert.ok(seen.has(id),`${id} never came`);
  // Without the skip (an armed hero) the weapon cards come.
  const armed=new Set<string>();
  for(let seed=1;seed<=400;seed++)for(const c of rollChoices(MANUAL_ITEMS,EMPTY,1,new Rng(seed)))armed.add(c.itemId);
  for(const id of WEAPON_PASSIVE_IDS)assert.ok(armed.has(id),`${id} never came to an armed hero`);
});

/** The run's progression (private in Simulation; the offers it rolls are the point here). */
const progression=(s:Simulation)=>(s as unknown as {systems:{progression:{grantLevelOffers(ctx:unknown,level:number):unknown;rerollOffer(ctx:unknown,id:string,offer:string):unknown}}}).systems.progression;

/** A solo manual run one tick in (the inventory system gives the empty-hands build on its first step). */
function manualRun(seed:number){const s=new Simulation(seed,{combat:'manual'});s.add('p','P','cidadao-comum');s.resetRun();s.step(50);return s;}

test('manual run: the unarmed hero\'s level and rerolled cards hold no weapon card; an armed one may get them',()=>{
  let unarmedCards=0,armedWeaponCards=0;
  for(let seed=1;seed<=40;seed++){
    const s=manualRun(seed);
    const hero=s.world.players.get('p')!;
    assert.equal(hero.build.weapons.length,0,'a manual run starts with empty hands');
    const prog=progression(s);
    prog.grantLevelOffers(s.world,2);
    const offer=s.offers('p')[0]!;
    prog.rerollOffer(s.world,'p',offer.id);
    for(const o of s.offers('p'))for(const c of o.choices){
      if(c.itemId===HEAL_CHOICE)continue;
      unarmedCards++;assert.ok(!needsWeapon(c.itemId),`seed ${seed}: ${c.itemId} offered with empty hands`);
    }
    // A weapon in the inventory: the next level may bring the weapon cards again.
    const armed=manualRun(seed);
    armed.world.players.get('p')!.build.weapons.push({id:'audio',level:1});
    progression(armed).grantLevelOffers(armed.world,2);
    for(const c of armed.offers('p')[0]!.choices)if(needsWeapon(c.itemId))armedWeaponCards++;
  }
  assert.ok(unarmedCards>40,'the run reaches real cards');
  assert.ok(armedWeaponCards>0,'an armed hero gets weapon cards');
});

test('auto combat: the heroes always hold weapons, the offers are unchanged',()=>{
  const s=new Simulation(3,{});s.add('p','P','cidadao-comum');s.resetRun();
  assert.ok(s.world.players.get('p')!.build.weapons.length>0);
});

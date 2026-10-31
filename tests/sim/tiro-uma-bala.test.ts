/**
 * NEW-20261031-ORQ-armas-reais-12 (the user: "o revólver solta 2 balas ao mesmo tempo"): with the attack held for N
 * ticks, the room makes one shot per cooldown and each shot makes `amount` projectiles (1 for every gun; the shotgun's
 * cone and the thrown weapons make none of their own), never two at once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {ARSENAL_WEAPONS} from '../../src/sim/weapons/arsenal.ts';
import {resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';

setRosterOnlyWithArt(false);
const HELD=200;

for(const id of ['pistola','submetralhadora','rifle','baladeira','espeto']){
  test(`${id} held ${HELD} ticks: one shot per cooldown, amount projectiles per shot`,()=>{
    const def=ARSENAL_WEAPONS.find(w=>w.id===id)!;
    const s=new Simulation(11,{combat:'manual'}),p=s.addBot('p','P','cidadao-comum');s.resetRun();
    s.step();p.build.weapons=[{id,level:def.minRarity}];p.build.hand=0;
    const w=resolveWeapon(def,def.minRarity,p.stats);
    const e=createEnemy(s.world,'bebado',{x:p.x+3,y:p.y});e.hp=e.maxHp=1e9;e.speed=0;
    const seen=new Set(s.world.projectiles.keys());
    const shots:number[]=[];let made=0;
    s.setBotInput('p',{x:0,y:0},false,true);
    for(let i=0;i<HELD;i++){
      s.step();
      let n=0;for(const [pid,pr] of s.world.projectiles)if(!seen.has(pid)){seen.add(pid);if(pr.owner==='p')n++;}
      const fired=s.events.filter(ev=>ev.type==='fire'&&ev.player==='p').length;
      if(fired){shots.push(i);assert.equal(fired,1,`${id}: one fire event per tick`);assert.equal(n,w.amount,`${id}: projectiles on tick ${i}`);}
      else assert.equal(n,0,`${id}: a projectile without a shot on tick ${i}`);
      made+=n;
    }
    assert.ok(shots.length>=2,`${id}: ${shots.length} shots`);
    const gap=shots[1]-shots[0];
    assert.ok(gap>=w.cooldownTicks,`${id}: gap ${gap} < cooldown ${w.cooldownTicks}`);
    assert.equal(shots.length,1+Math.floor((HELD-1-shots[0])/gap),`${id}: shots = cooldowns elapsed`);
    assert.equal(made,shots.length*w.amount,`${id}: projectiles = shots × amount`);
  });
}

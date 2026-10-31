import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnShots,ADOPT_MS,adoptFade} from '../../src/client/render/own-shots.ts';
import {MATCH_MS} from '../../src/client/net/attack-predict.ts';
import {SHOT_FLIGHT,heldFlight} from '../../src/client/hud/weapon-reach.ts';

const PISTOLA=[3.75,37] as const;

test('the flight table is the sim\'s travelling shots (speed u/s, flight ticks), every weapon and level',async()=>{
  const {BASE_STATS}=await import('../../src/contract/types.ts');
  const {WEAPON_CATALOG,resolveWeapon,travels}=await import('../../src/sim/weapons/catalog.ts');
  const seen:string[]=[];
  for(const def of WEAPON_CATALOG.values()){
    if(!def.pattern||!travels(def.pattern))continue;
    seen.push(def.id);
    for(let level=1;level<=def.maxLevel+1;level++){
      const w=resolveWeapon(def,Math.min(level,def.maxLevel),{...BASE_STATS});
      assert.deepEqual(heldFlight({id:def.id,level}),[w.speed,w.durationTicks],`${def.id} level ${level}`);
    }
  }
  assert.deepEqual(Object.keys(SHOT_FLIGHT).sort(),seen.sort());
  assert.equal(heldFlight({id:'faca',level:1}),undefined,'melee: no projectile to draw');
});

test('a press flies at once along the aim, at the weapon\'s speed, and stops at its reach',()=>{
  const o=new OwnShots();
  const g=o.spawn(1000,'pistola',2,3,10,0,PISTOLA)!;
  assert.ok(g);
  assert.deepEqual(o.at(g,1000),{x:2,y:3},'the press frame: at the hero');
  assert.ok(Math.abs(o.at(g,1100).x-(2+.375))<1e-9,'100 ms later: 0.375 u ahead');
  const end=o.at(g,99999).x-2;
  assert.ok(Math.abs(end-3.75*37/20)<1e-9,'the reach: speed × flight');
  assert.equal(o.spawn(1000,'pistola',0,0,0,0,PISTOLA),undefined,'no direction: nothing');
  assert.equal(o.spawn(1000,'faca',0,0,1,0,undefined),undefined,'melee: nothing');
});

test('the room\'s copy takes the ghost: the same shot (no second bullet), its gap fading, the speed learned',()=>{
  const o=new OwnShots();
  const g=o.spawn(1000,'pistola',0,0,1,0,PISTOLA)!;
  // 300 ms later the room's copy shows, a step behind and bent a little by the assist.
  const took=o.adopt('pistola',.2,.1,3.7,.4,1300);
  assert.equal(took,g);
  assert.equal(o.ghosts.length,0,'the ghost is gone: one bullet on screen');
  assert.equal(o.adopt('pistola',.2,.1,3.7,.4,1300),undefined,'a second copy is another shot');
  assert.equal(adoptFade(0),1);assert.ok(adoptFade(ADOPT_MS*4)<.02,'the gap is gone in a few frames');
  const next=o.spawn(2000,'pistola',0,0,1,0,PISTOLA)!;
  assert.ok(Math.abs(Math.hypot(next.vx,next.vy)-Math.hypot(3.7,.4))<1e-9,'the room\'s speed (a passive) is used');
  assert.ok(Math.abs(o.at(next,99999).x-3.75*37/20)<1e-6,'the same reach');
});

test('another weapon, a far shot or one heading away is not the ghost\'s copy',()=>{
  const o=new OwnShots();
  o.spawn(1000,'pistola',0,0,1,0,PISTOLA);
  assert.equal(o.adopt('rifle',0,0,6,0,1200),undefined);
  assert.equal(o.adopt('pistola',0,6,3.75,0,1200),undefined,'6 u off the line');
  assert.equal(o.adopt('pistola',0,0,-3.75,0,1200),undefined,'backwards');
  assert.equal(o.ghosts.length,1);
});

test('a shot the room refused (no copy within MATCH_MS) is gone; a held refire draws one ghost per shot',()=>{
  const o=new OwnShots(),gone:string[]=[];
  const g=o.spawn(1000,'pistola',0,0,1,0,PISTOLA)!;
  o.expire(1000+MATCH_MS,gone);
  assert.equal(o.ghosts.length,1,'still waiting');
  o.expire(1000+MATCH_MS+1,gone);
  assert.deepEqual(gone,[g.id]);assert.equal(o.ghosts.length,0);
  assert.equal(o.adopt('pistola',0,0,3.75,0,1000+MATCH_MS+2),undefined,'a copy after MATCH_MS is a new shot');
  for(let t=0;t<1000;t+=250)o.spawn(5000+t,'submetralhadora',0,0,1,0,[4.125,29]);
  assert.equal(o.ghosts.length,4);
  // The room's copies arrive in order: each takes its own ghost (the oldest is behind on the line).
  assert.equal(o.adopt('submetralhadora',.1,0,4.125,0,5400)?.born,5000);
  assert.equal(o.ghosts.length,3);
});

test('a ghost whose flight ends before the copy (the submachine gun\'s 1.45 s on a slow 4G) still owns the late copy',()=>{
  const o=new OwnShots(),gone:string[]=[];
  const g=o.spawn(1000,'submetralhadora',0,0,1,0,[4.125,29])!;
  o.expire(2450,gone);
  assert.deepEqual(gone,[g.id],'not drawn any more');
  assert.equal(o.ghosts[0]?.spent,true,'but kept for the copy');
  const took=o.adopt('submetralhadora',.1,0,4.125,0,2480);
  assert.equal(took,g);assert.equal(took?.spent,true,'the renderer hides that copy: no second bullet');
  gone.length=0;o.expire(9999,gone);assert.deepEqual(gone,[],'reported once');
});

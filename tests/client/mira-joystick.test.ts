// BUG-20261023-ORQ-tiro-na-direcao-mobile: the phone's aim stick over Atacar (hud/attack-button.ts). Its arrow runs as far
// as the server's manualReach, and its screen drag becomes the world aim the server fires along.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_STATS} from '../../src/contract/types.ts';
import {WEAPON_CATALOG,resolveWeapon} from '../../src/sim/weapons/catalog.ts';
import {manualReach} from '../../src/sim/weapons/system.ts';
import {WEAPON_REACH,heldReach,heldWeapon} from '../../src/client/hud/weapon-reach.ts';
import {rayEnd,worldDirection} from '../../src/client/hud/attack-aim.ts';

const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');

test('the arrow\'s length is the server\'s manualReach, for every weapon and level (base stats)',()=>{
  for(const def of WEAPON_CATALOG.values()){
    if(!def.pattern)continue;
    assert.ok(WEAPON_REACH[def.id],`${def.id} has a row`);
    for(let level=1;level<=def.maxLevel+1;level++){
      const want=manualReach(resolveWeapon(def,Math.min(level,def.maxLevel),{...BASE_STATS})).reach;
      const got=heldReach({weapons:[{id:def.id,level}]})!;
      assert.ok(Math.abs(got-want)<.006,`${def.id} level ${level}: ${got} vs ${want}`);
    }
  }
  for(const id of Object.keys(WEAPON_REACH))assert.ok(WEAPON_CATALOG.get(id)?.pattern,`${id} is a weapon`);
});

test('the held weapon: the hand\'s slot (a consumable there: none), else the first weapon',()=>{
  const weapons=[{id:'coxinha',level:1},{id:'pistola',level:2},{id:'faca',level:1}];
  assert.equal(heldWeapon({weapons,hand:2})?.id,'faca');
  assert.equal(heldWeapon({weapons,hand:0}),undefined);
  assert.equal(heldWeapon({weapons})?.id,'pistola');
  assert.equal(heldReach({weapons:[]}),undefined);
});

test('a screen drag becomes the world direction whose arrow points the same way on screen',()=>{
  // The game's 2:1 iso around a hero (any view: a rotated projection).
  for(const view of [0,1,2,3]){
    const c=Math.cos(view*Math.PI/2),s=Math.sin(view*Math.PI/2);
    const toScreen=(p:{x:number;y:number})=>{const x=p.x*c-p.y*s,y=p.x*s+p.y*c;return {x:200+(x-y)*32,y:300+(x+y)*16};};
    const hero={x:3,y:-2},h=toScreen(hero);
    for(const a of [0,.7,1.6,2.9,-2.2]){
      const dir={x:Math.cos(a),y:Math.sin(a)},w=worldDirection(hero,dir,toScreen)!;
      assert.ok(Math.abs(Math.hypot(w.x,w.y)-1)<1e-9,'a unit vector');
      const e=toScreen({x:hero.x+w.x,y:hero.y+w.y}),len=Math.hypot(e.x-h.x,e.y-h.y);
      assert.ok(Math.abs((e.x-h.x)/len-dir.x)<1e-9&&Math.abs((e.y-h.y)/len-dir.y)<1e-9,`view ${view}, ${a}`);
      // rayEnd lands that far along the same world direction.
      const r=rayEnd(hero,dir,5,toScreen),f=toScreen({x:hero.x+w.x*5,y:hero.y+w.y*5});
      assert.ok(Math.hypot(r.x-f.x,r.y-f.y)<1e-6);
    }
  }
  assert.equal(worldDirection({x:0,y:0},{x:1,y:0},()=>({x:0,y:0})),undefined,'a flat projection');
});

test('wiring: a small dead zone, the drag aims every step with the attack held, the body turns, a tap stays one shot',()=>{
  const scene=read('src/client/scene.ts'),explore=read('src/client/explore.ts'),button=read('src/client/hud/attack-button.ts');
  assert.match(button,/export const AIM_DEAD_ZONE_PX=12;/);
  // The scene sends the stick's direction as PlayerInput.aim when there is no mouse, and the body looks there.
  assert.match(scene,/const aim=mouse\?\{x:mouse\.x-net\.predicted\.x,y:mouse\.y-net\.predicted\.y\}:this\.hooks\.aimStick\?\.\(\);/);
  assert.match(scene,/this\.view,this\.intent,push\?\.dir\?\?pull,self\?\.hp,this\.hooks\.aimStick\?\.\(\)\);/);
  assert.match(explore,/aimStick:\(\)=>attackBtn\?\.aim\(\),/);
  assert.match(explore,/reach:\(\)=>\{const me=net\.feed\.players\.get\(net\.id\);return me\?heldReach\(me\):undefined;\},/);
  // Letting go ends the hold (no more shots) and hides the ring.
  assert.match(button,/private end\(\)\{this\.pointer=undefined;this\.centre=undefined;this\.press\.release\(\);this\.deps\.setHeld\(false\);this\.hide\(true\);\}/);
});

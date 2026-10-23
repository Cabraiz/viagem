// Card caixa-icone-torre-arma (decisão final 23/10): a crate is drawn as its own item floating and turning like a coin
// (render/arsenal-rules.ts floatPose/floatSpin), no rarity colour; every item a crate can roll has a sticker the arsenal loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ARSENAL_ITEMS,FLOAT_BOB,FLOAT_EDGE,FLOAT_LIFT,FLOAT_TURN_MS,FLOAT_TURN_OPEN,floatPose,floatSpin,itemIcon} from '../../src/client/render/arsenal-rules.ts';
import {CRATE_ITEMS,arsenalView} from '../../src/client/sandboxes/arsenal-view.ts';
import {CRATE_WEAPONS,STARTER_WEAPONS} from '../../src/sim/crates.ts';
import {KIT_POOL,kitId} from '../../src/rules/tower-kits.ts';
import type {RunView} from '../../src/contract/index.ts';

test('every item a crate can show has a loaded sticker (the floating look never falls back to the crate in a match)',()=>{
  const all=new Set<string>([...Object.values(CRATE_WEAPONS).flat(),...STARTER_WEAPONS,...Object.values(KIT_POOL).flat().map(k=>kitId(k))]);
  for(const id of all){assert.ok(itemIcon(id),`${id} has an icon`);assert.ok(ARSENAL_ITEMS.includes(id),`${id} is loaded`);}
});

test('the coin turn: one turn in FLOAT_TURN_MS, FLOAT_TURN_OPEN× faster when all but open, never edge-on to nothing',()=>{
  let a=0;for(let t=0;t<FLOAT_TURN_MS;t+=20)a=floatSpin(a,20,0);
  assert.ok(Math.min(a,Math.PI*2-a)<1e-6,`a full turn: ${a}`);
  assert.ok(Math.abs(floatSpin(0,100,1)-(1+FLOAT_TURN_OPEN)*floatSpin(0,100,0))<1e-9);
  assert.equal(floatSpin(1,-50,0),1,'time never runs back');
  for(let i=0;i<=64;i++){
    const p=floatPose(i*97,.3,i*Math.PI*2/64);
    assert.ok(Math.abs(p.turn)>=FLOAT_EDGE&&Math.abs(p.turn)<=1);
    assert.ok(p.lift>=FLOAT_LIFT-FLOAT_BOB-1e-9&&p.lift<=FLOAT_LIFT+FLOAT_BOB+1e-9);
    assert.ok(p.shadow>0&&p.shadow<=1.12+1e-9);
  }
  assert.ok(floatPose(0,0,Math.PI).turn<0,'its back faces us half the turn (mirrored)');
  assert.deepEqual(floatPose(123,.5,2,true),{lift:FLOAT_LIFT,turn:1,shadow:1},'reduced motion: still, facing us');
});

test('the sandbox crates name their items (arsenal=1 shows them floating)',()=>{
  const base={tick:0,players:[],pickups:[],projectiles:[],events:[]} as unknown as RunView;
  const view=arsenalView(base,0,0,500,null);
  const chests=view.pickups.filter(p=>p.kind==='chest');
  assert.ok(chests.length>=6);
  for(const c of chests)assert.ok(c.resource&&itemIcon(c.resource),`${c.id}: ${c.resource}`);
  assert.deepEqual(chests.slice(0,5).map(c=>c.resource),[...CRATE_ITEMS]);
});

// BUG-20261027-ORQ-tiro-delay-1s-predicao: the local hero's attack shows on the press; the room's copy is not drawn
// again; a press inside the weapon's learned cooldown waits for the room, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AttackPredictor,MATCH_MS,SWING_GAP_MS} from '../../src/client/net/attack-predict.ts';

test('a press swings and shoots at once; the room\'s swing and fire for it are not drawn again',()=>{
  const a=new AttackPredictor();
  assert.equal(a.swingTick(100,0),0,'the first frame only syncs (a rejoin is no swing)');
  assert.equal(a.press(1000,'faca'),true);
  assert.equal(a.swings,1,'the swing starts on the press');
  // The room's copy, 300 ms later.
  assert.equal(a.swingTick(140,1300),1,'its attackTick: the same swing');
  assert.equal(a.fire(7,'faca',140,1300),false,'its fire: already drawn');
  assert.equal(a.fire(7,'faca',140,1310),false,'the same event, the same answer (renderer and audio)');
});

test('the room\'s swings and fires nobody predicted are drawn (holding on, a teammate-less autopilot, the auto combat)',()=>{
  const a=new AttackPredictor();a.swingTick(0,0);
  assert.equal(a.swingTick(20,500),1);
  assert.equal(a.fire(1,'pistola',20,500),true);
  assert.equal(a.swingTick(40,1500),2);
  assert.equal(a.fire(2,'pistola',40,1500),true);
});

test('one shot of many pellets (one fire each, the same tick) is all skipped when it was predicted',()=>{
  const a=new AttackPredictor();a.swingTick(0,0);
  a.press(0,'escopeta');
  assert.deepEqual([1,2,3].map(id=>a.fire(id,'escopeta',30,300)),[false,false,false]);
  assert.equal(a.fire(4,'escopeta',50,1400),true,'the next shot (unpredicted) shows');
});

test('the cooldown is learned from the room\'s fires; a press inside it is not predicted',()=>{
  const a=new AttackPredictor();a.swingTick(0,0);
  // Holding: the room fires every 16 ticks (800 ms).
  a.fire(1,'rifle',100,0);a.fire(2,'rifle',116,800);a.fire(3,'rifle',132,1600);
  assert.equal(a.cooldownOf('rifle'),800);
  assert.equal(a.press(1900,'rifle'),false,'300 ms after the last shot: the room would refuse it');
  assert.equal(a.press(2500,'rifle'),true,'past the cooldown (and a tick of margin)');
  assert.equal(a.press(2600,'faca'),true,'another weapon has its own cooldown');
});

test('two presses closer than the room\'s swing gap: two shots, one swing',()=>{
  const a=new AttackPredictor();a.swingTick(0,0);
  a.press(0,'pistola');a.press(SWING_GAP_MS-100,'pistola');
  assert.equal(a.swings,1);
  a.press(SWING_GAP_MS+10,'pistola');assert.equal(a.swings,2);
});

test('a prediction the room never confirmed expires: a later room swing is drawn',()=>{
  const a=new AttackPredictor();a.swingTick(0,0);
  a.press(0,'faca');
  assert.equal(a.swingTick(80,MATCH_MS+100),2,'too late to be that press: drawn');
  assert.equal(a.fire(9,'faca',80,MATCH_MS+100),true);
});

test('a new run (the attackTick goes back) forgets the waiting swings',()=>{
  const a=new AttackPredictor();a.swingTick(500,0);
  a.press(100,'faca');
  assert.equal(a.swingTick(0,200),1);
  assert.equal(a.swingTick(12,300),2,'the new run\'s first swing is drawn');
});

test('AttackPress.fresh: only a press that was not held is new (Space\'s repeats, a second key, a held finger)',async()=>{
  const {AttackPress}=await import('../../src/client/hud/attack-aim.ts');
  const p=new AttackPress();
  p.key('espaco',true);assert.equal(p.fresh,true);
  p.key('espaco',true);assert.equal(p.fresh,false,'a key repeat');
  p.key('direito',true);assert.equal(p.fresh,false,'another key while held');
  p.key('espaco',false);p.key('direito',false);
  p.press();assert.equal(p.fresh,true);
});

test('the base cooldown table is the sim\'s refire gap (cooldown, plus the duration of what lingers), every weapon and level',async()=>{
  const {BASE_STATS}=await import('../../src/contract/types.ts');
  const {WEAPON_CATALOG,resolveWeapon}=await import('../../src/sim/weapons/catalog.ts');
  const {WEAPON_COOLDOWN_TICKS,WEAPON_REACH,heldCooldownMs}=await import('../../src/client/hud/weapon-reach.ts');
  for(const def of WEAPON_CATALOG.values()){
    if(!def.pattern)continue;
    const lingers=def.pattern==='orbit'||def.pattern==='shield'||def.pattern==='zone';
    for(let level=1;level<=def.maxLevel+1;level++){
      const w=resolveWeapon(def,Math.min(level,def.maxLevel),{...BASE_STATS});
      assert.equal(heldCooldownMs({id:def.id,level}),((lingers?w.durationTicks:0)+w.cooldownTicks)*50,`${def.id} level ${level}`);
    }
  }
  assert.deepEqual(Object.keys(WEAPON_COOLDOWN_TICKS).sort(),Object.keys(WEAPON_REACH).sort(),'the same weapons as the reach table');
  assert.equal(heldCooldownMs(undefined),0);
});

test('the base cooldown holds a press back before the room fired twice; a shorter learned gap (stats) wins',()=>{
  const a=new AttackPredictor();a.swingTick(0,0);
  assert.equal(a.press(1000,'figa',6500),true);
  assert.equal(a.fire(1,'figa',20,1150),false);
  assert.equal(a.press(2700,'figa',6500),false,'inside the orbit\'s 6.5 s: the room would not fire it');
  assert.equal(a.press(7600,'figa',6500),true);
  assert.equal(a.cooldownOf('figa',6500),6500);
  a.fire(2,'figa',150,7700);a.fire(3,'figa',250,12700);
  assert.equal(a.cooldownOf('figa',6500),5000,'the room fired it 100 ticks apart: a passive cut it');
});

test('a press the room never fired does not hold the next one back',()=>{
  const a=new AttackPredictor();a.swingTick(0,0);
  assert.equal(a.press(1000,'pistola',600),true);
  assert.equal(a.press(1000+MATCH_MS+1,'pistola',600),true,'no fire came: the next press is drawn');
});

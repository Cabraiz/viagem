// BUG-20261023-ORQ-armas-sem-projetil: the flight the shotgun's pellets and the thrown weapons are drawn with.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PELLETS,PELLET_START,THROWN,pelletAlpha,pelletDistance,pelletSpread,thrownLook,throwLift} from '../../src/client/render/shot-flight.ts';
import {FIRE_LOOK,shotDrawScale} from '../../src/client/render/arsenal-rules.ts';
import {THROW_MS} from '../../src/rules/index.ts';
import {getWeapon} from '../../src/sim/weapons/catalog.ts';

test('escopeta: the pellets fan across the sim cone and fly out to its reach; its flash stays at the barrel',()=>{
  const def=getWeapon('escopeta')!,look=PELLETS.escopeta;
  assert.equal(look.half,def.coneHalfAngle);assert.equal(look.reach,def.levels[0].area);
  const spread=pelletSpread(look.count,look.half,1);
  assert.equal(spread.length,look.count);
  for(const p of spread){assert.ok(Math.abs(p.angle)<=look.half+1e-9);assert.ok(p.reach>=.8&&p.reach<=1);}
  assert.ok(Math.min(...spread.map(p=>p.angle))<-look.half/2&&Math.max(...spread.map(p=>p.angle))>look.half/2,'a real fan');
  assert.notDeepEqual(pelletSpread(look.count,look.half,2).map(p=>p.angle),spread.map(p=>p.angle),'no two shots alike');
  assert.equal(pelletDistance(0,4),PELLET_START);assert.equal(pelletDistance(1,4),4);
  assert.ok(pelletDistance(.5,4)>(PELLET_START+4)/2,'fast out of the barrel');
  assert.equal(pelletAlpha(0),1);assert.equal(pelletAlpha(1),0);
  assert.equal(FIRE_LOOK.escopeta.kind,'muzzle');
});

test('thrown: an arc 0 at both ends, the rocket gone when it lands, the brick and firecrackers stay',()=>{
  for(const [id,t] of Object.entries(THROWN)){
    assert.equal(getWeapon(id)?.effect?.thrown,true,id);
    assert.equal(throwLift(0,t.arc),0);assert.ok(Math.abs(throwLift(THROW_MS,t.arc))<1e-9);
    assert.equal(throwLift(THROW_MS/2,t.arc),t.arc);
    assert.equal(FIRE_LOOK[id].kind,'blast',id);
  }
  assert.equal(THROWN.rojao.landed,false);assert.equal(THROWN['tijolo-baiano'].landed,true);
  assert.equal(thrownLook(true,'rojao'),undefined,'a reflected shot is not thrown');
});

test('firearms: the rifle bullet ×4, the metralhadora ×3, the pistol keeps ×5',()=>{
  assert.equal(shotDrawScale(false,'pistola'),5);assert.equal(shotDrawScale(false,'rifle'),4);assert.equal(shotDrawScale(false,'submetralhadora'),3);
});

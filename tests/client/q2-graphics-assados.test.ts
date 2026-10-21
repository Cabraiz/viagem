// NEW-20261021-E5-q2-graphics-assados (Q2): the banks' and the chaveiro's ground are frozen into triangles (TriBand)
// and re-frozen only when what they draw changes; the pulses are a scale, not a redraw.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BANCO} from '../../src/rules/bancos.ts';
import {groundKeys,groundPulse} from '../../src/client/render/bancos/rules.ts';
import {deliveryKey,deliveryPulse,fallenKey} from '../../src/client/render/chaveiro/rules.ts';

const src=(p:string)=>readFileSync(new URL(`../../src/client/render/${p}`,import.meta.url),'utf8');

/** The renderer's rule, as drawGround applies it per piece: freeze again only when the key changed. */
function freezer(){
  let key:string|undefined,draws=0;
  return {at:(k:string)=>{if(k!==key){key=k;draws++;}return draws;}};
}

test('bank ground: two updates with the same state draw once; a saldo, state, zoom or view change draws again',()=>{
  const b={saldo:BANCO.saldo,state:'livre' as const};
  const hold=freezer(),ring=freezer(),shadow=freezer();
  const step=(v:{saldo:number;state:'livre'|'sacando'|'bicho'|'sem-cedulas'},k=1,view=0)=>{
    const keys=groundKeys(v,k,view);return [hold.at(keys.hold),ring.at(keys.ring),shadow.at(keys.shadow)];
  };
  assert.deepEqual(step(b),[1,1,1]);
  assert.deepEqual(step(b),[1,1,1],'same state: no redraw');
  assert.deepEqual(step({...b,saldo:b.saldo-BANCO.nota}),[1,2,1],'a note out: only the saldo ring');
  assert.deepEqual(step({...b,saldo:b.saldo-BANCO.nota,state:'sacando'}),[2,2,1],'paying: only the hold ring');
  assert.deepEqual(step({...b,saldo:b.saldo-BANCO.nota,state:'bicho'}),[3,3,1],'a critter: the saldo ring turns Cone');
  assert.deepEqual(step({...b,saldo:b.saldo-BANCO.nota,state:'bicho'},1.5),[4,4,1],'zoom: the contours');
  assert.deepEqual(step({...b,saldo:b.saldo-BANCO.nota,state:'bicho'},1.5,1),[4,4,2],'a view turn: the shadow');
  assert.deepEqual(step({...b,saldo:b.saldo-BANCO.nota,state:'bicho'},1.501,1),[4,4,2],'zoom under 1/100: the same');
});

test('bank ground: the saldo ring breathes by scale only while a hero is paid, never with reduced effects',()=>{
  assert.equal(groundPulse({state:'livre'},1234,false),1);
  assert.equal(groundPulse({state:'sacando'},1234,true),1);
  const p=groundPulse({state:'sacando'},1234,false);
  assert.ok(p!==1&&Math.abs(p-1)<=.04);
});

test('chaveiro ground: the delivery ring per contour width, breathing by scale; fallen parts per set, heading, view, zoom',()=>{
  assert.equal(deliveryKey(1),deliveryKey(1.004));
  assert.notEqual(deliveryKey(1),deliveryKey(1.2));
  assert.equal(deliveryPulse(500,true),1);
  assert.ok(Math.abs(deliveryPulse(500,false)-1)<=.08);
  const f=freezer();
  assert.equal(f.at(fallenKey(0b101,0,3,0,1)),1);
  assert.equal(f.at(fallenKey(0b101,0,3,0,1)),1,'same parts: no redraw');
  assert.equal(f.at(fallenKey(0b111,0b010,3,0,1)),1,'a part still falling is not on the ground yet');
  assert.equal(f.at(fallenKey(0b111,0,3,0,1)),2,'it landed');
  assert.equal(f.at(fallenKey(0b111,0,4,0,1)),3,'the car turned a step');
});

test('the renderers freeze the grounds (TriBand) behind their keys, and no longer draw them on the per-frame Graphics',()=>{
  const bank=src('bancos/renderer.ts');
  assert.match(bank,/groundKeys\(b,k,this\.options\.projector\.view\)/);
  for(const piece of ['hold','ring','shadow'])
    assert.match(bank,new RegExp(`if\\(g\\.keys\\.${piece}!==keys\\.${piece}\\|\\|!g\\.${piece}\\)\\{[^]*?g\\.${piece}=TriBand\\.make\\(`));
  assert.doesNotMatch(bank,/this\.ground/,'the bank ground Graphics is gone');
  assert.match(bank,/g\.ring\.setPosition\(p\.x,p\.y\)\.setScale\(groundPulse\(/);
  const chav=src('chaveiro/renderer.ts');
  assert.match(chav,/if\(this\.delivery\?\.key!==key\)\{[^]*?TriBand\.make\(/);
  assert.match(chav,/this\.frozenFallen\.show\(fallenKey\(/);
  assert.doesNotMatch(chav,/this\.ground\.lineStyle\([^)]*\)\.strokeEllipse/,'no delivery ellipses on the ground Graphics');
});

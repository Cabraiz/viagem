// Player zoom (NEW-20261013-ORQ-camera-zoom-out-e-roda, D-046): limits, saving, wheel, pinch, easing, and the framing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HERO_ZOOM_PX,Pinch,ZOOM_DEFAULT,ZOOM_KEY,ZOOM_MAX,ZOOM_MIN,ZOOM_SETTLED,clampZoom,easeZoom,loadZoom,saveZoom,wheelZoom} from '../../src/client/camera-zoom.ts';
import {cityZoom,followZoom,worldZoom} from '../../src/client/framing.ts';
import {HERO_WORLD_PX} from '../../src/contract/offscreen.ts';
import {ENEMY_ART} from '../../src/client/render/keys.ts';

const store=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},m};};

test('limits: widest hero 44 px keeps the smallest critter ≥ 28 px; default ~1.4× today\'s area; never closer than today',()=>{
  assert.equal(ZOOM_MAX,1);
  assert.ok(Math.abs(ZOOM_MIN-44/56)<1e-12&&Math.abs(ZOOM_DEFAULT-47/56)<1e-12);
  const smallest=Math.min(...Object.values(ENEMY_ART).map(a=>a.height));
  assert.ok(smallest*HERO_ZOOM_PX.widest/HERO_WORLD_PX>=28,`smallest critter ${(smallest*HERO_ZOOM_PX.widest/HERO_WORLD_PX).toFixed(1)} px`);
  const area=1/(ZOOM_DEFAULT*ZOOM_DEFAULT);
  assert.ok(area>1.35&&area<1.45,`default area ×${area.toFixed(2)}`);
  assert.equal(clampZoom(.1),ZOOM_MIN);assert.equal(clampZoom(3),ZOOM_MAX);assert.equal(clampZoom(NaN),ZOOM_DEFAULT);
});

test('saving: per browser under viagem:zoom:v1, clamped, tolerant of junk and of a missing or throwing storage',()=>{
  const s=store();
  assert.equal(loadZoom(s),ZOOM_DEFAULT);
  assert.ok(saveZoom(s,.8));assert.equal(loadZoom(s),.8);assert.equal(JSON.parse(s.m.get(ZOOM_KEY)!).k,.8);
  saveZoom(s,9);assert.equal(loadZoom(s),ZOOM_MAX);
  s.setItem(ZOOM_KEY,'{oops');assert.equal(loadZoom(s),ZOOM_DEFAULT);
  assert.equal(loadZoom(null),ZOOM_DEFAULT);assert.equal(saveZoom(null,.9),false);
  const broken={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');}};
  assert.equal(loadZoom(broken),ZOOM_DEFAULT);assert.equal(saveZoom(broken,.9),false);
});

test('wheel: down zooms out, up zooms in, a notch is ×1.1, lines and trackpad pinch normalized, always clamped',()=>{
  const k=.9;
  assert.ok(wheelZoom(k,100)<k&&wheelZoom(k,-100)>k);
  assert.ok(Math.abs(wheelZoom(k,-100)-k*1.1)<1e-12);
  assert.ok(Math.abs(wheelZoom(k,3,1)-wheelZoom(k,99))<1e-12,'3 lines ≈ 99 px');
  assert.ok(Math.abs(wheelZoom(k,-10,0,true)-wheelZoom(k,-40))<1e-12,'ctrl (trackpad pinch) ×4');
  assert.equal(wheelZoom(ZOOM_MIN,500),ZOOM_MIN);assert.equal(wheelZoom(ZOOM_MAX,-500),ZOOM_MAX);
  assert.equal(wheelZoom(k,0),k);
});

test('easing: converges to the wanted zoom and lands on it exactly; no motion with no time',()=>{
  let z=1;const target=ZOOM_MIN;
  assert.equal(easeZoom(z,target,0),z);
  for(let i=0;i<200&&z!==target;i++)z=easeZoom(z,target,16);
  assert.equal(z,target,'settles');
  assert.ok(Math.abs(easeZoom(1,.8,90)-(0.8+0.2/Math.E))<1e-9,'one time constant');
  assert.ok(ZOOM_SETTLED>0);
});

test('pinch: only the second finger starts it; spreading zooms in, closing zooms out; a finger up stops it',()=>{
  const p=new Pinch();
  assert.equal(p.down(1,100,100),false);assert.equal(p.move(1,110,100),undefined,'one finger: no pinch');
  assert.equal(p.down(2,200,100),true,'second finger: pinch (the caller cancels the tap walk)');
  assert.ok(Math.abs(p.move(2,290,100)!-2)<1e-12,'fingers 110..200 (90 px) → 110..290 (180 px): ×2');
  assert.ok(p.move(1,200,100)!<1,'closing');
  p.up(2);assert.equal(p.active,false);assert.equal(p.move(1,150,100),undefined);
});

test('framing: the factor scales the hero on both reference phones and the city, k=1 is today\'s zoom',()=>{
  for(const vp of [{width:390,height:844},{width:844,height:390}]){
    assert.equal(followZoom(vp,1),followZoom(vp));assert.equal(cityZoom(vp,1),cityZoom(vp));
    assert.equal(worldZoom(vp,{world:'cidade'} as never,1),cityZoom(vp));
    // Never a closer camera than today at any factor ≤ 1.
    assert.ok(followZoom(vp,ZOOM_MIN)<=followZoom(vp)+1e-12&&cityZoom(vp,ZOOM_MIN)<=cityZoom(vp)+1e-12);
  }
});

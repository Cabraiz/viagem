// Player zoom (NEW-20261013-ORQ-camera-zoom-out-e-roda, D-046): limits, saving, wheel, pinch, easing, and the framing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HERO_ZOOM_PX,Pinch,ZOOM_DEFAULT,ZOOM_DESKTOP,ZOOM_KEY,ZOOM_MAX,ZOOM_MIN,ZOOM_SETTLED,clampZoom,easeZoom,loadZoom,pageZoomEvent,saveZoom,startZoom,wheelZoom} from '../../src/client/camera-zoom.ts';
import {CITY_VIEW_SCALE,TODAY_SHORT_PX,cityZoom,followZoom,worldZoom} from '../../src/client/framing.ts';
import {DESKTOP_MAX_ASPECT,DESKTOP_VISIBLE_LONG_PX,DESKTOP_VISIBLE_SHORT_PX,HERO_DEFAULT_SCREEN_PX,HERO_MIN_SCREEN_PX,HERO_WORLD_PX,MAX_ASPECT,VISIBLE_LONG_PX,VISIBLE_SHORT_PX} from '../../src/contract/offscreen.ts';
import {ENEMY_ART} from '../../src/client/render/keys.ts';
import {visibleAtDefault,visibleOffset} from '../../src/contract/offscreen.ts';

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

test('framing on every screen (review): k = 1 is the zoom of before D-046, the default fits the default camera, the widest the contract',()=>{
  const before=(vp:{width:number;height:number})=>{
    const short=Math.min(vp.width,vp.height),long=Math.max(vp.width,vp.height),hero=Math.max(56,short*56/390);
    return Math.max(hero/96,short/(96*390/56),long/(96*390/56*2.34));
  };
  const defShort=HERO_WORLD_PX*390/HERO_DEFAULT_SCREEN_PX;
  assert.ok(Math.abs(TODAY_SHORT_PX-HERO_WORLD_PX*390/HERO_MIN_SCREEN_PX)<1e-9);
  for(const [w,h] of [[390,844],[844,390],[360,640],[412,915],[1335,620],[1920,780],[2560,950],[2560,1080],[1920,600],[1080,2520],[1024,768]]){
    const vp={width:w,height:h},short=Math.min(w,h),long=Math.max(w,h);
    assert.ok(Math.abs(followZoom(vp,1)-before(vp))<1e-12,`${w}x${h}: k=1 is before`);
    const zd=followZoom(vp,ZOOM_DEFAULT),zm=followZoom(vp,ZOOM_MIN);
    assert.ok(short/zd<=defShort+1e-6&&long/zd<=defShort*MAX_ASPECT+1e-6,`${w}x${h}: default inside the default camera`);
    assert.ok(short/zm<=VISIBLE_SHORT_PX+1e-6&&long/zm<=VISIBLE_LONG_PX+1e-6,`${w}x${h}: widest inside the contract`);
    assert.ok(zm<zd&&zd<followZoom(vp,1),`${w}x${h}: the whole range moves`);
  }
});

// NEW-20261020-ORQ-zoom-fixo-pc: the computer's camera is ~20% farther than the phone's default and fixed.
test('computer: ZOOM_DESKTOP is 0.81× the default (hero 38 px), ignores the saved zoom; a phone still loads it',()=>{
  assert.ok(Math.abs(ZOOM_DESKTOP-38/56)<1e-12&&ZOOM_DESKTOP<ZOOM_MIN);
  const ratio=ZOOM_DESKTOP/ZOOM_DEFAULT;assert.ok(ratio>.78&&ratio<.83,`×${ratio.toFixed(3)}`);
  const s=store();saveZoom(s,.95);
  assert.equal(startZoom(true,s),ZOOM_DESKTOP);assert.equal(startZoom(false,s),.95);assert.equal(startZoom(false,null),ZOOM_DEFAULT);
});

test('computer: the page zoom events (Ctrl/⌘ + − = 0, Ctrl+wheel) are recognised, plain keys and wheels are not',()=>{
  for(const key of ['+','-','=','0','_'])assert.ok(pageZoomEvent({type:'keydown',ctrlKey:true,key}),key);
  assert.ok(pageZoomEvent({type:'keydown',metaKey:true,key:'x',code:'Equal'}));
  assert.ok(pageZoomEvent({type:'keydown',ctrlKey:true,key:'+',code:'NumpadAdd'}));
  assert.ok(pageZoomEvent({type:'wheel',ctrlKey:true}));
  assert.ok(!pageZoomEvent({type:'wheel'}));assert.ok(!pageZoomEvent({type:'keydown',key:'-'}));
  assert.ok(!pageZoomEvent({type:'keydown',ctrlKey:true,key:'c',code:'KeyC'}));
});

test('computer: at ZOOM_DESKTOP a landscape window shows ≤ the desktop camera of the contract, 0.81× the default up to 2.1:1; a portrait one stays at the phone\'s widest',()=>{
  for(const [w,h] of [[1335,620],[1343,618],[1920,970],[1920,780],[2560,1080],[1280,800],[1024,768],[3440,1300]]){
    const vp={width:w,height:h},z=followZoom(vp,ZOOM_DESKTOP);
    assert.ok(h/z<=DESKTOP_VISIBLE_SHORT_PX+1e-6&&w/z<=DESKTOP_VISIBLE_LONG_PX+1e-6,`${w}x${h}: inside the desktop camera`);
    const r=z/followZoom(vp,ZOOM_DEFAULT);
    if(w/h<=DESKTOP_MAX_ASPECT)assert.ok(Math.abs(r-ZOOM_DESKTOP/ZOOM_DEFAULT)<1e-9,`${w}x${h}: ×${r.toFixed(3)}`);
    else assert.ok(r<1,`${w}x${h}: ×${r.toFixed(3)} still farther`);
    const c=cityZoom(vp,ZOOM_DESKTOP)*CITY_VIEW_SCALE;
    assert.ok(h/c<=DESKTOP_VISIBLE_SHORT_PX+1e-6&&w/c<=DESKTOP_VISIBLE_LONG_PX+1e-6,`${w}x${h}: city inside the desktop camera`);
  }
  for(const [w,h] of [[620,1335],[800,1280]]){
    const vp={width:w,height:h},z=followZoom(vp,ZOOM_DESKTOP);
    assert.ok(w/z<=VISIBLE_SHORT_PX+1e-6&&h/z<=VISIBLE_LONG_PX+1e-6,`${w}x${h}: portrait inside the phone's widest`);
  }
});

test('computer: every corner of a 1920×970 or 1343×618 screen at ZOOM_DESKTOP is "visible" to the contract (nothing spawns or pops there)',()=>{
  for(const [w,h] of [[1920,970],[1343,618]]){
    const z=followZoom({width:w,height:h},ZOOM_DESKTOP),hw=w/z/2*.99,hh=h/z/2*.99;
    for(const [sx,sy] of [[hw,hh],[-hw,hh],[hw,-hh],[-hw,-hh]]){
      const x=(sx/42+sy/21)/2,y=(sy/21-sx/42)/2;
      assert.ok(visibleOffset(x,y),`${w}x${h}: corner ${sx.toFixed(0)},${sy.toFixed(0)}`);
      assert.ok(visibleAtDefault({x:0,y:0},{x,y}),`${w}x${h}: corner at the default (pacing)`);
    }
  }
});

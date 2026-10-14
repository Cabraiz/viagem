/**
 * Minimap WC3 (card NEW-20261013-ORQ-minimapa-wc3): the world ↔ minimap mapping and the camera rectangle. Results only
 * (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectView} from '../../src/client/projection.ts';
import {screenCorners} from '../../src/client/hud/city/wiring.ts';
import {cameraQuad,cityFrame,fromMini,imageTransform,insideMini,toMini,windowFrame} from '../../src/client/hud/wc-minimap/geometry.ts';

const near=(a:number,b:number,e=1e-6)=>Math.abs(a-b)<=e;
// Flat ground: projectView without a terrain would add the island's hill (world.ts elevation).
const FLAT={height:()=>0} as unknown as Parameters<typeof projectView>[2];

test('world → minimap → world is the identity, in every camera view', () => {
  for(const view of [0,1,2,3]){
    const f=cityFrame({w:168.96,h:168.96},120,view);
    for(const p of [{x:0,y:0},{x:30,y:140},{x:84.5,y:84.5},{x:168,y:3}]){
      const back=fromMini(toMini(p,f),f);
      assert.ok(near(back.x,p.x)&&near(back.y,p.y),`view ${view} ${JSON.stringify(p)}`);
    }
  }
});

test('the whole city fits the square (a diamond touching its sides), its middle in the middle', () => {
  const size={w:287.232,h:287.232};
  for(const view of [0,1,2,3]){
    const f=cityFrame(size,200,view),c=toMini({x:size.w/2,y:size.h/2},f);
    assert.ok(near(c.x,100)&&near(c.y,100));
    const corners=[{x:0,y:0},{x:size.w,y:0},{x:size.w,y:size.h},{x:0,y:size.h}].map(p=>toMini(p,f));
    for(const m of corners)assert.ok(insideMini(m,f),`view ${view}: ${JSON.stringify(m)}`);
    // Each corner touches a side (to within the 2% margin): the map uses the frame.
    assert.ok(Math.min(...corners.map(m=>m.x))<200*0.02&&Math.max(...corners.map(m=>m.y))>200*0.98);
  }
});

test('up on the minimap is up on the screen, right is right, in every view', () => {
  for(const view of [0,1,2,3]){
    const f=windowFrame({x:10,y:10},120,view,60),a={x:10,y:10};
    for(const d of [{x:3,y:0},{x:0,y:3},{x:-2,y:1},{x:1,y:-4}]){
      const b={x:a.x+d.x,y:a.y+d.y};
      const sa=projectView(a,view,FLAT),sb=projectView(b,view,FLAT),ma=toMini(a,f),mb=toMini(b,f);
      // Same direction on screen and on the minimap, up to the 2:1 squash of the screen's y.
      const screen={x:sb.x-sa.x,y:(sb.y-sa.y)*2},mini={x:mb.x-ma.x,y:mb.y-ma.y};
      const cos=(screen.x*mini.x+screen.y*mini.y)/(Math.hypot(screen.x,screen.y)*Math.hypot(mini.x,mini.y));
      assert.ok(cos>0.9999,`view ${view} d ${JSON.stringify(d)} cos ${cos}`);
    }
  }
});

test('the camera view is an axis-aligned rectangle that shrinks as the zoom grows (3 zooms)', () => {
  const viewport={width:844,height:390},focus={x:80,y:90};
  let last=Infinity;
  for(const zoom of [0.85,1,1.25]){
    for(const view of [0,1,2,3]){
      const f=cityFrame({w:168.96,h:168.96},160,view),s0=projectView(focus,view,FLAT);
      const locate=(p:{x:number;y:number})=>{const s=projectView(p,view,FLAT);return {x:viewport.width/2+(s.x-s0.x)*zoom,y:viewport.height/2+(s.y-s0.y)*zoom};};
      const q=cameraQuad(screenCorners(locate,focus,viewport),f);
      assert.equal(q.length,4);
      assert.ok(near(q[0].y,q[1].y,1e-6)&&near(q[2].y,q[3].y,1e-6)&&near(q[0].x,q[3].x,1e-6)&&near(q[1].x,q[2].x,1e-6),`view ${view}: axis-aligned`);
      const w=q[1].x-q[0].x,h=q[3].y-q[0].y;
      // The screen's aspect, with its y counted twice (the iso squash undone): 844 : 2·390.
      assert.ok(near(w/h,844/(2*390),1e-6),`aspect ${w/h}`);
      const c=toMini(focus,f);
      assert.ok(near((q[0].x+q[2].x)/2,c.x,1e-6)&&near((q[0].y+q[2].y)/2,c.y,1e-6),'centred on the camera focus');
      if(view===0){assert.ok(w<last,`zoom ${zoom}: ${w}`);last=w;}
    }
  }
});

test('one image transform draws a world grid where toMini puts it', () => {
  const f=cityFrame({w:168.96,h:168.96},128,1),[a,b,c,d,e,g]=imageTransform(f,{x:0,y:0},0.88);
  for(const [u,v] of [[0,0],[10,3],[191,191],[50,120]]){
    const m=toMini({x:u*0.88,y:v*0.88},f);
    assert.ok(near(a*u+c*v+e,m.x,1e-9)&&near(b*u+d*v+g,m.y,1e-9));
  }
});

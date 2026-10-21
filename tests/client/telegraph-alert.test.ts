import test from 'node:test';
import assert from 'node:assert/strict';
import {TELEGRAPH_KINDS} from '../../src/contract/index.ts';
import {ALERT_CSS,alertAnchor,planAlert} from '../../src/client/render/telegraph-alert.ts';
import {DECOR_MAX_OPS,DECOR_STRIDE,DecorBuffer,HAZARD,LAYER_AIR,OP_CIRCLE,OP_POLY,planDecor,type DecorFrame} from '../../src/client/render/telegraph-look.ts';
import {OUTLINE_MAX_POINTS,telegraphOutline,type Pt,type TelegraphShape} from '../../src/client/render/telegraph-shape.ts';
import {telegraphHits} from '../../src/rules/telegraph-geometry.ts';

/** The view-0 projection (render/projector.ts without terrain). */
const iso=(x:number,y:number,out:Pt)=>{out.x=(x-y)*42;out.y=(x+y)*21;return out;};
const ZONES:Record<string,TelegraphShape>={
  circle:{shape:'circle',x:10,y:12,radius:1.15,dx:1,dy:0},
  line:{shape:'line',x:10,y:12,radius:3.2,dx:-.94,dy:.33,width:.9},
  cone:{shape:'cone',x:10,y:12,radius:2.4,dx:.41,dy:.91,width:1.1},
  'cone-wide':{shape:'cone',x:10,y:12,radius:3,dx:0,dy:1,width:Math.PI*2},
};
/** The renderer's input: the drawn outline at k = 1, its bounds and its insetLimit. */
function drawn(t:TelegraphShape,css=1.7){
  const pts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  const n=telegraphOutline(t,1,(i,x,y)=>{iso(x,y,pts[i]);});
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(let i=0;i<n;i++){const p=pts[i];bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxY=Math.max(bounds.maxY,p.y);}
  const f:DecorFrame={u:.5,ticksLeft:10,now:1000,reduced:false,phase:.3,css,bounds};
  return {pts,n,f};
}
/** Even-odd point-in-polygon on screen. */
function inside(pts:Pt[],n:number,x:number,y:number){
  let c=false;
  for(let i=0,j=n-1;i<n;j=i++){const a=pts[i],b=pts[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)c=!c;}
  return c;
}
/** Every point the mark's ops touch (polygon corners, the dots' extreme points). */
function markPoints(buf:DecorBuffer,from:number){
  const out:Pt[]=[],d=buf.data;
  for(let i=from;i<buf.count;i++){
    const o=i*DECOR_STRIDE,a=o+4;
    if(d[o]===OP_POLY)for(let k=0;k<d[a];k++)out.push({x:d[a+1+k*2],y:d[a+2+k*2]});
    else if(d[o]===OP_CIRCLE){const r=d[a+2];out.push({x:d[a]-r,y:d[a+1]},{x:d[a]+r,y:d[a+1]},{x:d[a],y:d[a+1]-r},{x:d[a],y:d[a+1]+r});}
  }
  return out;
}

test('the anchor is inside the zone the server damages, for every shape',()=>{
  for(const [name,t] of Object.entries(ZONES)){
    const p=alertAnchor(t,{x:0,y:0});
    assert.ok(telegraphHits(t,p),name);
  }
  const c=alertAnchor(ZONES.circle,{x:0,y:0});assert.deepEqual(c,{x:10,y:12});
  const l=alertAnchor(ZONES.line,{x:0,y:0});assert.ok(Math.abs(l.x-(10-.94*1.6))<1e-9&&Math.abs(l.y-(12+.33*1.6))<1e-9,'line midpoint');
});

test('a Papel "!" outlined in Breu, on the air layer, entirely inside the drawn zone',()=>{
  for(const [name,t] of Object.entries(ZONES)){
    const {pts,n,f}=drawn(t),buf=new DecorBuffer(),count=planAlert(t,f,pts,n,iso,buf);
    assert.equal(count,4,name);assert.equal(buf.dropped,0);
    const d=buf.data,ops=[0,1,2,3].map(i=>i*DECOR_STRIDE);
    for(const o of ops)assert.equal(d[o+1],LAYER_AIR,name);
    // Outline first (Breu), glyph over it (Papel): bar polygon, then the dot.
    assert.deepEqual(ops.map(o=>[d[o],d[o+2]]),[[OP_POLY,HAZARD.breu],[OP_CIRCLE,HAZARD.breu],[OP_POLY,HAZARD.papel],[OP_CIRCLE,HAZARD.papel]],name);
    for(const p of markPoints(buf,0))assert.ok(inside(pts,n,p.x,p.y),`${name}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) outside`);
  }
});

test('screen-constant size: the full height at the phone zoom, shrunk in a small zone, absent in a tiny one',()=>{
  const height=(buf:DecorBuffer)=>{const ys=markPoints(buf,0).map(p=>p.y);return Math.max(...ys)-Math.min(...ys);};
  const big:TelegraphShape={shape:'circle',x:0,y:0,radius:3,dx:1,dy:0};
  for(const css of [1,1.7,2.4]){
    const {pts,n,f}=drawn(big,css),buf=new DecorBuffer();planAlert(big,f,pts,n,iso,buf);
    // The Breu outline adds its width above and below the glyph.
    const o=Math.min(ALERT_CSS.outline*css,ALERT_CSS.height*css*.16);
    assert.ok(Math.abs(height(buf)-(ALERT_CSS.height*css+2*o))<1e-6,`css ${css}`);
  }
  const small:TelegraphShape={shape:'circle',x:0,y:0,radius:.45,dx:1,dy:0};
  {const {pts,n,f}=drawn(small),buf=new DecorBuffer();planAlert(small,f,pts,n,iso,buf);
    assert.ok(buf.count===4&&height(buf)<ALERT_CSS.height*1.7,'shrunk, still drawn');}
  const tiny:TelegraphShape={shape:'circle',x:0,y:0,radius:.08,dx:1,dy:0};
  {const {pts,n,f}=drawn(tiny),buf=new DecorBuffer();assert.equal(planAlert(tiny,f,pts,n,iso,buf),0,'no mark in a tiny zone');}
});

test('after every kind\'s own drawing, within the op budget and on top of it',()=>{
  for(const kind of TELEGRAPH_KINDS)for(const t of Object.values(ZONES)){
    const z={...t,kind},{pts,n,f}=drawn(z),buf=new DecorBuffer();
    const before=planDecor(z,f,iso,buf),after=planAlert(z,f,pts,n,iso,buf);
    assert.equal(after,before+4,`${kind} ${t.shape}`);
    assert.ok(after<=DECOR_MAX_OPS);assert.equal(buf.dropped,0,`${kind} ${t.shape}`);
  }
});

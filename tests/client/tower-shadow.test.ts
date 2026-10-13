/**
 * Lighting card (iluminacao-levemente-realista, E3): the defenses' cast shadow (src/client/render/towers/tower-shadow.ts).
 *  1. The polygon is the footprint stretched toward screen right-down (+qx, away from the upper-left sun) by
 *     height × SHADOW_PER_HEIGHT × 0.75 (the city blocks' factor), in the lit shadow colour.
 *  2. Obra and ruin cast by their drawn height; the Gustavão's flat carriage casts a modest one.
 *  3. Soft: three nested copies whose overlap is LIT_SHADOW.alpha in the core, the edge lighter.
 *  4. `?luz=0` and economy mode: no shadow at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {LIT_SHADOW,SHADOW_PER_HEIGHT,SUN_VIEW,lightEnabled} from '../../src/client/render/light.ts';
import {FLAT_CARRIAGE_SHADOW,SHADOW_DIR,TOWER_SHADOW_PER_HEIGHT,castHeight,grow,layerAlpha,softShadow,towerShadow,towerShadowLook} from '../../src/client/render/towers/tower-shadow.ts';
import {PHASE_HEIGHT,TOWER_LOOK} from '../../src/client/render/towers/tower-rules.ts';
import {TILE_X,TILE_Y,project} from '../../src/client/render/city/projection.ts';

const UNIT=Math.hypot(TILE_X,TILE_Y);
/** Screen footprint of a box of half extents (hx, hy) at (x, y) in a view, as the renderer projects it. */
const foot=(x:number,y:number,hx:number,hy:number,view:number)=>[[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]].map(([dx,dy])=>project(x+dx,y+dy,0,view));
const on=towerShadowLook(true,false)!;
const close=(a:number,b:number,eps=1e-6)=>Math.abs(a-b)<=eps;

test('1. away from the sun, as long as the blocks\' shadows, in the lit shadow colour',()=>{
  assert.equal(on.color,LIT_SHADOW.color);assert.equal(on.alpha,LIT_SHADOW.alpha);
  assert.equal(TOWER_SHADOW_PER_HEIGHT,SHADOW_PER_HEIGHT*.75,'the city blocks\' factor (city-layer CAST_SHADOW)');
  // Screen right-down, opposite to the sun's screen direction (upper left).
  assert.ok(SHADOW_DIR.x>0&&SHADOW_DIR.y>0);
  assert.ok(SHADOW_DIR.x*(SUN_VIEW[0]-SUN_VIEW[1])<0&&SHADOW_DIR.y*(SUN_VIEW[0]+SUN_VIEW[1])<0,'away from the sun on screen');
  for(const view of [0,1,2,3]){
    const f=foot(20,30,.8,.6,view),H=1.6,poly=towerShadow(f,H,UNIT,on);
    const L=H*TOWER_SHADOW_PER_HEIGHT*UNIT;
    // The hull keeps the footprint and the footprint moved by L along +qx: its far right-down extent grew by exactly that.
    const maxOf=(pts:{x:number;y:number}[],k:(p:{x:number;y:number})=>number)=>Math.max(...pts.map(k));
    const along=(p:{x:number;y:number})=>p.x*SHADOW_DIR.x+p.y*SHADOW_DIR.y;
    assert.ok(close(maxOf(poly,along)-maxOf(f,along),L,1e-6),`view ${view}: length = height × per-height`);
    assert.ok(close(Math.min(...poly.map(along)),Math.min(...f.map(along)),1e-6),`view ${view}: it starts at the footprint`);
    for(const p of f)assert.ok(poly.some(q=>close(q.x,p.x)&&close(q.y,p.y))||inside(poly,p),`view ${view}: the footprint is covered`);
    for(const p of f){const m={x:p.x+SHADOW_DIR.x*L,y:p.y+SHADOW_DIR.y*L};assert.ok(poly.some(q=>close(q.x,m.x)&&close(q.y,m.y))||inside(poly,m));}
  }
  // No height: just the footprint; a taller defense a longer shadow.
  const f=foot(5,5,1,1,0);
  assert.equal(towerShadow(f,0,UNIT,on).length,4);
  const len=(H:number)=>{const p=towerShadow(f,H,UNIT,on);return Math.max(...p.map(q=>q.x))-Math.min(...p.map(q=>q.x));};
  assert.ok(len(2)>len(1)&&len(1)>len(0));
});

test('2. obra and ruin by their drawn height; the Gustavão\'s flat carriage casts a modest shadow',()=>{
  const k=TOWER_LOOK['atiradores-do-telhado'];
  const h=(phase:keyof typeof PHASE_HEIGHT)=>castHeight(k.calibre,k.height*PHASE_HEIGHT[phase]);
  assert.ok(h('obra-1')<h('obra-2')&&h('obra-2')<h('obra-3')&&h('obra-3')<h('pronta'));
  assert.ok(h('ruina')<h('danificada')&&h('ruina')<h('obra-2'),'the ruin is rubble: a short shadow');
  const g=TOWER_LOOK.gustavao,gh=castHeight(g.calibre,g.height);
  assert.equal(gh,g.height*FLAT_CARRIAGE_SHADOW);
  assert.ok(gh*TOWER_SHADOW_PER_HEIGHT<.4,'the carriage\'s shadow stays under 0.4 u');
  for(const kind of Object.keys(TOWER_LOOK) as (keyof typeof TOWER_LOOK)[])if(kind!=='gustavao')assert.equal(castHeight(TOWER_LOOK[kind].calibre,1),1,kind);
});

test('3. soft: three nested copies, LIT_SHADOW.alpha where all overlap, the edge lighter',()=>{
  const a=layerAlpha(LIT_SHADOW.alpha);
  assert.ok(close(1-(1-a)**3,LIT_SHADOW.alpha,1e-9));
  assert.ok(a<LIT_SHADOW.alpha/2);
  const s=softShadow(foot(0,0,1,1,0),1.4,UNIT,on,4);
  assert.equal(s.polys.length,3);assert.equal(s.alpha,a);
  const span=(p:{x:number;y:number}[])=>Math.max(...p.map(q=>q.x))-Math.min(...p.map(q=>q.x));
  assert.ok(span(s.polys[0])>span(s.polys[1])&&span(s.polys[1])>span(s.polys[2]),'outer, core, inner');
  assert.ok(close(span(grow(s.polys[1],0)),span(s.polys[1])));
});

test('4. `?luz=0` and economy mode: no shadow',()=>{
  assert.equal(lightEnabled('?luz=0'),false);
  assert.equal(towerShadowLook(lightEnabled('?luz=0'),false),undefined,'light off');
  assert.equal(towerShadowLook(true,true),undefined,'economy');
  assert.equal(towerShadowLook(false,true),undefined);
  assert.ok(towerShadowLook(lightEnabled('?sandbox=cidade&mapa=real&torres=1'),false),'on by default');
  const f=foot(3,4,1,1,2);
  assert.deepEqual(towerShadow(f,2,UNIT,towerShadowLook(false,false)),[]);
  assert.deepEqual(softShadow(f,2,UNIT,towerShadowLook(true,true),4),{alpha:0,polys:[]});
});

/** Point inside a convex polygon (any winding). */
function inside(poly:{x:number;y:number}[],p:{x:number;y:number}){
  let sign=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],c=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    if(Math.abs(c)<1e-9)continue;
    const s=Math.sign(c);if(!sign)sign=s;else if(s!==sign)return false;
  }
  return true;
}

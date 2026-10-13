import test from 'node:test';
import assert from 'node:assert/strict';
import type {CityBlock,GroundKind} from '../../src/client/render/city/asset.ts';
import {
  ART_SCALE,BUILDING_ANCHOR_BOTTOM_PX,CityMaterials,GROUND_TILE_UNITS,PROP_ANCHOR_BOTTOM_PX,buildingAnchor,buildingFrame,
  buildingTextureKey,cellUvPatches,frameExtents,frameUv,frontCorner,groundShadeOverlay,groundTextureKey,matchBuilding,
  propAnchor,propFrame,propTextureKey,tileSpans,
} from '../../src/client/render/city/materials.ts';
import {GROUND_COLORS,groundColor,mixColor} from '../../src/client/render/city/palette.ts';
import {VIEW_PIVOT,depth,project,rotate,viewPoint} from '../../src/client/render/city/projection.ts';

const CELL=0.88,EPS=1e-9;
const VIEWS=[0,1,2,3];
const has=(...keys:string[])=>{const s=new Set(keys);return (k:string)=>s.has(k);};
const block=(over:Partial<CityBlock>):CityBlock=>({id:'b',kind:'building',x:10,y:20,w:2,h:1,height:3,...over});
/** View-space extents (world units) of a w×h block in a view. */
function viewExtents(b:{x:number;y:number;w:number;h:number},view:number){
  const a=viewPoint(b.x*CELL,b.y*CELL,view),c=viewPoint((b.x+b.w)*CELL,(b.y+b.h)*CELL,view);
  return {A:Math.abs(c.x-a.x),B:Math.abs(c.y-a.y)};
}

test('materials: texture keys follow the importer convention',()=>{
  assert.equal(groundTextureKey('packed'),'city:ground:packed');
  assert.equal(buildingTextureKey(3,2,false),'city:building:3x2');
  assert.equal(buildingTextureKey(2,1,true),'city:building:2x1-ruin');
  assert.equal(propTextureKey('car'),'city:prop:car');
  assert.ok(Math.abs(GROUND_TILE_UNITS/CELL-5)<1e-9);
});

test('materials: a block matches a sheet of exactly its footprint, in either orientation',()=>{
  // Direct orientation: even turns.
  const d=matchBuilding(block({w:3,h:2}),has('city:building:3x2'));
  assert.ok(d);assert.equal(d.key,'city:building:3x2');assert.equal(d.a,3);assert.equal(d.b,2);assert.equal(d.turns%2,0);
  // Rotated a quarter turn: the 3x2 sheet serves a 2x3 block with odd turns.
  const r=matchBuilding(block({w:2,h:3}),has('city:building:3x2'));
  assert.ok(r);assert.equal(r.key,'city:building:3x2');assert.equal(r.a,3);assert.equal(r.b,2);assert.equal(r.turns%2,1);
  // Exact footprint only, ruins only on -ruin sheets and intact only on plain sheets.
  assert.equal(matchBuilding(block({w:3,h:3}),has('city:building:3x2')),undefined);
  assert.equal(matchBuilding(block({w:2,h:1,ruined:true}),has('city:building:2x1')),undefined);
  assert.equal(matchBuilding(block({w:2,h:1}),has('city:building:2x1-ruin')),undefined);
  assert.equal(matchBuilding(block({w:1,h:2,ruined:true}),has('city:building:2x1-ruin'))?.key,'city:building:2x1-ruin');
  // Squares take any of the 4 turns; the choice is seeded by the id (stable) and varies across ids.
  const turns=new Set<number>();
  for(let i=0;i<40;i++){
    const m=matchBuilding(block({id:`sq-${i}`,w:2,h:2}),has('city:building:2x2'));
    assert.ok(m);turns.add(m.turns);
    assert.equal(matchBuilding(block({id:`sq-${i}`,w:2,h:2}),has('city:building:2x2'))?.turns,m.turns);
  }
  assert.deepEqual([...turns].sort(),[0,1,2,3]);
});

test('materials: the frame of a turned block shows the art in the orientation the block has on screen',()=>{
  for(const [w,h] of [[1,1],[2,1],[1,2],[2,2],[3,2],[2,3]])for(let i=0;i<8;i++){
    const b=block({id:`f-${w}x${h}-${i}`,w,h}),m=matchBuilding(b,has(buildingTextureKey(Math.max(w,h),Math.min(w,h),false)));
    assert.ok(m);
    for(const view of VIEWS){
      const frame=buildingFrame(view,m.turns),fe=frameExtents(m.a,m.b,frame,CELL),ve=viewExtents(b,view);
      assert.ok(Math.abs(fe.A-ve.A)<EPS&&Math.abs(fe.B-ve.B)<EPS,`${w}x${h} turns ${m.turns} view ${view}`);
      // Composition: the block is the art turned by `turns`, so view v of the block is view v+turns of the art.
      const art=rotate(m.a,m.b,m.turns),r=rotate(art.x,art.y,view),q=rotate(m.a,m.b,frame);
      assert.ok(Math.abs(r.x-q.x)<EPS&&Math.abs(r.y-q.y)<EPS);
    }
  }
  assert.equal(buildingFrame(3,1),0);assert.equal(buildingFrame(1,2),3);assert.equal(buildingFrame(-1,0),3);
  assert.equal(buildingFrame(2,1,1),0,'single-frame sheets always use frame 0');
  assert.deepEqual(VIEWS.map(v=>propFrame(v)),[0,1,2,3]);
  assert.equal(propFrame(2,1),0);
});

test('materials: the front corner is the footprint corner nearest the camera',()=>{
  const b={x:4,y:7,w:3,h:2};
  for(const view of VIEWS){
    const fc=frontCorner(view);
    const corners=[[0,0],[1,0],[0,1],[1,1]].map(([i,j])=>({i,j,d:depth((b.x+i*b.w)*CELL,(b.y+j*b.h)*CELL,view)}));
    const best=corners.reduce((p,c)=>c.d>p.d?c:p);
    assert.deepEqual({i:fc.i,j:fc.j},{i:best.i,j:best.j},`view ${view}`);
    // It is also the lowest corner on screen at ground level.
    const y=(c:{i:number;j:number})=>project((b.x+c.i*b.w)*CELL,(b.y+c.j*b.h)*CELL,0,view).y;
    for(const c of corners)assert.ok(y(fc)>=y(c)-EPS);
  }
});

test('materials: the building anchor puts the front corner where the convention draws it',()=>{
  // Draw the footprint diamond in art px as the convention says (centred horizontally, front corner BOTTOM px above
  // the bottom edge) and check the origin lands on that front corner, for every frame of a 3x2 sheet.
  const fw=900,fh=800;
  for(const frame of VIEWS){
    const a=buildingAnchor(3,2,frame,fw,fh,CELL);
    assert.equal(a.scale,1/ART_SCALE);
    // Footprint of a 3x2 art building placed at the world origin, seen in view `frame`.
    const pts=[[0,0],[3,0],[3,2],[0,2]].map(([x,y])=>project(x*CELL,y*CELL,0,frame,VIEW_PIVOT));
    const xs=pts.map(p=>p.x),centre=(Math.min(...xs)+Math.max(...xs))/2;
    const front=pts.reduce((p,c)=>c.y>p.y?c:p);
    const artX=fw/2+(front.x-centre)*ART_SCALE;
    assert.ok(Math.abs(a.originX*fw-artX)<1e-6,`frame ${frame}`);
    assert.ok(Math.abs(a.originY*fh-(fh-BUILDING_ANCHOR_BOTTOM_PX))<1e-9);
  }
  // Squares: the front corner is always the diamond's bottom tip, centred.
  for(const frame of VIEWS)assert.ok(Math.abs(buildingAnchor(2,2,frame,512,512,CELL).originX-0.5)<EPS);
  const p=propAnchor(128);
  assert.equal(p.originX,0.5);assert.equal(p.originY,1-PROP_ANCHOR_BOTTOM_PX/128);assert.equal(p.scale,1/ART_SCALE);
});

test('materials: ground UVs are world position over the tile, continuous across cells, split at tile edges',()=>{
  const T=GROUND_TILE_UNITS;
  // A cell inside one tile: one patch, uv = (x / T) mod 1.
  const inside=cellUvPatches(CELL,2*CELL,2*CELL,3*CELL);
  assert.equal(inside.length,1);
  assert.ok(Math.abs(inside[0].u0-CELL/T)<1e-9&&Math.abs(inside[0].u1-2*CELL/T)<1e-9);
  assert.ok(Math.abs(inside[0].v0-2*CELL/T)<1e-9&&Math.abs(inside[0].v1-3*CELL/T)<1e-9);
  // Cell 4 ends the tile at u = 1 and cell 5 starts the next at u = 0 (5 cells per tile).
  const c4=cellUvPatches(4*CELL,0,5*CELL,CELL),c5=cellUvPatches(5*CELL,0,6*CELL,CELL);
  assert.equal(c4.length,1);assert.equal(c5.length,1);
  assert.ok(Math.abs(c4[0].u1-1)<1e-9&&Math.abs(c5[0].u0)<1e-9);
  // A cell straddling a tile edge (other tile size) is split into patches that tile the cell and stay in [0,1].
  const odd=cellUvPatches(0.5,0.5,1.5,1.5,1);
  assert.equal(odd.length,4);
  let area=0;
  for(const p of odd){
    area+=(p.s1-p.s0)*(p.t1-p.t0);
    for(const v of [p.u0,p.u1,p.v0,p.v1])assert.ok(v>=0&&v<=1);
    // The world point of each patch corner maps to its uv: frac(x / tile).
    const x0=0.5+p.s0,x1=0.5+p.s1;
    assert.ok(Math.abs(p.u0-(x0%1))<1e-9);
    assert.ok(Math.abs(p.u1-(x1%1===0?1:x1%1))<1e-9);
  }
  assert.ok(Math.abs(area-1)<1e-9);
  // Negative world coordinates still land in [0,1].
  for(const s of tileSpans(-1.3,-0.2,1)){assert.ok(s.c0>=0&&s.c1<=1&&s.c1>s.c0);}
  assert.deepEqual(tileSpans(1,1,1),[]);
  // Neighbouring cells meet on the same uv across a whole row (continuity).
  for(let i=0;i<12;i++){
    const a=cellUvPatches(i*CELL,0,(i+1)*CELL,CELL),b=cellUvPatches((i+1)*CELL,0,(i+2)*CELL,CELL);
    const endU=a[a.length-1].u1%1,startU=b[0].u0;
    assert.ok(Math.abs(endU-startU)<1e-9,`cell ${i}`);
  }
});

test('materials: frame UVs map the tile into an atlas frame',()=>{
  const f={u0:0.25,v0:0.5,u1:0.75,v1:1};
  assert.deepEqual(frameUv(0,0,f),[0.25,0.5]);
  assert.deepEqual(frameUv(1,1,f),[0.75,1]);
  assert.deepEqual(frameUv(0.5,0.5,f),[0.5,0.75]);
});

test('materials: slope shading over painted ground follows the flat ground rule',()=>{
  const kinds:GroundKind[]=['snow','packed','ice','rubble','cobble','water'];
  for(const kind of kinds)for(const shade of [-1,-0.5,-0.1,0,0.2,0.7,1,2,-3]){
    const o=groundShadeOverlay(kind,shade),base=GROUND_COLORS[kind].base;
    if(!o){assert.equal(groundColor(kind,shade),base);continue;}
    // Drawing the overlay over the base colour gives exactly the flat ground colour.
    assert.equal(mixColor(base,o.color,o.alpha),groundColor(kind,shade),`${kind} ${shade}`);
  }
  assert.equal(groundShadeOverlay('water',0.5),undefined);
  assert.equal(groundShadeOverlay('snow',0),undefined);
});

test('materials: the registry picks art only when its texture exists, and falls back otherwise',()=>{
  const keys=new Map<string,number>([['city:ground:snow',1],['city:building:2x1-ruin',4],['city:prop:car',4],['city:prop:lamp',1],['city:prop:pine',4]]);
  const m=new CityMaterials({has:k=>keys.has(k),frames:k=>keys.get(k)??0});
  assert.equal(m.ground('snow'),'city:ground:snow');
  assert.equal(m.ground('packed'),undefined);
  assert.equal(m.decorOver('snow'),false);
  assert.equal(m.decorOver('packed'),true);
  const b=m.building(block({w:1,h:2,ruined:true}),2);
  assert.ok(b);assert.equal(b.key,'city:building:2x1-ruin');assert.equal(b.frame,buildingFrame(2,b.turns));
  assert.equal(m.building(block({kind:'wall',w:2,h:1,ruined:true}),0),undefined,'only buildings take sheets');
  assert.equal(m.building(block({w:2,h:1}),0),undefined);
  assert.deepEqual(m.prop('car',3),{key:'city:prop:car',frame:3});
  assert.deepEqual(m.prop('lamp',3),{key:'city:prop:lamp',frame:0});
  assert.equal(m.prop('pine',1),undefined,'pines keep the approved tree sheet');
  assert.equal(m.prop('bench',1),undefined);
  // Nothing is cached: art loaded later is used by the next chunk built.
  keys.set('city:ground:packed',1);
  assert.equal(m.ground('packed'),'city:ground:packed');
});

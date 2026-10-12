import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groundAt,parseCityAsset} from '../../src/client/render/city/asset.ts';
import {blockPieces,buildChunks,type BlockPiece,type CityChunk} from '../../src/client/render/city/chunks.ts';
import {groundQuads,pieceGeometry,viewSide} from '../../src/client/render/city/faces.ts';
import * as palette from '../../src/client/render/city/palette.ts';
import {CITY_PALETTE,MATERIALS,SHADOW} from '../../src/client/render/city/palette.ts';
import {BITE_RUBBLE_MAX_HEIGHT,GLINT,ICING_PX,SHADOW_LENGTH,SPECKS,TRACK,groundDecor,pieceDecor,pieceShadow,type DecorPrim} from '../../src/client/render/city/decor.ts';
import {HEIGHT_PX,project,type Pt} from '../../src/client/render/city/projection.ts';

const asset=parseCityAsset(JSON.parse(readFileSync(new URL('./fixtures/cidade-mini.json',import.meta.url),'utf8')));
const index=buildChunks(asset);
const pieces=index.chunks.flatMap(c=>c.pieces);
const VIEWS=[0,1,2,3];
const TOL=1;

const cellChunk=(cx:number,cy:number):CityChunk=>({key:`c${cx},${cy}`,cx:0,cy:0,x0:cx,y0:cy,x1:cx+1,y1:cy+1,pieces:[],props:[],minBase:0,maxTop:0});
const ptsOf=(p:DecorPrim):Pt[]=>p.shape==='circle'?[{x:p.cx!-p.r!,y:p.cy!},{x:p.cx!+p.r!,y:p.cy!},{x:p.cx!,y:p.cy!-p.r!},{x:p.cx!,y:p.cy!+p.r!}]:p.points!;
const centroid=(pts:Pt[])=>({x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length});
/** Area centroid of a simple polygon. */
function areaCentroid(pts:Pt[]){
  let a=0,x=0,y=0;
  pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length],c=p.x*q.y-q.x*p.y;a+=c;x+=(p.x+q.x)*c;y+=(p.y+q.y)*c;});
  return {x:x/(3*a),y:y/(3*a)};
}
const area=(pts:Pt[])=>Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p.x*q.y-q.x*p.y;},0))/2;
function segDist(p:Pt,a:Pt,b:Pt){
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function inPoly(p:Pt,poly:Pt[],tol=0){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  if(inside||tol<=0)return inside;
  return poly.some((a,i)=>segDist(p,a,poly[(i+1)%poly.length])<=tol);
}
const sig=(p:DecorPrim)=>`${p.shape}:${p.points?.length??0}`;
const allColours=(()=>{
  const s=new Set<number>(),walk=(v:unknown)=>{if(typeof v==='number')s.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))walk(x);};
  for(const v of Object.values(palette))if(typeof v!=='function')walk(v);
  return s;
})();

test('decor is deterministic: same call, same output',()=>{
  for(const v of VIEWS){
    for(const c of index.chunks)assert.deepEqual(groundDecor(c,asset,v),groundDecor(c,asset,v));
    for(const p of pieces){assert.deepEqual(pieceDecor(p,asset,v),pieceDecor(p,asset,v));assert.deepEqual(pieceShadow(p,asset,v),pieceShadow(p,asset,v));}
  }
});

test('ground: each cell has the same world features in every view, all inside its quad (ruts may end on the edge)',()=>{
  for(let cy=0;cy<asset.height;cy++)for(let cx=0;cx<asset.width;cx++){
    const chunk=cellChunk(cx,cy),sigs:string[][]=[];
    for(const v of VIEWS){
      const quad=groundQuads(chunk,asset,v)[0].points,prims=groundDecor(chunk,asset,v);
      for(const p of prims)for(const q of ptsOf(p))assert.ok(inPoly(q,quad,TOL),`cell ${cx},${cy} view ${v}: ${p.shape} #${p.color.toString(16)} at ${q.x.toFixed(1)},${q.y.toFixed(1)} outside`);
      sigs.push(prims.map(sig));
    }
    for(const s of sigs.slice(1))assert.deepEqual(s,sigs[0],`cell ${cx},${cy}`);
  }
});

test('ground: chunk output follows groundQuads order and has the same primitive count in every view',()=>{
  for(const c of index.chunks){
    const counts=VIEWS.map(v=>groundDecor(c,asset,v).length);
    assert.ok(counts.every(n=>n===counts[0]),`${c.key}: ${counts}`);
    // Back-to-front: concatenating the per-cell output in groundQuads order gives the chunk output (no glint cap hit here).
    for(const v of VIEWS){
      const per=groundQuads(c,asset,v).flatMap(q=>groundDecor(cellChunk(q.cx,q.cy),asset,v));
      assert.deepEqual(groundDecor(c,asset,v).map(sig),per.map(sig),`${c.key} view ${v}`);
    }
  }
});

test('ground density: specks per snow cell, ruts on packed streets, shimmer only on water and few per chunk',()=>{
  const neveDetail=CITY_PALETTE['neve-detalhe'];
  for(let cy=0;cy<asset.height;cy++)for(let cx=0;cx<asset.width;cx++){
    const kind=groundAt(asset,cx,cy),prims=groundDecor(cellChunk(cx,cy),asset,0);
    if(kind==='snow'){
      const n=prims.filter(p=>p.shape==='circle'&&p.color===neveDetail).length;
      assert.ok(n>=SPECKS.snow[0]&&n<=SPECKS.snow[1],`snow ${cx},${cy}: ${n}`);
      for(const p of prims)assert.ok(p.r!>=SPECKS.px[0]&&p.r!<=SPECKS.px[1]);
    }
    if(kind!=='water')assert.ok(!prims.some(p=>p.shimmer),`shimmer outside water at ${cx},${cy}`);
    if(kind!=='packed')assert.ok(!prims.some(p=>p.color===CITY_PALETTE['neve-pisada-detalhe']&&p.shape==='line'),`rut outside packed at ${cx},${cy}`);
  }
  let shimmer=0,ruts=0;
  for(const c of index.chunks){
    const prims=groundDecor(c,asset,0),s=prims.filter(p=>p.shimmer).length;
    assert.ok(s<=GLINT.perChunk,`${c.key}: ${s} glints`);shimmer+=s;
    ruts+=prims.filter(p=>p.shape==='line'&&p.color===CITY_PALETTE['neve-pisada-detalhe']&&p.width===TRACK.width).length;
  }
  assert.ok(shimmer>=1,'the fountain has at least one slow glint');
  assert.ok(ruts>=40,`streets carry ruts (${ruts})`);
  // Fountain: every water edge that touches non-water gets the ice rim and the foam ring.
  for(const [cx,cy] of [[15,15],[16,15],[15,16],[16,16]]){
    const prims=groundDecor(cellChunk(cx,cy),asset,0);
    assert.equal(prims.filter(p=>p.color===CITY_PALETTE.gelo).length,2);
    assert.equal(prims.filter(p=>p.color===CITY_PALETTE['agua-espuma']).length,2);
    assert.equal(prims.filter(p=>p.color===CITY_PALETTE['agua-raso']).length,2);
  }
});

test('ruts continue across packed cells: a rut end meets the next cell rut start exactly',()=>{
  const v=0,ends=(cx:number,cy:number)=>groundDecor(cellChunk(cx,cy),asset,v).filter(p=>p.shape==='line'&&p.width===TRACK.width).map(p=>p.points!);
  let joined=0;
  for(let cy=1;cy<=2;cy++)for(let cx=3;cx<12;cx++){
    const a=ends(cx,cy),b=ends(cx+1,cy);
    if(!a.length||!b.length)continue;
    for(const ra of a)if(b.some(rb=>Math.hypot(ra[2].x-rb[0].x,ra[2].y-rb[0].y)<1e-6))joined++;
  }
  assert.ok(joined>=4,`joined ${joined}`);
});

test('shadow: Breu 22%, toward screen right-down in every view, covers the footprint; block pieces tile the block shadow',()=>{
  for(const v of VIEWS)for(const p of pieces){
    const s=pieceShadow(p,asset,v),{cell}=asset;
    assert.equal(s.color,CITY_PALETTE.breu);assert.equal(s.alpha,0.22);assert.equal(s.alpha,SHADOW.alpha);
    const foot=[[p.x,p.y],[p.x+1,p.y],[p.x+1,p.y+1],[p.x,p.y+1]].map(([x,y])=>project(x*cell,y*cell,p.base,v));
    for(const f of foot)assert.ok(inPoly(f,s.points!,0.01),`${p.id} view ${v}`);
    const seam=(['n','s','e','w'] as const).some(side=>p.seams[side]&&viewSide(side,v)==='+x');
    const sc=areaCentroid(s.points!),fc=areaCentroid(foot),d={x:sc.x-fc.x,y:sc.y-fc.y};
    if(seam)assert.ok(Math.abs(area(s.points!)-area(foot))<1e-6,`${p.id} seam piece keeps its footprint`);
    else{
      assert.ok(d.x>0&&d.y>0,`${p.id} view ${v}: ${d.x},${d.y}`);
      assert.ok(Math.abs(d.y/d.x-0.5)<1e-9,'same screen direction (+qx) in every view');
    }
  }
  // Pieces of one block: their shadows add up to the footprint plus one qx-stretch per +qx edge piece, i.e. no
  // overlap. Each edge piece stretches by its own height (stepped ruin roofs differ per piece).
  for(const b of asset.blocks)for(const v of VIEWS){
    const ps=blockPieces(asset,b),{cell}=asset;
    const sum=ps.reduce((s,p)=>s+area(pieceShadow(p,asset,v).points!),0);
    const foot=[[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]].map(([x,y])=>project(x*cell,y*cell,ps[0].base,v));
    const edge=ps.filter(p=>!(['n','s','e','w'] as const).some(side=>p.seams[side]&&viewSide(side,v)==='+x'));
    // A qx-stretch of a unit q-cell by L: L*cell in q units of area; q→screen scales area by 2·TILE_X·TILE_Y.
    const expect=area(foot)+edge.reduce((s,p)=>s+SHADOW_LENGTH*p.height*cell*2*42*21,0);
    assert.ok(Math.abs(sum-expect)<1e-6*expect,`${b.id} view ${v}: ${sum} vs ${expect}`);
  }
});

/** Faces of a piece's outer wall on a world side in a view (the face holding the bottom middle of that side). */
function outerFace(p:BlockPiece,side:'n'|'s'|'e'|'w',v:number){
  const {cell}=asset,mid=side==='n'?[p.x+0.5,p.y]:side==='s'?[p.x+0.5,p.y+1]:side==='w'?[p.x,p.y+0.5]:[p.x+1,p.y+0.5];
  const q=project(mid[0]*cell,mid[1]*cell,p.base+0.02,v);
  return pieceGeometry(p,asset,v).faces.find(f=>f.kind!=='cap'&&inPoly(q,f.points,0.5));
}

test('piece decor: inside the piece faces, never on seams, and anchored to world walls across views',()=>{
  for(const p of pieces){
    const perSide=new Map<string,string[]>();
    for(const v of VIEWS){
      const faces=pieceGeometry(p,asset,v).faces,prims=pieceDecor(p,asset,v);
      // Rubble on a whole-cell bite floor sits on the lowered cap and may rise up to its max height above it.
      const whole=(p.bite??0)>=1,cap=faces.find(f=>f.kind==='cap'),rise=BITE_RUBBLE_MAX_HEIGHT*42;
      const onFloor=(q:Pt)=>!!cap&&Array.from({length:Math.ceil(rise)+1},(_,k)=>k).some(k=>inPoly({x:q.x,y:q.y+k},cap.points,TOL));
      for(const d of prims)for(const q of ptsOf(d))
        assert.ok(faces.some(f=>inPoly(q,f.points,TOL))||(whole&&onFloor(q)),`${p.id} view ${v}: ${d.shape} #${d.color.toString(16)} at ${q.x.toFixed(1)},${q.y.toFixed(1)} outside faces`);
      for(const side of ['n','s','e','w'] as const){
        const vs=viewSide(side,v);
        if(p.seams[side]||(vs!=='+x'&&vs!=='+y'))continue;
        const face=outerFace(p,side,v);
        assert.ok(face,`${p.id} ${side} view ${v} has a wall`);
        const inside=prims.filter(d=>inPoly(centroid(ptsOf(d)),face!.points,0.01)).map(sig);
        const prev=perSide.get(side);
        if(prev)assert.deepEqual(inside,prev,`${p.id} wall ${side} differs between views`);else perSide.set(side,inside);
      }
    }
  }
});

test('piece decor: icing hangs 3–5 px in broad waves; windows, plaster and icicles only on buildings',()=>{
  const icing=new Set([MATERIALS['neve-tampa'].clara,MATERIALS['neve-tampa'].escura]);
  const buildingOnly=new Set([MATERIALS.vidro.clara,MATERIALS.vidro.escura,MATERIALS.vidro.luz,MATERIALS.tijolo.detalhe,CITY_PALETTE['gelo-brilho']]);
  let windows=0,broken=0,icicles=0,plaster=0;
  for(const v of VIEWS)for(const p of pieces){
    const prims=pieceDecor(p,asset,v);
    for(const d of prims.filter(d=>d.shape==='poly'&&icing.has(d.color))){
      const [a,b,...bottom]=d.points!;
      for(const q of bottom){
        const t=Math.abs(b.x-a.x)<1e-9?0:(q.x-a.x)/(b.x-a.x),drop=q.y-(a.y+(b.y-a.y)*t);
        assert.ok(drop>=ICING_PX.min*Math.min(1,p.height*HEIGHT_PX*0.5/ICING_PX.max)-1e-6&&drop<=ICING_PX.max+1e-6,`${p.id}: icing drop ${drop}`);
      }
      assert.ok(bottom.some(q=>{const t=(q.x-a.x)/(b.x-a.x);return q.y-(a.y+(b.y-a.y)*t)>=ICING_PX.min+0.9;}),'waves reach below the minimum');
    }
    if(p.kind!=='building')assert.ok(!prims.some(d=>buildingOnly.has(d.color)),`${p.id}: building detail on a ${p.kind}`);
    else{
      windows+=prims.filter(d=>d.color===MATERIALS.vidro.clara||d.color===MATERIALS.vidro.escura).length;
      broken+=prims.filter(d=>d.color===CITY_PALETTE.breu&&d.shape==='poly').length;
      icicles+=prims.filter(d=>d.color===CITY_PALETTE['gelo-brilho']).length;
      plaster+=prims.filter(d=>d.color===MATERIALS.tijolo.detalhe).length;
      if(!p.ruined)assert.equal(prims.filter(d=>d.color===CITY_PALETTE.breu&&d.shape==='poly').length,0,'no broken windows on intact buildings');
    }
  }
  assert.ok(windows>100&&broken>5&&icicles>50&&plaster>20,`windows ${windows} broken ${broken} icicles ${icicles} plaster ${plaster}`);
});

test('ruin: rubble chunks ≤ 0.3 u on the bite floor; a whole-cell bite (lowered column) shows them in every view',()=>{
  const bites=pieces.filter(p=>p.bite);
  assert.equal(bites.length,2);
  for(const p of bites){
    const dark=CITY_PALETTE['entulho-escura'],shown=VIEWS.filter(v=>pieceDecor(p,asset,v).some(d=>d.color===dark));
    const open=(p.bite??0)>=1?VIEWS:VIEWS.filter(v=>(['n','e'] as const).every(s=>['+x','+y'].includes(viewSide(s,v))));
    assert.deepEqual(shown,open,p.id);
    for(const v of shown){
      const walls=pieceDecor(p,asset,v).filter(d=>d.color===dark);
      assert.ok(walls.length>=2&&walls.length<=3,`${p.id}: ${walls.length} chunks`);
      for(const w of walls){const [a,,,d]=w.points!;assert.ok((a.y-d.y)/HEIGHT_PX<=0.3+1e-9,`${p.id}: chunk ${(a.y-d.y)/HEIGHT_PX} u tall`);}
    }
  }
});

test('partial bite (2×2 ruin, bite 2/3 cell): the step splits the icing and decor stays inside the faces',()=>{
  const ps=blockPieces(asset,{id:'ruin-2x2',kind:'building',x:5,y:5,w:2,h:2,height:3,ruined:true}),ne=ps.find(p=>p.bite)!;
  assert.ok(ne.bite!>0&&ne.bite!<1);
  const icing=new Set([MATERIALS['neve-tampa'].clara,MATERIALS['neve-tampa'].escura]);
  for(const v of VIEWS){
    const faces=pieceGeometry(ne,asset,v).faces,prims=pieceDecor(ne,asset,v);
    for(const d of prims)for(const q of ptsOf(d))assert.ok(faces.some(f=>inPoly(q,f.points,TOL)),`view ${v}: ${d.shape} outside`);
    const walls=(['n','e'] as const).filter(s=>['+x','+y'].includes(viewSide(s,v))).length;
    assert.equal(prims.filter(d=>d.shape==='poly'&&icing.has(d.color)).length,2*walls,`view ${v}: one icing run on each side of the step`);
  }
});

test('palette: every decor colour is a value exported by palette.ts',()=>{
  for(const v of VIEWS){
    for(const c of index.chunks)for(const d of groundDecor(c,asset,v))assert.ok(allColours.has(d.color),`#${d.color.toString(16)}`);
    for(const p of pieces)for(const d of [...pieceDecor(p,asset,v),pieceShadow(p,asset,v)])assert.ok(allColours.has(d.color),`#${d.color.toString(16)}`);
  }
});

test('performance: fixture chunks × 4 views stay under 4000 primitives per chunk and build in < 150 ms (best of 5)',()=>{
  const build=()=>{
    let total=0,max=0;
    for(const v of VIEWS)for(const c of index.chunks){
      let n=groundDecor(c,asset,v).length;
      for(const p of c.pieces)n+=1+pieceDecor(p,asset,v).length;
      total+=n;max=Math.max(max,n);
    }
    return {total,max};
  };
  build();
  // Best of 5: wall-clock limits in a shared machine (several executors) must not flake; ~7-20 ms when idle.
  let ms=Infinity,total=0,max=0;
  for(let i=0;i<5;i++){const t0=performance.now(),r=build();ms=Math.min(ms,performance.now()-t0);total=r.total;max=r.max;}
  assert.ok(max<4000,`max ${max} per chunk`);
  assert.ok(ms<150,`${ms.toFixed(1)} ms for ${total} primitives`);
  console.log(`decor: ${total} primitives over ${index.chunks.length} chunks × 4 views (max ${max}/chunk) in ${ms.toFixed(1)} ms`);
});

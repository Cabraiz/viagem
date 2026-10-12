import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {heightAt,parseCityAsset} from '../../src/client/render/city/asset.ts';
import {CHUNK_CELLS,ChunkTracker,PIECE_MAX_CELLS,buildChunks,chunkScreenBounds,type BlockPiece,type CityChunk} from '../../src/client/render/city/chunks.ts';
import {groundQuads,pieceGeometry,type Face} from '../../src/client/render/city/faces.ts';
import {VIEW_PIVOT,depth,project,rectsOverlap,type Pt,type Rect} from '../../src/client/render/city/projection.ts';

const asset=parseCityAsset(JSON.parse(readFileSync(new URL('./fixtures/cidade-mini.json',import.meta.url),'utf8')));
const index=buildChunks(asset);
const pieces=index.chunks.flatMap(c=>c.pieces);
const VIEWS=[0,1,2,3];
const EPS=1e-6;
const W=(c:number)=>c*asset.cell;

const centroid=(pts:Pt[])=>({x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length});
const area=(pts:Pt[])=>Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p.x*q.y-q.x*p.y;},0))/2;
const inside=(r:Rect,p:Pt)=>p.x>=r.x-EPS&&p.x<=r.x+r.w+EPS&&p.y>=r.y-EPS&&p.y<=r.y+r.h+EPS;
const corners=(p:BlockPiece)=>[[p.x,p.y],[p.x+p.w,p.y],[p.x+p.w,p.y+p.h],[p.x,p.y+p.h]].map(([x,y])=>({x:W(x),y:W(y)}));
const piece=(over:Partial<BlockPiece>):BlockPiece=>({id:'t#0',blockId:'t',kind:'building',x:5,y:5,w:1,h:1,height:1,base:0,
  seams:{n:false,s:false,e:false,w:false},...over});
const chunk=(key:string)=>index.chunks.find(c=>c.key===key) as CityChunk;

test('walls, cliffs and rubble are cut into ≤2-cell pieces that tile the block; buildings stay whole',()=>{
  for(const b of asset.blocks){
    const ps=pieces.filter(p=>p.blockId===b.id).sort((a,c)=>a.x-c.x||a.y-c.y);
    if(b.kind==='building'){
      assert.equal(ps.length,1,b.id);assert.equal(ps[0].id,`${b.id}#0`);
      assert.deepEqual([ps[0].x,ps[0].y,ps[0].w,ps[0].h],[b.x,b.y,b.w,b.h]);
      assert.deepEqual(ps[0].seams,{n:false,s:false,e:false,w:false});
      assert.equal(ps[0].ruined,b.ruined);
    }
    const cells=new Map<string,string>();
    for(const p of ps){
      assert.match(p.id,new RegExp(`^${b.id}#\\d+$`));
      assert.equal(p.kind,b.kind);assert.equal(p.height,b.height);
      if(b.kind!=='building')assert.ok((b.w>=b.h?p.w:p.h)<=PIECE_MAX_CELLS,p.id);
      let base=-Infinity;
      for(let y=p.y;y<p.y+p.h;y++)for(let x=p.x;x<p.x+p.w;x++){
        const k=`${x},${y}`;assert.ok(!cells.has(k),`${p.id} overlaps ${cells.get(k)}`);cells.set(k,p.id);base=Math.max(base,heightAt(asset,x,y));
      }
      assert.equal(p.base,base,p.id);
      // A seam is exactly an edge shared with another piece of the same block.
      const touches=(q:BlockPiece,side:'n'|'s'|'e'|'w')=>side==='e'?q.x===p.x+p.w&&q.y<p.y+p.h&&p.y<q.y+q.h
        :side==='w'?q.x+q.w===p.x&&q.y<p.y+p.h&&p.y<q.y+q.h:side==='s'?q.y===p.y+p.h&&q.x<p.x+p.w&&p.x<q.x+q.w
        :q.y+q.h===p.y&&q.x<p.x+p.w&&p.x<q.x+q.w;
      for(const side of ['n','s','e','w'] as const)assert.equal(p.seams[side],ps.some(q=>q!==p&&touches(q,side)),`${p.id} ${side}`);
    }
    assert.equal(cells.size,b.w*b.h,b.id);
    for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)assert.ok(cells.has(`${x},${y}`),b.id);
  }
  const wall=pieces.filter(p=>p.blockId==='wall-n-w');
  assert.equal(wall.length,7);assert.deepEqual(wall.map(p=>p.id).sort(),[0,1,2,3,4,5,6].map(i=>`wall-n-w#${i}`).sort());
  assert.equal(pieces.filter(p=>p.blockId==='wall-w-n').length,7);
  // Base = highest ground cell under the piece (raise two cells under one wall segment).
  const heights=[...asset.heights];heights[0*asset.width+3]=0.5;heights[0*asset.width+2]=0.2;
  const raised=buildChunks({...asset,heights}).chunks.flatMap(c=>c.pieces);
  assert.equal(raised.find(p=>p.id==='wall-n-w#1')!.base,0.5);
  assert.equal(raised.find(p=>p.id==='wall-n-w#0')!.base,0);
});

test('chunks: 4 for a 32×32 city, every piece and prop in exactly one, deterministic',()=>{
  assert.equal(CHUNK_CELLS,16);
  assert.equal(index.chunks.length,4);assert.equal(index.cols,2);assert.equal(index.rows,2);
  assert.deepEqual(index.chunks.map(c=>c.key),['0,0','1,0','0,1','1,1']);
  assert.equal(index.get(1,0)?.key,'1,0');assert.equal(index.get(2,0),undefined);assert.equal(index.get(-1,0),undefined);
  const total=asset.blocks.reduce((s,b)=>s+(b.kind==='building'?1:Math.ceil(Math.max(b.w,b.h)/PIECE_MAX_CELLS)),0);
  assert.equal(pieces.length,total);assert.equal(new Set(pieces.map(p=>p.id)).size,total);
  const props=index.chunks.flatMap(c=>c.props);
  assert.equal(props.length,asset.props.length);assert.equal(new Set(props.map(p=>p.id)).size,asset.props.length);
  for(const c of index.chunks){
    for(const p of c.pieces){const mx=p.x+Math.floor((p.w-1)/2),my=p.y+Math.floor((p.h-1)/2);assert.ok(mx>=c.x0&&mx<c.x1&&my>=c.y0&&my<c.y1,p.id);}
    for(const p of c.props){const cx=Math.floor(p.x/asset.cell),cy=Math.floor(p.y/asset.cell);assert.ok(cx>=c.x0&&cx<c.x1&&cy>=c.y0&&cy<c.y1,p.id);}
    assert.deepEqual(c.pieces.map(p=>p.id),c.pieces.map(p=>p.id).sort());
    assert.deepEqual(c.props.map(p=>p.id),c.props.map(p=>p.id).sort());
    assert.ok(c.maxTop>=Math.max(...c.pieces.map(p=>p.base+p.height)));
  }
  assert.ok(chunk('1,0').minBase===0&&chunk('1,0').maxTop>=0.6,'hill and cliff counted in the NE chunk');
  assert.deepEqual(buildChunks(asset).chunks,index.chunks);
  assert.equal(buildChunks(asset,8).chunks.length,16);
  assert.equal(buildChunks(asset,10).chunks.length,16);
});

test('chunk screen bounds contain every piece corner, prop and ground point in all 4 views',()=>{
  for(const v of VIEWS)for(const c of index.chunks){
    const r=chunkScreenBounds(c,asset,v);
    for(const p of c.pieces)for(const k of corners(p))for(const z of [p.base,p.base+p.height])assert.ok(inside(r,project(k.x,k.y,z,v)),`${p.id} v${v}`);
    for(const p of c.props)for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])
      assert.ok(inside(r,project(p.x+dx*p.r,p.y+dy*p.r,heightAt(asset,Math.floor(p.x/asset.cell),Math.floor(p.y/asset.cell)),v)),`${p.id} v${v}`);
    for(const q of groundQuads(c,asset,v))for(const pt of q.points)assert.ok(inside(r,pt),`ground ${q.cx},${q.cy} v${v}`);
    for(const p of c.pieces)for(const f of pieceGeometry(p,asset,v).faces)for(const pt of f.points)assert.ok(inside(r,pt),`${p.id} face v${v}`);
  }
  const pivot={x:3,y:-2};
  const a=chunkScreenBounds(chunk('1,1'),asset,1,pivot),p=chunk('1,1').pieces[0],k=corners(p)[2];
  assert.ok(inside(a,project(k.x,k.y,p.base+p.height,1,pivot)),'custom pivot is passed through');
});

const boundsAll=(v:number)=>index.chunks.map(c=>chunkScreenBounds(c,asset,v));
const unionRect=(rs:Rect[]):Rect=>{const x0=Math.min(...rs.map(r=>r.x)),y0=Math.min(...rs.map(r=>r.y));
  return {x:x0,y:y0,w:Math.max(...rs.map(r=>r.x+r.w))-x0,h:Math.max(...rs.map(r=>r.y+r.h))-y0};};
const grow=(r:Rect,m:number):Rect=>({x:r.x-m,y:r.y-m,w:r.w+2*m,h:r.h+2*m});

test('ChunkTracker shows only overlapping chunks, nearest first, a few per update',()=>{
  const b=boundsAll(0),cam:Rect={x:b[0].x+b[0].w/2-50,y:b[0].y+b[0].h/2-40,w:100,h:80};
  const t=new ChunkTracker(index,asset);
  const first=t.update(cam,0);
  assert.deepEqual(first.hide,[]);
  assert.equal(first.show[0],'0,0','nearest chunk first');
  const wanted=index.chunks.filter((c,i)=>rectsOverlap(b[i],grow(cam,128))).map(c=>c.key).sort();
  assert.deepEqual([...first.show].sort(),wanted);
  assert.deepEqual(t.update(cam,0),{show:[],hide:[]});
  // Whole city in view, 1 per update: converges in 4 updates, by distance to the camera centre.
  const all=unionRect(b),t2=new ChunkTracker(index,asset,{maxShowPerUpdate:1});
  const centre={x:all.x+all.w/2,y:all.y+all.h/2};
  const dist=(r:Rect)=>(r.x+r.w/2-centre.x)**2+(r.y+r.h/2-centre.y)**2;
  const order=index.chunks.map((c,i)=>({k:c.key,d:dist(b[i])})).sort((x,y)=>x.d-y.d||(x.k<y.k?-1:1)).map(o=>o.k);
  const got:string[]=[];
  for(let i=0;i<4;i++){const u=t2.update(all,0);assert.equal(u.show.length,1);assert.deepEqual(u.hide,[]);got.push(...u.show);}
  assert.deepEqual(got,order);
  assert.deepEqual(t2.update(all,0),{show:[],hide:[]});
  assert.deepEqual(t2.visible(),['0,0','0,1','1,0','1,1']);
  // Same inputs, same outputs.
  const run=()=>{const tr=new ChunkTracker(index,asset,{maxShowPerUpdate:2});return [tr.update(all,0),tr.update(all,0),tr.update(cam,0),tr.update(all,3)];};
  assert.deepEqual(run(),run());
});

test('ChunkTracker keeps chunks inside the keep margin (hysteresis) and drops them far away',()=>{
  const t=new ChunkTracker(index,asset),b=t.bounds(chunk('0,0'),0);
  const at=(x:number):Rect=>({x,y:b.y+b.h/2-50,w:100,h:100});
  t.update(at(b.x+b.w/2),0);
  assert.ok(t.visible().includes('0,0'));
  // 200 px right of the chunk: outside showMargin (128), inside keepMargin (384).
  const near=at(b.x+b.w+200);
  assert.ok(!rectsOverlap(b,grow(near,128))&&rectsOverlap(b,grow(near,384)));
  assert.ok(!t.update(near,0).hide.includes('0,0'));
  assert.ok(t.visible().includes('0,0'));
  // A fresh tracker at the same spot would not show it.
  const fresh=new ChunkTracker(index,asset);fresh.update(near,0);fresh.update(near,0);
  assert.ok(!fresh.visible().includes('0,0'));
  const far=at(b.x+b.w+1000);
  assert.ok(t.update(far,0).hide.includes('0,0'));
  assert.ok(!t.visible().includes('0,0'));
  for(const k of t.visible()){const r=t.bounds(chunk(k),0);assert.ok(rectsOverlap(r,grow(far,384)),k);}
});

test('ChunkTracker drops everything on a view change and starts over',()=>{
  const t=new ChunkTracker(index,asset,{maxShowPerUpdate:8});
  const all0=grow(unionRect(boundsAll(0)),0),all1=unionRect(boundsAll(1));
  t.update(all0,0);
  const before=t.visible();assert.equal(before.length,4);
  const u=t.update(all1,1);
  assert.deepEqual(u.hide,before);
  assert.deepEqual([...u.show].sort(),before);
  assert.deepEqual(t.visible(),before);
  // A camera that only sees part of the city in the new view shows only that part.
  const t2=new ChunkTracker(index,asset,{maxShowPerUpdate:8});t2.update(all0,0);
  const b1=t2.bounds(chunk('1,1'),2),cam:Rect={x:b1.x+b1.w/2-10,y:b1.y+b1.h/2-10,w:20,h:20};
  const u2=t2.update(cam,2);
  assert.equal(u2.hide.length,4);
  assert.ok(u2.show.includes('1,1')&&u2.show[0]==='1,1');
  for(const k of u2.show)assert.ok(rectsOverlap(t2.bounds(chunk(k),2),grow(cam,128)));
});

const kinds=(fs:Face[])=>fs.map(f=>f.kind);

test('a unit building shows 1 cap and 2 walls on the correct screen sides in every view',()=>{
  for(const pivot of [VIEW_PIVOT,{x:0,y:0}])for(const v of VIEWS){
    const p=piece({}),g=pieceGeometry(p,asset,v,pivot);
    assert.equal(g.faces.length,3);
    assert.deepEqual([...kinds(g.faces)].sort(),['cap','wallDark','wallLight']);
    assert.equal(g.faces[2].kind,'cap','cap drawn last');
    const cap=centroid(g.faces[2].points),light=centroid(g.faces.find(f=>f.kind==='wallLight')!.points),dark=centroid(g.faces.find(f=>f.kind==='wallDark')!.points);
    assert.ok(light.x<cap.x&&light.y>cap.y,`light wall left-down v${v}`);
    assert.ok(dark.x>cap.x&&dark.y>cap.y,`dark wall right-down v${v}`);
    for(const f of g.faces)assert.equal(f.points.length,4);
    assert.equal(g.outline.length,3);
    for(const line of g.outline){assert.equal(line.length,5);assert.deepEqual(line[0],line[4]);}
    const front=Math.max(...corners(p).map(k=>depth(k.x,k.y,v,pivot)));
    assert.ok(Math.abs(g.depthKey-front)<EPS,`depthKey v${v}`);
    // Cap area = footprint area on screen.
    assert.ok(Math.abs(area(g.faces[2].points)-W(1)**2*2*42*21)<1e-6);
  }
});

test('split walls drop seam faces and seam edges from the outline',()=>{
  const mid=pieces.find(p=>p.id==='wall-n-w#3') as BlockPiece,end=pieces.find(p=>p.id==='wall-n-w#0') as BlockPiece;
  assert.deepEqual(mid.seams,{n:false,s:false,e:true,w:true});
  for(const v of VIEWS){
    const g=pieceGeometry(mid,asset,v);
    // Seams on world e and w: exactly one of them is a camera-facing side in any view, so one wall goes.
    assert.equal(g.faces.length,2,`v${v}`);assert.equal(g.faces[1].kind,'cap');
    const seamPts=[mid.x,mid.x+mid.w].map(cx=>new Set([mid.y,mid.y+mid.h].flatMap(cy=>[mid.base,mid.base+mid.height]
      .map(z=>{const s=project(W(cx),W(cy),z,v);return `${s.x.toFixed(6)},${s.y.toFixed(6)}`;}))));
    const key=(p:Pt)=>`${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    let segs=0;
    for(const line of g.outline)for(let i=0;i+1<line.length;i++){
      segs++;
      for(const s of seamPts)assert.ok(!(s.has(key(line[i]))&&s.has(key(line[i+1]))),`seam edge in outline v${v}`);
    }
    // Cap and the remaining wall each keep their 2 edges that are not on a seam.
    assert.equal(segs,4,`v${v}`);
    // The end piece has one seam: 3 + 4 + 3 edges (or 3 + 3 when its seam hides a wall).
    const ge=pieceGeometry(end,asset,v),endSegs=ge.outline.reduce((s,l)=>s+l.length-1,0);
    assert.equal(endSegs,ge.faces.length===3?10:6,`end v${v}`);
  }
  // +qx is world east in view 0 and world west in view 2 (both seams); +qy is east in view 1 and west in view 3.
  assert.deepEqual(VIEWS.map(v=>kinds(pieceGeometry(mid,asset,v).faces).join()),['wallLight,cap','wallDark,cap','wallLight,cap','wallDark,cap']);
  const cliff=pieces.find(p=>p.id==='cliff-e#1') as BlockPiece;
  assert.deepEqual(cliff.seams,{n:true,s:true,e:false,w:false});
  assert.deepEqual(kinds(pieceGeometry(cliff,asset,0).faces),['wallDark','cap']);
  assert.deepEqual(kinds(pieceGeometry(cliff,asset,1).faces),['wallLight','cap']);
});

test('ruined buildings lose a roof bite with a lower floor and camera-facing inner walls',()=>{
  const ruined=pieces.filter(p=>p.ruined);
  assert.equal(ruined.length,2);
  for(const p of ruined){
    const full=p.w*p.h*W(1)**2*2*42*21,bite=W(1)**2*2*42*21;
    const walls:number[]=[];
    for(const v of VIEWS){
      const g=pieceGeometry(p,asset,v),caps=g.faces.filter(f=>f.kind==='cap');
      assert.equal(caps.length,2,`${p.id} v${v}`);
      const top=g.faces[g.faces.length-1];
      assert.equal(top.kind,'cap');assert.equal(top.points.length,6);
      assert.ok(Math.abs(area(top.points)-(full-bite))<1e-6,'roof minus the bite');
      const low=caps[0];
      assert.equal(g.faces.indexOf(low),0,'lower cap drawn first');
      assert.ok(Math.abs(area(low.points)-bite)<1e-6);
      // The floor sits RUIN_FLOOR of the height down: the same footprint corner is 0.4*height*HEIGHT_PX lower on screen.
      const nw=project(W(p.x+p.w-1),W(p.y),p.base+0.6*p.height,v);
      assert.ok(low.points.some(q=>Math.abs(q.x-nw.x)<EPS&&Math.abs(q.y-nw.y)<EPS),`floor height v${v}`);
      walls.push(g.faces.filter(f=>f.kind!=='cap').length);
      // Inner walls (drawn right after the floor) rise from the floor to the roof: shorter than the outer walls.
      const inner=g.faces.slice(1,-3),outer=g.faces.slice(-3,-1);
      for(const f of inner)assert.equal(f.points.length,4);
      for(const f of outer)assert.ok(f.kind!=='cap');
      for(const f of inner)assert.ok(area(f.points)<Math.max(...outer.map(o=>area(o.points))));
      assert.ok(Math.abs(g.depthKey-Math.max(...corners(p).map(k=>depth(k.x,k.y,v))))<EPS);
    }
    // The bite sits at the right, front, left and back corner in views 0..3: 1, 2, 1 and 0 inner walls.
    assert.deepEqual(walls,[3,4,3,2],p.id);
  }
  // A 1-cell-wide ruin has no bite.
  const thin=pieceGeometry(piece({w:1,h:3,ruined:true}),asset,0);
  assert.deepEqual(kinds(thin.faces),['wallLight','wallDark','cap']);
  // 6×6 ruin: the bite never exceeds 1 cell (agreed with the art lane).
  const big=pieceGeometry(piece({x:4,y:4,w:6,h:6,ruined:true}),asset,1);
  assert.ok(Math.abs(area(big.faces[0].points)-W(1)**2*2*42*21)<1e-6);
});

test('ground quads: one per cell, flat ground unshaded, hill flanks lit or dark, back-to-front',()=>{
  for(const v of VIEWS)for(const c of index.chunks){
    const qs=groundQuads(c,asset,v);
    assert.equal(qs.length,(c.x1-c.x0)*(c.y1-c.y0));
    assert.equal(new Set(qs.map(q=>`${q.cx},${q.cy}`)).size,qs.length);
    let last=-Infinity,prev:{cx:number;cy:number}|null=null;
    for(const q of qs){
      const d=depth(W(q.cx+0.5),W(q.cy+0.5),v);
      assert.ok(d>=last-EPS,`order v${v}`);
      if(prev&&Math.abs(d-last)<EPS)assert.ok(q.cy>prev.cy||(q.cy===prev.cy&&q.cx>prev.cx),'ties by cy then cx');
      last=d;prev=q;
      assert.ok(q.shade>=-1&&q.shade<=1);
      assert.equal(q.points.length,4);
    }
  }
  for(const v of VIEWS)for(const q of groundQuads(chunk('0,0'),asset,v)){assert.equal(q.shade,0);}
  const at=(v:number,cx:number,cy:number)=>groundQuads(chunk('1,0'),asset,v).find(q=>q.cx===cx&&q.cy===cy)!;
  const hill=groundQuads(chunk('1,0'),asset,0).filter(q=>heightAt(asset,q.cx,q.cy)>0);
  assert.ok(hill.length>20);
  assert.ok(hill.filter(q=>q.shade!==0).length>hill.length/2,'most hill cells are shaded');
  // View 0: light from the screen upper-left = world west; the west flank faces it, the east flank does not.
  // The lit flank faces view +qy (same side as the lit wall): world south, east, north and west in views 0..3.
  assert.ok(at(0,24,9).shade>0&&at(0,24,5).shade<0,'view 0: south flank lit');
  assert.ok(at(1,26,7).shade>0&&at(1,22,7).shade<0,'view 1: east flank lit');
  assert.ok(at(2,24,5).shade>0&&at(2,24,9).shade<0,'view 2: north flank lit');
  assert.ok(at(3,22,7).shade>0&&at(3,26,7).shade<0,'view 3: west flank lit');
  assert.equal(groundQuads(chunk('0,0'),asset,0).find(q=>q.cx===1&&q.cy===1)!.kind,'packed');
  const corner=project(W(22),W(7),at(0,22,7).points.length?(heightAt(asset,21,6)+heightAt(asset,22,6)+heightAt(asset,21,7)+heightAt(asset,22,7))/4:0,0);
  assert.ok(Math.abs(at(0,22,7).points[0].x-corner.x)<EPS&&Math.abs(at(0,22,7).points[0].y-corner.y)<EPS,'corner = mean of the 4 cells');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {heightAt,parseCityAsset} from '../../src/client/render/city/asset.ts';
import {CHUNK_CELLS,ChunkTracker,PIECE_MAX_CELLS,buildChunks,chunkScreenBounds,propExtentPx,PROP_DRAW_MAX,ruinBite,ruinStepFactor,RUIN_FLOOR,type BlockPiece,type CityChunk} from '../../src/client/render/city/chunks.ts';
import {groundQuads,pieceGeometry,viewSide,type Face} from '../../src/client/render/city/faces.ts';
import {makeSampleCity} from '../../src/client/render/city/sample.ts';
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

test('every block is cut into 1×1 pieces that tile it, share the lowest ground as base and mark internal seams',()=>{
  assert.equal(PIECE_MAX_CELLS,1);
  for(const b of asset.blocks){
    const ps=pieces.filter(p=>p.blockId===b.id);
    assert.equal(ps.length,b.w*b.h,b.id);
    let base=Infinity;
    for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)base=Math.min(base,heightAt(asset,x,y));
    const cells=new Set<string>();
    for(const p of ps){
      assert.equal(p.id,`${b.id}#${(p.y-b.y)*b.w+(p.x-b.x)}`);
      assert.equal(p.w,1);assert.equal(p.h,1);assert.equal(p.kind,b.kind);
      // Stepped ruin roofs (art bible §4.2): only ruined buildings vary, by whole RUIN_STEP steps.
      const factor=b.kind==='building'&&b.ruined?ruinStepFactor(b,p.x-b.x,p.y-b.y):1;
      assert.ok(Math.abs(p.height-b.height*factor)<1e-9,p.id);
      assert.equal(p.base,base,`${p.id}: one base per block (lowest ground)`);
      assert.equal(p.ruined,b.ruined);
      cells.add(`${p.x},${p.y}`);
      assert.deepEqual(p.seams,{n:p.y>b.y,s:p.y<b.y+b.h-1,w:p.x>b.x,e:p.x<b.x+b.w-1},p.id);
      // The ruin bite sits on the world north-east piece only: a third of the shortest edge, at most 1 cell.
      const ne=p.x===b.x+b.w-1&&p.y===b.y;
      assert.equal(p.bite,b.kind==='building'&&b.ruined&&ne?ruinBite(b):undefined,p.id);
    }
    assert.equal(cells.size,b.w*b.h,b.id);
  }
  // Ruins step down 2 or 3 times on one seeded side, keep a full-height row, and record drops toward lower neighbours.
  for(const b of asset.blocks.filter(b=>b.ruined)){
    const ps=pieces.filter(p=>p.blockId===b.id),levels=new Set(ps.map(p=>p.height.toFixed(6)));
    assert.ok(levels.size>=3&&levels.size<=4,`${b.id}: ${levels.size} levels`);
    assert.ok(ps.some(p=>p.height===b.height),`${b.id} keeps full height somewhere`);
    for(const p of ps)for(const side of ['n','s','e','w'] as const){
      const nx=p.x+(side==='e'?1:side==='w'?-1:0),ny=p.y+(side==='s'?1:side==='n'?-1:0);
      // A whole-cell bite lowers its column to the floor (RUIN_FLOOR of its stepped height).
      const top=(q:BlockPiece)=>(q.bite??0)>=1?q.height*RUIN_FLOOR:q.height;
      const n=ps.find(q=>q.x===nx&&q.y===ny),drop=n?top(p)-top(n):0;
      assert.equal(p.drops?.[side]??0,drop>1e-9?drop:0,`${p.id} drop ${side}`);
    }
  }
  assert.equal(ruinStepFactor({id:'x',kind:'building',x:0,y:0,w:1,h:1,height:3},0,0),1,'a 1×1 ruin has no steps');
  assert.equal(ruinBite({w:2,h:5}),2/3);assert.equal(ruinBite({w:6,h:6}),1);assert.equal(ruinBite({w:1,h:9}),1/3);
  // Raising ground under part of a wall does not lift it: the whole block keeps the lowest ground (no floating, no steps).
  const heights=[...asset.heights];heights[0*asset.width+3]=0.5;heights[0*asset.width+2]=0.2;
  const raised=buildChunks({...asset,heights}).chunks.flatMap(c=>c.pieces).filter(p=>p.blockId==='wall-n-w');
  assert.ok(raised.every(p=>p.base===0));
  heights.fill(0.3,0,14);
  const lifted=buildChunks({...asset,heights}).chunks.flatMap(c=>c.pieces).filter(p=>p.blockId==='wall-n-w');
  assert.ok(lifted.every(p=>p.base===0.3),'all cells raised: the block sits on them');
});

test('chunks: 4 for a 32×32 city, every piece and prop in exactly one, deterministic',()=>{
  assert.equal(CHUNK_CELLS,16);
  assert.equal(index.chunks.length,4);assert.equal(index.cols,2);assert.equal(index.rows,2);
  assert.deepEqual(index.chunks.map(c=>c.key),['0,0','1,0','0,1','1,1']);
  assert.equal(index.get(1,0)?.key,'1,0');assert.equal(index.get(2,0),undefined);assert.equal(index.get(-1,0),undefined);
  const total=asset.blocks.reduce((s,b)=>s+b.w*b.h,0);
  assert.equal(pieces.length,total);assert.equal(new Set(pieces.map(p=>p.id)).size,total);
  const props=index.chunks.flatMap(c=>c.props);
  assert.equal(props.length,asset.props.length);assert.equal(new Set(props.map(p=>p.id)).size,asset.props.length);
  for(const c of index.chunks){
    for(const p of c.pieces)assert.ok(p.x>=c.x0&&p.x<c.x1&&p.y>=c.y0&&p.y<c.y1,p.id);
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

test('chunk bounds cover what the layer draws for tall props (lamp pole, pine sheet)',()=>{
  const lamp={id:'L',kind:'lamp' as const,x:W(8),y:W(8),r:0.3},pine={id:'P',kind:'pine' as const,x:W(9),y:W(8),r:0.1};
  assert.ok(propExtentPx(lamp).up>=PROP_DRAW_MAX.lamp*42*17,'lamp: pole 14 r + head 3 r (fixed size)');
  assert.ok(propExtentPx(lamp).up<120,'a lamp never towers over the hero (maps radii are collision sizes)');
  assert.ok(propExtentPx(pine).up>=353*165/340,'pine: approved sheet ~171 px above the feet');
  const c=buildChunks({...asset,props:[lamp,pine]}).chunks[0];
  for(const v of VIEWS){
    const r=chunkScreenBounds(c,asset,v);
    for(const p of [lamp,pine]){
      const f=project(p.x,p.y,0,v),{up,side}=propExtentPx(p);
      assert.ok(inside(r,{x:f.x,y:f.y-up})&&inside(r,{x:f.x-side,y:f.y})&&inside(r,{x:f.x+side,y:f.y}),`${p.kind} v${v}`);
    }
  }
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

test('ChunkTracker keeps a second rect built too (card inimigos-querem-o-uno: the Uno window), after the camera rect',()=>{
  const t=new ChunkTracker(index,asset,{maxShowPerUpdate:8}),b=t.bounds(chunk('0,0'),0),far=t.bounds(chunk('1,1'),0);
  const cam:Rect={x:b.x+b.w/2-20,y:b.y+b.h/2-20,w:40,h:40},car:Rect={x:far.x+far.w/2-20,y:far.y+far.h/2-20,w:40,h:40};
  // A camera far from both chunks (beyond the keep margin): only the second rect shows '1,1'.
  const away:Rect={x:cam.x-5000,y:cam.y-5000,w:40,h:40};
  t.update(away,0,car);
  assert.ok(t.visible().includes('1,1'));assert.ok(!t.visible().includes('0,0'));
  assert.ok(!t.update(away,0,car).hide.includes('1,1'),'kept while the second rect is there');
  assert.ok(t.update(away,0).hide.includes('1,1'),'gone with it');
  // Without a second rect the tracker is main's.
  const plain=new ChunkTracker(index,asset,{maxShowPerUpdate:8}),also=new ChunkTracker(index,asset,{maxShowPerUpdate:8});
  assert.deepEqual(plain.update(cam,0),also.update(cam,0,undefined));
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
    const centre=(Math.max(...corners(p).map(k=>depth(k.x,k.y,v,pivot)))+Math.min(...corners(p).map(k=>depth(k.x,k.y,v,pivot))))/2;
    assert.ok(front>centre);assert.ok(Math.abs(g.depthKey-centre)<EPS,`depthKey = column centre v${v}`);
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
  // An east-edge cliff cell with seams north, south and west: only its world-east wall can show.
  const cliff=pieces.find(p=>p.id==='cliff-e#3') as BlockPiece;
  assert.deepEqual(cliff.seams,{n:true,s:true,e:false,w:true});
  assert.deepEqual(kinds(pieceGeometry(cliff,asset,0).faces),['wallDark','cap']);
  assert.deepEqual(kinds(pieceGeometry(cliff,asset,1).faces),['wallLight','cap']);
  assert.deepEqual(kinds(pieceGeometry(cliff,asset,2).faces),['cap']);
});

test('ruined buildings lose a roof bite with a lower floor and dark camera-facing inner walls',()=>{
  const bitten=pieces.filter(p=>p.bite!==undefined);
  assert.deepEqual(bitten.map(p=>p.blockId).sort(),['bld-nw-2','bld-se-1']);
  for(const b of [0.5,0.75]){
    const p=piece({ruined:true,bite:b}),cap=W(1)**2*2*42*21,biteArea=W(b)**2*2*42*21;
    const walls:number[]=[];
    for(const v of VIEWS){
      const g=pieceGeometry(p,asset,v),caps=g.faces.filter(f=>f.kind==='cap');
      assert.equal(caps.length,2,`bite ${b} v${v}`);
      const top=g.faces[g.faces.length-1];
      assert.equal(top.kind,'cap');assert.equal(top.points.length,6);
      assert.ok(Math.abs(area(top.points)-(cap-biteArea))<1e-6,'roof minus the bite');
      const low=caps[0];
      assert.equal(g.faces.indexOf(low),0,'lower cap drawn first');
      assert.ok(Math.abs(area(low.points)-biteArea)<1e-6);
      // The floor sits at RUIN_FLOOR of the height, at the world north-east corner of the piece.
      const ne=project(W(p.x+1-b),W(p.y+b),p.base+0.6*p.height,v);
      assert.ok(low.points.some(q=>Math.abs(q.x-ne.x)<EPS&&Math.abs(q.y-ne.y)<EPS),`floor corner v${v}`);
      const inner=g.faces.slice(1,-3);
      for(const f of inner)assert.equal(f.kind,'wallDark','inner faces of a ruin are dark (art bible §8.4)');
      walls.push(g.faces.filter(f=>f.kind!=='cap').length);
      const ds=corners(p).map(k=>depth(k.x,k.y,v));
      assert.ok(Math.abs(g.depthKey-(Math.max(...ds)+Math.min(...ds))/2)<EPS);
    }
    // The bite sits at the right, front, left and back corner in views 0..3: 1, 2, 1 and 0 inner walls.
    assert.deepEqual(walls,[3,4,3,2],`bite ${b}`);
  }
  // A whole-cell bite lowers the column: a plain box up to the floor, no notch.
  const low=pieceGeometry(piece({ruined:true,bite:1,height:3}),asset,0);
  assert.deepEqual(kinds(low.faces),['wallLight','wallDark','cap']);
  const capTop=Math.min(...low.faces[2].points.map(q=>q.y)),full=Math.min(...pieceGeometry(piece({height:3}),asset,0).faces[2].points.map(q=>q.y));
  assert.ok(Math.abs(capTop-full-0.4*3*42)<1e-6,'cap lowered to 0.6 of the height');
  // A ruined piece without a bite is a plain box.
  assert.deepEqual(kinds(pieceGeometry(piece({ruined:true}),asset,0).faces),['wallLight','wallDark','cap']);
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

test('a rotation shows every wanted chunk at once (no holes), and reset starts over',()=>{
  const t=new ChunkTracker(index,asset,{maxShowPerUpdate:1});
  const all0=unionRect(boundsAll(0)),all1=unionRect(boundsAll(1));
  for(let i=0;i<4;i++)t.update(all0,0);
  assert.equal(t.visible().length,4);
  const u=t.update(all1,1);
  assert.equal(u.show.length,4,'after a turn the whole screen comes back in one update');
  t.reset();assert.deepEqual(t.visible(),[]);
  assert.equal(t.update(all1,1).show.length,1,'first update after reset keeps the per-update budget');
});

test('a rotation shows at once only the chunks the camera meets; the ring ahead follows at the budget',()=>{
  const t=new ChunkTracker(index,asset,{maxShowPerUpdate:1,showMarginPx:1e6});
  const b2=t.bounds(chunk('1,1'),2),cam:Rect={x:b2.x+b2.w/2-10,y:b2.y+b2.h/2-10,w:20,h:20};
  for(let i=0;i<4;i++)t.update(cam,0);
  assert.equal(t.visible().length,4,'a huge show margin wants the whole city');
  const on=index.chunks.filter(c=>rectsOverlap(t.bounds(c,2),cam)).map(c=>c.key).sort();
  assert.ok(on.length>=1&&on.length<4,`${on}`);
  const u=t.update(cam,2);
  assert.deepEqual([...u.show].sort(),on,'after the turn: the chunks under the camera, all in one update');
  for(let n=on.length;n<4;n++)assert.equal(t.update(cam,2).show.length,1,'then one per update');
  assert.deepEqual(t.update(cam,2),{show:[],hide:[]});
});

test('ChunkTracker.nearest: of the keys given, the chunk nearest the camera centre in that view; unknown keys skipped',()=>{
  const t=new ChunkTracker(index,asset),b=boundsAll(0);
  const at=(i:number):Rect=>({x:b[i].x+b[i].w/2-5,y:b[i].y+b[i].h/2-5,w:10,h:10});
  const keys=index.chunks.map(c=>c.key);
  index.chunks.forEach((c,i)=>assert.equal(t.nearest(keys,at(i),0),c.key));
  assert.equal(t.nearest([],at(0),0),undefined);
  assert.equal(t.nearest(['nope'],at(0),0),undefined);
  assert.equal(t.nearest(['nope','1,1'],at(0),0),'1,1');
  const b1=t.bounds(chunk('1,0'),1);
  assert.equal(t.nearest(keys,{x:b1.x+b1.w/2-5,y:b1.y+b1.h/2-5,w:10,h:10},1),'1,0','in the view asked for');
});

test('city-layer: a refresh marks the live chunks stale and rebuilds one per frame, nearest first, only on frames with no new chunk',()=>{
  const src=readFileSync(new URL('../../src/client/render/city/city-layer.ts',import.meta.url),'utf8');
  const refresh=src.slice(src.indexOf('  refresh(){'),src.indexOf('  pendingRebuilds()'));
  assert.ok(refresh.includes('this.stale.add(key)')&&!refresh.includes('buildChunk'),'refresh builds nothing itself');
  const update=src.slice(src.indexOf('  update(frame:CityFrame){'),src.indexOf('this.applyOcclusion(frame,view);'));
  assert.match(update,/show\.length\?undefined:this\.tracker\.nearest\(this\.stale,frame\.camera,view\)/);
  assert.match(update,/this\.dropChunk\(old\);this\.buildChunk\(old,view\)/,'the old chunk is swapped in the same frame (no hole)');
  assert.match(src,/this\.live\.delete\(key\);this\.stale\.delete\(key\);/,'a dropped chunk leaves the queue');
  assert.match(src,/groundSettled\(\)\{return this\.stale\.size===0&&/,'the modo foto waits for the rebuilds');
});

test('stepped ruin roofs close every camera-facing step with a wall as tall as the step (no holes)',()=>{
  const ruin={id:'ruin-steps',kind:'building' as const,x:4,y:4,w:4,h:4,height:3,ruined:true};
  const ps=buildChunks({...asset,blocks:[ruin],props:[]}).chunks.flatMap(c=>c.pieces);
  let walls=0;
  for(const v of VIEWS)for(const p of ps){
    const g=pieceGeometry(p,asset,v);
    for(const side of ['n','s','e','w'] as const){
      const drop=p.drops?.[side];
      const facing=viewSide(side,v);
      if(!drop||(facing!=='+x'&&facing!=='+y'))continue;
      // The step wall sits on the seam plane, from the neighbour's top to this piece's top.
      const kind='wallDark';// exposed inside of a broken slab (art bible §4.3)
      const tops=g.faces.filter(f=>f.kind===kind&&f.points.length===4);
      const h=(f:Face)=>Math.max(...f.points.map(q=>q.y))-Math.min(...f.points.map(q=>q.y));
      // A wall one cell wide spans 21·cell px of screen y along its base plus 42 px per unit of height.
      assert.ok(tops.some(f=>Math.abs(h(f)-(drop*42+21*asset.cell))<1e-6),`${p.id} ${side} v${v}`);
      // And it is outlined (closed polyline).
      assert.ok(g.outline.some(l=>l.length===5),`${p.id} ${side} v${v} outlined`);
      walls++;
    }
  }
  assert.ok(walls>0,'the fixture ruin exposes steps');
});

test('the JSON fixture is exactly makeSampleCity() (sandbox and tests use the same city)',()=>{
  const json=JSON.parse(readFileSync(new URL('./fixtures/cidade-mini.json',import.meta.url),'utf8'));
  assert.deepEqual(json,JSON.parse(JSON.stringify(makeSampleCity())),'regenerate with tests/client/fixtures/make-cidade-mini.mjs');
});

test('sample city: no prop stands inside a block',()=>{
  const city=makeSampleCity();
  for(const p of city.props){
    const cx=Math.floor(p.x/city.cell),cy=Math.floor(p.y/city.cell);
    const inside=city.blocks.find(b=>cx>=b.x&&cx<b.x+b.w&&cy>=b.y&&cy<b.y+b.h);
    assert.equal(inside,undefined,`${p.id} inside ${inside?.id}`);
  }
});

test('relief: chunk bounds cover corner heights and props at their groundZ (no early cull on a hill)',()=>{
  const base=makeSampleCity(),W=base.width+1,H=base.height+1;
  // A hill: corner heights rise toward the middle and dip at one corner, beyond the cells' average heights.
  const corners=Array.from({length:W*H},(_,i)=>{const x=i%W,y=Math.floor(i/W);return x===0&&y===0?-3:Math.max(0,4-Math.hypot(x-W/2,y-H/2)*.5);});
  const city=parseCityAsset(JSON.parse(JSON.stringify({...base,corners})));
  for(const c of buildChunks(city).chunks){
    for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++){
      const h=corners[y*W+x];
      assert.ok(h>=c.minBase&&h<=c.maxTop,`chunk ${c.key} corner (${x},${y}) h=${h} in [${c.minBase},${c.maxTop}]`);
    }
  }
  // Without corners the bounds are exactly the old rule: cell heights of the chunk and its ring, and the pieces' tops.
  const flat=parseCityAsset(JSON.parse(JSON.stringify(base)));
  for(const c of buildChunks(flat).chunks){
    let lo=Infinity,hi=-Infinity;
    for(let y=Math.max(0,c.y0-1);y<Math.min(flat.height,c.y1+1);y++)for(let x=Math.max(0,c.x0-1);x<Math.min(flat.width,c.x1+1);x++){
      const h=heightAt(flat,x,y);lo=Math.min(lo,h);hi=Math.max(hi,h);
    }
    for(const p of c.pieces)hi=Math.max(hi,p.base+p.height);
    assert.deepEqual([c.minBase,c.maxTop],[lo,hi],`chunk ${c.key}`);
  }
});

// NEW-20261013-ORQ-cidade-escala-1-7: a chunk keeps about CHUNK_UNITS of world (its baked ground keeps its texel size).
test('cidade-escala-1-7: chunk side follows the cell: 16 cells of 0.88 u, 9 of the 1.7× city\'s 1.496 u',async()=>{
  const {CHUNK_UNITS,chunkCellsFor}=await import('../../src/client/render/city/chunks.ts');
  assert.ok(Math.abs(CHUNK_UNITS-14.08)<1e-9);
  assert.equal(chunkCellsFor(.88),CHUNK_CELLS);assert.equal(chunkCellsFor(1.496),9);
  assert.ok(Math.abs(chunkCellsFor(1.496)*1.496-CHUNK_UNITS)<1,'about the same world size');
  for(const bad of [0,-1,Number.NaN])assert.equal(chunkCellsFor(bad),CHUNK_CELLS);
  assert.equal(index.size,CHUNK_CELLS,'the 0.88 u sample city keeps 16');
  const big=buildChunks({...asset,cell:1.496});
  assert.equal(big.size,9);assert.equal(big.cols,Math.ceil(asset.width/9));
});

/**
 * Telegraph with imported art (NEW-20261012-ORQ-importar-arte-c-completa item 4, D-015): the polygon the renderer draws
 * (telegraph-shape.ts telegraphOutline, the one HordeRenderer fills today) and the textured fill mesh built from it
 * (telegraph-art.ts fillStrip) cover exactly the zone src/rules/telegraph-geometry.ts damages; the dashed border strip
 * (borderStrip) sits on that same polygon, never on a scaled or simplified one; the synthetic fixture passes the importer
 * and reaches the client loader.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {telegraphHits} from '../../src/rules/telegraph-geometry.ts';
import {CIRCLE_SEGMENTS,CONE_SEGMENTS,OUTLINE_MAX_POINTS,coneApertureOf,insetPolygon,telegraphOutline,type Pt,type TelegraphShape}
  from '../../src/client/render/telegraph-shape.ts';
import {TELEGRAPH_BORDER_KEY,TELEGRAPH_FILL_KEY,TELEGRAPH_STRIP_FLOATS,TELEGRAPH_STRIP_POINTS,borderStrip,fillStrip,repeatable,
  stripTriangles,telegraphArtLoads} from '../../src/client/render/telegraph-art.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {importArtV2} from '../../scripts/import-art-v2.mjs';
import {writeDemoTelegraph,DEMO_TELEGRAPH} from '../fixtures/art-v2/demo-telegraph.mjs';

sharp.cache(false);sharp.concurrency(1);
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

/** A telegraph as the server sends it (any direction length) and as the renderer keeps it (unit direction). */
type Case={name:string;shape:'circle'|'line'|'cone';x:number;y:number;radius:number;dx:number;dy:number;width?:number};
const unit=(c:Case):TelegraphShape=>{const l=Math.hypot(c.dx,c.dy);return {...c,dx:c.dx/l,dy:c.dy/l};};
const CASES:Case[]=[
  {name:'circle r1',shape:'circle',x:0,y:0,radius:1,dx:1,dy:0},
  {name:'circle r3.5 off-origin',shape:'circle',x:-4,y:7,radius:3.5,dx:0,dy:1},
  {name:'circle r9',shape:'circle',x:12,y:-3,radius:9,dx:1,dy:1},
  {name:'line default width',shape:'line',x:0,y:0,radius:6,dx:1,dy:0},
  {name:'line w0.4 diagonal',shape:'line',x:2,y:1,radius:5,dx:3,dy:4,width:.4},
  {name:'line w2.5 up-left',shape:'line',x:-1,y:-2,radius:8,dx:-1,dy:2,width:2.5},
  {name:'line w6 short',shape:'line',x:0,y:0,radius:2,dx:0,dy:-1,width:6},
  // D-015: cone width = FULL aperture in radians (hits within ±width/2 of the facing).
  {name:'cone default (π/3)',shape:'cone',x:0,y:0,radius:5,dx:1,dy:0},
  {name:'cone π/6 diagonal',shape:'cone',x:3,y:-2,radius:7,dx:1,dy:1,width:Math.PI/6},
  {name:'cone π/2 (D-015: ±45°)',shape:'cone',x:0,y:0,radius:6,dx:0,dy:1,width:Math.PI/2},
  {name:'cone 2 rad',shape:'cone',x:-2,y:4,radius:4,dx:-3,dy:1,width:2},
  {name:'cone π half disc',shape:'cone',x:0,y:0,radius:5,dx:-1,dy:0,width:Math.PI},
  {name:'cone 1.5π reflex',shape:'cone',x:1,y:1,radius:5,dx:0,dy:-1,width:Math.PI*1.5},
  {name:'cone 2π full',shape:'cone',x:0,y:0,radius:4,dx:1,dy:2,width:Math.PI*2},
];

const outline=(t:TelegraphShape)=>{
  const pts:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
  const n=telegraphOutline(t,1,(i,x,y)=>{pts[i].x=x;pts[i].y=y;});
  return {pts,n};
};
const inPolygon=(pts:readonly Pt[],n:number,x:number,y:number)=>{
  let c=false;for(let i=0,j=n-1;i<n;j=i++){const a=pts[i],b=pts[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)c=!c;}return c;
};
const segDist=(px:number,py:number,ax:number,ay:number,bx:number,by:number)=>{
  const ex=bx-ax,ey=by-ay,l=ex*ex+ey*ey,k=l>0?Math.max(0,Math.min(1,((px-ax)*ex+(py-ay)*ey)/l)):0;
  return Math.hypot(px-ax-ex*k,py-ay-ey*k);
};
const boundaryDist=(pts:readonly Pt[],n:number,x:number,y:number)=>{
  let d=Infinity;for(let i=0;i<n;i++){const a=pts[i],b=pts[(i+1)%n];d=Math.min(d,segDist(x,y,a.x,a.y,b.x,b.y));}return d;
};
const inTriangle=(px:number,py:number,ax:number,ay:number,bx:number,by:number,cx:number,cy:number)=>{
  const s1=(bx-ax)*(py-ay)-(by-ay)*(px-ax),s2=(cx-bx)*(py-by)-(cy-by)*(px-bx),s3=(ax-cx)*(py-cy)-(ay-cy)*(px-cx);
  return (s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0);
};
/** Largest gap between the drawn polygon and the true zone: the sagitta of one arc segment (0 for the line's rectangle). */
const tolerance=(t:TelegraphShape)=>{
  const step=t.shape==='circle'?Math.PI*2/CIRCLE_SEGMENTS:t.shape==='cone'?coneApertureOf(t)/CONE_SEGMENTS:0;
  return t.radius*(1-Math.cos(step/2))+1e-6*Math.max(1,t.radius);
};
const fillMesh=(pts:readonly Pt[],n:number,tile=3)=>{
  const xy=new Float32Array(TELEGRAPH_STRIP_FLOATS),uv=new Float32Array(TELEGRAPH_STRIP_FLOATS);
  const count=fillStrip(pts,n,tile,tile,xy,uv);
  const tris:number[][]=[];stripTriangles(xy,count,(...v)=>tris.push(v));
  return {xy,uv,count,tris};
};

test('the drawn polygon and the textured fill mesh match the server hit test on a grid (circle, line, cone, D-015)',()=>{
  for(const c of CASES){
    const t=unit(c),{pts,n}=outline(t),{tris}=fillMesh(pts,n),eps=tolerance(t);
    const reach=c.radius+(c.width&&c.shape==='line'?c.width:1)+1,steps=90;
    let inside=0,checked=0;
    for(let i=0;i<=steps;i++)for(let j=0;j<=steps;j++){
      const x=c.x-reach+2*reach*i/steps,y=c.y-reach+2*reach*j/steps;
      if(boundaryDist(pts,n,x,y)<=eps)continue; // on the drawn edge: within the arc's chord tolerance
      const hit=telegraphHits(c,{x,y}),poly=inPolygon(pts,n,x,y);
      // Float32 mesh vertices: skip what is within float precision of a triangle edge (still counted by the polygon check).
      const mesh=tris.some(v=>inTriangle(x,y,v[0],v[1],v[2],v[3],v[4],v[5]));
      assert.equal(poly,hit,`${c.name}: polygon vs hit at (${x.toFixed(3)}, ${y.toFixed(3)})`);
      assert.equal(mesh,hit,`${c.name}: fill mesh vs hit at (${x.toFixed(3)}, ${y.toFixed(3)})`);
      checked++;if(hit)inside++;
    }
    assert.ok(inside>50&&checked-inside>50,`${c.name}: ${inside} inside of ${checked}`);
  }
});

test('D-015 edges: just inside the cone aperture / line width is drawn, just outside is not',()=>{
  const d=.02;
  for(const c of CASES){
    const t=unit(c),{pts,n}=outline(t),{tris}=fillMesh(pts,n);
    const meshHas=(x:number,y:number)=>tris.some(v=>inTriangle(x,y,v[0],v[1],v[2],v[3],v[4],v[5]));
    const probe=(x:number,y:number,want:boolean,what:string)=>{
      assert.equal(telegraphHits(c,{x,y}),want,`${c.name}: server ${what}`);
      assert.equal(inPolygon(pts,n,x,y),want,`${c.name}: polygon ${what}`);
      assert.equal(meshHas(x,y),want,`${c.name}: fill mesh ${what}`);
    };
    if(c.shape==='cone'){
      const half=coneApertureOf(t)/2,facing=Math.atan2(t.dy,t.dx),r=c.radius*.6;
      if(half>=Math.PI)continue;
      for(const s of [-1,1]){
        const a=facing+s*(half-d),b=facing+s*(half+d);
        probe(c.x+Math.cos(a)*r,c.y+Math.sin(a)*r,true,`inside at ${s>0?'+':'-'}(width/2 - ${d})`);
        probe(c.x+Math.cos(b)*r,c.y+Math.sin(b)*r,false,`outside at ${s>0?'+':'-'}(width/2 + ${d})`);
      }
    }else if(c.shape==='line'){
      const w=c.width??1,mid=c.radius/2,nx=-t.dy,ny=t.dx,ax=c.x+t.dx*mid,ay=c.y+t.dy*mid;
      for(const s of [-1,1]){
        probe(ax+nx*s*(w/2-d*w),ay+ny*s*(w/2-d*w),true,'inside the width');
        probe(ax+nx*s*(w/2+d*w),ay+ny*s*(w/2+d*w),false,'outside the width');
      }
      probe(c.x+t.dx*(c.radius+d),c.y+t.dy*(c.radius+d),false,'past the end');
    }else{
      probe(c.x+c.radius*(1-d),c.y,true,'inside the radius');
      probe(c.x+c.radius*(1+d),c.y,false,'outside the radius');
    }
  }
});

test('with art the fill mesh is the drawn polygon itself: same vertices, same area, one orientation, UV anchored to the ground',()=>{
  for(const c of CASES){
    const t=unit(c),{pts,n}=outline(t),tile=2.5,{xy,uv,count,tris}=fillMesh(pts,n,tile);
    assert.equal(count,2*n-3,`${c.name}: fan strip size`);
    assert.ok(count<=TELEGRAPH_STRIP_POINTS*2,`${c.name}: fits the Rope`);
    // Every mesh vertex is an outline point (float32), and every outline point is used.
    const used=new Set<number>();
    for(let v=0;v<count;v++){
      const k=pts.slice(0,n).findIndex(p=>Math.fround(p.x)===xy[v*2]&&Math.fround(p.y)===xy[v*2+1]);
      assert.ok(k>=0,`${c.name}: vertex ${v} is not an outline point`);used.add(k);
      assert.ok(Math.abs(uv[v*2]-xy[v*2]/tile)<1e-5&&Math.abs(uv[v*2+1]-xy[v*2+1]/tile)<1e-5,`${c.name}: uv = position / tile`);
    }
    // A full cone repeats its first arc point as its last: identical points count once.
    const distinct=new Set(pts.slice(0,n).map(p=>`${Math.fround(p.x)},${Math.fround(p.y)}`)).size;
    assert.equal(new Set([...used].map(k=>`${Math.fround(pts[k].x)},${Math.fround(pts[k].y)}`)).size,distinct,`${c.name}: every outline point used`);
    let polyArea=0;for(let i=0;i<n;i++){const a=pts[i],b=pts[(i+1)%n];polyArea+=a.x*b.y-b.x*a.y;}polyArea=Math.abs(polyArea)/2;
    let sum=0,pos=0,neg=0;
    for(let i=0;i<tris.length;i++){
      const [ax,ay,bx,by,cx,cy]=tris[i],a=((bx-ax)*(cy-ay)-(by-ay)*(cx-ax))/2;
      sum+=Math.abs(a);
      // The drawn triangles are the fan ones, all at even strip positions (pk, p0, pk+1): one winding when none folds.
      // (A line's fan has float-noise slivers along the sides through p0: no area, no winding.)
      if(Math.abs(a)>1e-6*Math.max(1,polyArea)){if(a>0)pos++;else neg++;}
    }
    assert.ok(Math.abs(sum-polyArea)<=1e-4*Math.max(1,polyArea),`${c.name}: mesh area ${sum} vs polygon ${polyArea}`);
    assert.ok(pos===0||neg===0,`${c.name}: fan triangles do not fold over (${pos}+/${neg}-)`);
    // Padding: zero-area repeats of the last vertex.
    for(let v=count;v<TELEGRAPH_STRIP_POINTS*2;v++)assert.ok(xy[v*2]===xy[(count-1)*2]&&xy[v*2+1]===xy[(count-1)*2+1]);
  }
});

test('with art the dashed border runs on the drawn polygon (outer edge) and today\'s inset band (inner edge), whole tiles',()=>{
  for(const c of CASES){
    const t=unit(c),{pts,n}=outline(t);
    const mid:Pt[]=Array.from({length:OUTLINE_MAX_POINTS},()=>({x:0,y:0}));
    const half=insetPolygon(pts,n,c.radius*.06,mid),aspect=8;
    const xy=new Float32Array(TELEGRAPH_STRIP_FLOATS),uv=new Float32Array(TELEGRAPH_STRIP_FLOATS);
    const count=borderStrip(pts,mid,n,2*half,aspect,xy,uv);
    assert.equal(count,2*(n+1),`${c.name}: closed strip`);
    assert.ok(count<=TELEGRAPH_STRIP_POINTS*2,`${c.name}: fits the Rope`);
    let last=-Infinity;
    for(let k=0;k<=n;k++){
      const o=pts[k%n],m=mid[k%n],a=k*4,b=a+2;
      assert.equal(xy[a],Math.fround(o.x),`${c.name}: outer vertex ${k} = outline point`);
      assert.equal(xy[a+1],Math.fround(o.y));
      assert.ok(Math.abs(xy[b]-(2*m.x-o.x))<1e-4&&Math.abs(xy[b+1]-(2*m.y-o.y))<1e-4,`${c.name}: inner vertex ${k} = outline inset by the full band`);
      // The band is inside the zone (D-015): its inner edge never leaves the drawn polygon.
      assert.ok(inPolygon(pts,n,xy[b],xy[b+1])||boundaryDist(pts,n,xy[b],xy[b+1])<1e-4,`${c.name}: inner vertex ${k} inside`);
      assert.equal(uv[a+1],0);assert.equal(uv[b+1],1);assert.equal(uv[a],uv[b]);
      assert.ok(uv[a]>=last,`${c.name}: U grows along the edge (dashes continue across corners)`);last=uv[a];
    }
    assert.equal(uv[0],0);
    assert.ok(Number.isInteger(uv[n*4])&&uv[n*4]>=1,`${c.name}: the loop closes on a whole tile (${uv[n*4]})`);
    let length=0;for(let i=0;i<n;i++){const a=mid[i],b=mid[(i+1)%n];length+=Math.hypot(b.x-a.x,b.y-a.y);}
    const tile=length/uv[n*4],want=2*half*aspect;
    if(length>2*want)assert.ok(tile>want*2/3&&tile<want*2,`${c.name}: tile ${tile} keeps the strip's aspect (~${want})`);
  }
  const xy=new Float32Array(TELEGRAPH_STRIP_FLOATS),uv=new Float32Array(TELEGRAPH_STRIP_FLOATS);
  const {pts,n}=outline({shape:'circle',x:0,y:0,radius:1,dx:1,dy:0});
  assert.equal(borderStrip(pts,pts,n,0,8,xy,uv),0,'no band, nothing drawn');
  assert.equal(fillStrip(pts,2,1,1,xy,uv),0,'degenerate polygon, nothing drawn');
});

test('the renderer feeds the art the very buffers it draws today (no scaled or simplified copy)',()=>{
  const src=readFileSync(path.join(repoRoot,'src/client/render/layers.ts'),'utf8');
  assert.match(src,/fillStrip\(this\.pts,n,/,'fill mesh from this.pts (the outline filled and hatched today)');
  assert.match(src,/borderStrip\(this\.pts,this\.ptsIn,n,2\*half,/,'border from this.pts and today\'s inset this.ptsIn');
  // Same n: both run after `n=this.outline(t,1)` and before any other outline call of that telegraph.
  const body=src.slice(src.indexOf('private drawTelegraph='),src.indexOf('private drawTelegraphs('));
  const full=body.lastIndexOf('n=this.outline(t,1)');
  assert.ok(full>0&&body.indexOf('drawFillArt(',full)>full&&body.indexOf('drawBorderArt(',full)>full);
  assert.equal(body.indexOf('this.outline(',full+'n=this.outline(t,1)'.length),-1,'no other outline after the full one');
});

test('loads: nothing with an empty manifest; the two pieces when present; a cell that cannot tile stays procedural',()=>{
  try{
    setArtIndex(parseArtIndex({version:2,groups:{}}));
    assert.deepEqual(telegraphArtLoads(),[]);
    const file=(f:string,cell:[number,number])=>({kind:'seamless',files:{sheet:{file:f,cell,frames:1}}});
    setArtIndex(parseArtIndex({version:2,groups:{efeitos:{output:'public/art/fx',pieces:{
      'telegraph-enchimento':file('telegraph-enchimento.webp',[128,128]),'telegraph-borda':file('telegraph-borda.webp',[128,16])}}}}));
    assert.deepEqual(telegraphArtLoads().map(l=>[l.key,l.url]),[
      [TELEGRAPH_FILL_KEY,'/art/fx/telegraph-enchimento.webp'],[TELEGRAPH_BORDER_KEY,'/art/fx/telegraph-borda.webp']]);
    setArtIndex(parseArtIndex({version:2,groups:{efeitos:{output:'public/art/fx',pieces:{'telegraph-borda':file('telegraph-borda.webp',[120,16])}}}}));
    assert.deepEqual(telegraphArtLoads(),[]);
    assert.ok(repeatable(128,16)&&repeatable(128,128)&&!repeatable(120,16)&&!repeatable(0,16));
  }finally{setArtIndex(parseArtIndex({version:2,groups:{}}));}
});

test('the synthetic telegraph fixture passes the importer and reaches the client loader',async()=>{
  const input=mkdtempSync(path.join(tmpdir(),'tg-art-in-')),outRoot=mkdtempSync(path.join(tmpdir(),'tg-art-out-'));
  try{
    await writeDemoTelegraph(input);
    const dry=await importArtV2({input,repoRoot,outRoot,groups:['efeitos'],write:false}) as {pieces:{id:string;status:string;problems:string[]}[]};
    for(const id of DEMO_TELEGRAPH.efeitos){
      const p=dry.pieces.find(x=>x.id===id);
      assert.equal(p?.status,'aprovado',`${id}: ${p?.problems.join(' | ')}`);
    }
    await importArtV2({input,repoRoot,outRoot,groups:['efeitos'],write:true});
    setArtIndex(parseArtIndex(JSON.parse(readFileSync(path.join(outRoot,'public/art/manifest.json'),'utf8'))));
    assert.deepEqual(telegraphArtLoads().map(l=>[l.key,l.cell]),[[TELEGRAPH_FILL_KEY,[128,128]],[TELEGRAPH_BORDER_KEY,[128,16]]]);
  }finally{
    setArtIndex(parseArtIndex({version:2,groups:{}}));
    rmSync(input,{recursive:true,force:true});rmSync(outRoot,{recursive:true,force:true});
  }
});

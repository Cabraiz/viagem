// cidade-03a · building see-through: covers/isBehind in all 4 views, silhouette hull, fade timing, fader map, hero draw order.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {BlockKind,CityAsset,CityBlock} from '../../src/client/render/city/asset.ts';
import {type Pt,VIEW_PIVOT,depth,project,unrotate} from '../../src/client/render/city/projection.ts';
import {FADE_ALPHA,FADE_MS,HERO_SCREEN,HOLD_MS,OUTLINE_FADE_ALPHA,CoverFader,type ColumnRef,type Occluder,covers,coveringColumns,heroRect,
  heroRelativeDepth,actorDepth,isBehind,occluderFor,outlineAlpha,propCovers,rectHitsConvex,stepAlpha} from '../../src/client/render/city/occlusion.ts';

const VIEWS=[0,1,2,3] as const;
const PIVOTS:Pt[]=[VIEW_PIVOT,{x:5.3,y:-2}];
const CELL=0.88;
const asset:CityAsset={version:1,name:'occ',cell:CELL,width:32,height:32,origin:{x:0,y:0},heights:new Array(1024).fill(0),
  ground:'s'.repeat(1024),blocks:[],props:[],points:{}};
const block=(id:string,kind:BlockKind,height:number,x=12,y=12,w=4,h=4):CityBlock=>({id,kind,x,y,w,h,height});
/** World point for a view-space point (inverse of viewPoint). */
const worldOf=(qx:number,qy:number,view:number,pivot:Pt)=>{const w=unrotate(qx-pivot.x,qy-pivot.y,view);return {x:w.x+pivot.x,y:w.y+pivot.y};};
/** Hero at ground level, placed by view-space coordinates relative to the occluder. */
const heroAt=(qx:number,qy:number,view:number,pivot:Pt)=>({...worldOf(qx,qy,view,pivot),z:0});
const each=(fn:(view:number,pivot:Pt)=>void)=>{for(const p of PIVOTS)for(const v of VIEWS)fn(v,p);};

test('tall building: behind covers, in front / far lateral / inside / front edge do not (all views)',()=>{
  each((v,p)=>{
    const o=occluderFor(block('b','building',3.5),asset,0,v,p),{x0,x1,y0,y1}=o.q;
    const mx=(x0+x1)/2,my=(y0+y1)/2,tag=`view ${v} pivot ${p.x}`;
    assert.ok(Math.abs(x1-x0-4*CELL)<1e-9&&Math.abs(y1-y0-4*CELL)<1e-9,tag);
    const cases:[string,{x:number;y:number;z:number},boolean][]=[
      ['just behind (back y)',heroAt(mx,y0-0.2,v,p),true],
      ['just behind (back x)',heroAt(x0-0.2,my,v,p),true],
      ['just in front (front y)',heroAt(mx,y1+0.2,v,p),false],
      ['just in front (front x)',heroAt(x1+0.2,my,v,p),false],
      ['far lateral',heroAt(x0-10,my,v,p),false],
      ['far lateral other side',heroAt(mx,y0-10,v,p),false],
      ['inside footprint',heroAt(mx,my,v,p),false],
      ['on front edge y',heroAt(mx,y1,v,p),false],
      ['on front edge x',heroAt(x1,my,v,p),false],
      ['on front corner',heroAt(x1,y1,v,p),false],
    ];
    for(const [name,h,want] of cases)assert.equal(covers(o,h,v,p),want,`${name} ${tag}`);
    // Far lateral is still "behind" by the box rule; only the silhouette test rejects it.
    const far=heroAt(x0-10,my,v,p);
    assert.equal(isBehind(o,far.x,far.y,v,p),true,tag);
    const inside=heroAt(mx,my,v,p);
    assert.equal(isBehind(o,inside.x,inside.y,v,p),false,tag);
  });
});

test('low rubble 1-2 cells in front of the hero stays below the hero box; a 3.5 u building there covers',()=>{
  each((v,p)=>{
    const rub=occluderFor(block('r','rubble',0.3,12,12,2,2),asset,0,v,p),tall=occluderFor(block('t','building',3.5,12,12,2,2),asset,0,v,p);
    // Behind the back corner along the view diagonal, so the hero is straight above the block on screen.
    for(const d of [CELL,2*CELL]){
      const tag=`view ${v} pivot ${p.x} d ${d}`,h=heroAt(rub.q.x0-d,rub.q.y0-d,v,p);
      assert.equal(isBehind(rub,h.x,h.y,v,p),true,tag);
      const r=heroRect(h.x,h.y,h.z,v,p),c=project(h.x,h.y,0,v,p),s=rub.silhouette;
      assert.ok(Math.min(...s.map(q=>q.x))<c.x&&c.x<Math.max(...s.map(q=>q.x)),`hero over the block on screen ${tag}`);
      assert.ok(Math.min(...s.map(q=>q.y))>r.y+r.h,`rubble silhouette below hero feet ${tag}`);
      assert.equal(covers(rub,h,v,p),false,tag);
      assert.equal(covers(tall,h,v,p),true,tag);
    }
  });
});

test('heroRect: w wide centred on the feet, h px upward; base height raises the occluder',()=>{
  const f=project(3,4,0.5,1),r=heroRect(3,4,0.5,1);
  assert.deepEqual(r,{x:f.x-HERO_SCREEN.w/2,y:f.y-HERO_SCREEN.h,w:HERO_SCREEN.w,h:HERO_SCREEN.h});
  assert.deepEqual(heroRect(3,4,0,0,VIEW_PIVOT,{w:10,h:20}).w,10);
  const o=occluderFor(block('b','building',2),asset,1.5,0);
  assert.equal(o.base,1.5);assert.equal(o.top,3.5);assert.equal(o.kind,'building');assert.equal(o.id,'b');
});

test('silhouette is convex, consistently wound and contains all 8 projected corners',()=>{
  each((v,p)=>{
    for(const [w,h,height,base] of [[4,4,3.5,0],[1,6,1.2,0.3],[7,2,0.25,0],[3,5,2.4,1]]){
      const b=block('b','building',height,10,11,w,h),o=occluderFor(b,asset,base,v,p),s=o.silhouette;
      assert.ok(s.length>=4,`hull size ${s.length}`);
      const signs=new Set<number>();
      for(let i=0;i<s.length;i++){
        const a=s[i],c=s[(i+1)%s.length],d=s[(i+2)%s.length];
        const cr=(c.x-a.x)*(d.y-c.y)-(c.y-a.y)*(d.x-c.x);
        assert.ok(Math.abs(cr)>1e-9,'no collinear vertices');signs.add(Math.sign(cr));
      }
      assert.equal(signs.size,1,'convex, one winding');
      const sign=[...signs][0];
      const x0=b.x*CELL,y0=b.y*CELL,x1=x0+w*CELL,y1=y0+h*CELL;
      for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]])for(const z of [base,base+height]){
        const c=project(x,y,z,v,p);
        for(let i=0;i<s.length;i++){
          const a=s[i],d=s[(i+1)%s.length];
          assert.ok(sign*((d.x-a.x)*(c.y-a.y)-(d.y-a.y)*(c.x-a.x))>=-1e-6,`corner inside hull view ${v}`);
        }
      }
    }
  });
});

test('stepAlpha: 1 -> FADE_ALPHA in exactly FADE_MS, monotonic, no overshoot, bad dt ignored',()=>{
  assert.equal(stepAlpha(1,FADE_ALPHA,FADE_MS),FADE_ALPHA);
  assert.ok(stepAlpha(1,FADE_ALPHA,FADE_MS-1)>FADE_ALPHA,'not there before FADE_MS');
  assert.equal(stepAlpha(FADE_ALPHA,1,FADE_MS),1);
  let a=1,prev=1,t=0;
  while(a>FADE_ALPHA){a=stepAlpha(a,FADE_ALPHA,7);t+=7;assert.ok(a<prev&&a>=FADE_ALPHA);prev=a;}
  assert.ok(t>=FADE_MS&&t<FADE_MS+7);
  assert.equal(stepAlpha(1,FADE_ALPHA,1e6),FADE_ALPHA);
  assert.equal(stepAlpha(FADE_ALPHA,1,1e6),1);
  assert.equal(stepAlpha(0.5,0.5,16),0.5);
  for(const dt of [NaN,Infinity,-Infinity,-5])assert.equal(stepAlpha(0.7,FADE_ALPHA,dt),0.7);
  assert.equal(stepAlpha(1,FADE_ALPHA,0),1);
  assert.equal(stepAlpha(1,FADE_ALPHA,10,0),FADE_ALPHA,'fadeMs 0 snaps');
  assert.ok(Math.abs(stepAlpha(1,FADE_ALPHA,30,60)-(1-0.65/2))<1e-12,'custom fadeMs');
});

test('outlineAlpha maps 1 -> 1 and FADE_ALPHA -> OUTLINE_FADE_ALPHA linearly',()=>{
  assert.equal(outlineAlpha(1),1);
  assert.ok(Math.abs(outlineAlpha(FADE_ALPHA)-OUTLINE_FADE_ALPHA)<1e-12);
  const mid=(1+FADE_ALPHA)/2;
  assert.ok(Math.abs(outlineAlpha(mid)-(1+OUTLINE_FADE_ALPHA)/2)<1e-12);
  assert.ok(outlineAlpha(FADE_ALPHA)>FADE_ALPHA);
});

test('CoverFader: ~150 ms fade in, holds while covered, HOLD_MS grace, ~150 ms back, then dropped; bad dt keeps state',()=>{
  assert.ok(FADE_MS>=120&&FADE_MS<=180,'about 150 ms');
  const f=new CoverFader(),on=new Set(['k']),off=new Set<string>();
  let prev=1,frames=0;
  while(f.alpha('k')>FADE_ALPHA){
    const m=f.update(on,16);frames++;
    const a=m.get('k')!;assert.ok(a<prev&&a>=FADE_ALPHA);prev=a;
  }
  assert.equal(frames,Math.ceil(FADE_MS/16));
  assert.equal(f.update(on,16).get('k'),FADE_ALPHA,'holds while covering');
  // Uncovered: stays faded for HOLD_MS (no flicker on a wall's edge), then eases back and is dropped.
  let held=0;
  while(f.update(off,16).get('k')===FADE_ALPHA)held+=16;
  assert.ok(held>=HOLD_MS-16&&held<=HOLD_MS,`held ${held} ms`);
  prev=f.alpha('k');frames=1;
  for(;;){
    const m=f.update(off,16);frames++;
    if(!m.has('k'))break;
    const a=m.get('k')!;assert.ok(a>prev&&a<1);prev=a;
  }
  assert.ok(frames<=Math.ceil(FADE_MS/16)+1);assert.equal(f.alpha('k'),1);
  // Flicker guard: covered every other frame never eases back.
  const g=new CoverFader();
  for(let i=0;i<60;i++){const m=g.update(i%2?off:on,16);if(i>12)assert.equal(m.get('k'),FADE_ALPHA,`frame ${i}`);}
  // Bad dt changes nothing; reset clears.
  const a=g.alpha('k');
  for(const dt of [NaN,-3,Infinity])g.update(off,dt);
  assert.equal(g.alpha('k'),a);
  g.reset();assert.equal(g.alpha('k'),1);
  // Several ids are independent.
  const h=new CoverFader();h.update(new Set(['a','b']),16);const m=h.update(new Set(['a']),16);
  assert.ok(m.has('a')&&m.has('b'));
});

/** Unit columns of a block as the layer registers them: one occluder per cell, fade id per band (block, depth key). */
const unitColumns=(b:CityBlock,v:number,p:Pt):ColumnRef[]=>{
  const out:ColumnRef[]=[];
  for(let j=b.y;j<b.y+b.h;j++)for(let i=b.x;i<b.x+b.w;i++){
    const occ=occluderFor({id:`${b.id}:${i},${j}`,kind:b.kind,x:i,y:j,w:1,h:1,height:b.height},asset,0,v,p);
    const c=depth((i+.5)*CELL,(j+.5)*CELL,v,p);
    out.push({key:c,occ,fade:`b:${b.id}|${c.toFixed(3)}`});
  }
  return out;
};

test('coveringColumns: every kind (wall, cliff lip, rubble, building) fades only the bands in front of the figure, for hero and allies (all views)',()=>{
  each((v,p)=>{
    const tag=`view ${v} pivot ${p.x}`;
    for(const kind of ['wall','building','cliff','rubble'] as BlockKind[]){
      // A long wall-like block (12 × 2 cells); a figure just behind its middle.
      const b=block('w',kind,kind==='wall'?1.6:kind==='building'?3.5:kind==='cliff'?1.2:1,6,12,12,2);
      const whole=occluderFor(b,asset,0,v,p),{x0,x1,y0,y1}=whole.q;
      const behind=heroAt((x0+x1)/2,y0-0.25,v,p),front=heroAt((x0+x1)/2,y1+0.6,v,p);
      const cols=unitColumns(b,v,p);
      const hit=coveringColumns(cols,behind,v,new Set(),p);
      assert.ok(hit.size>0,`${kind} behind: some band fades ${tag}`);
      const bands=new Set(cols.map(c=>c.fade!));
      assert.ok(hit.size<bands.size,`${kind}: not the whole block (${hit.size}/${bands.size}) ${tag}`);
      // Exactly the columns drawn above the figure and over its box (the actorDepth rule).
      const r=heroRect(behind.x,behind.y,behind.z,v,p);
      for(const c of cols){
        const over=rectHitsConvex(r,c.occ.silhouette)&&isBehind(c.occ,behind.x,behind.y,v,p);
        if(over)assert.ok(hit.has(c.fade!),`${kind} covering column ${c.occ.id} fades ${tag}`);
      }
      for(const id of hit)assert.ok(cols.some(c=>c.fade===id&&rectHitsConvex(r,c.occ.silhouette)&&isBehind(c.occ,behind.x,behind.y,v,p)));
      // In front of the block: nothing fades.
      assert.equal(coveringColumns(cols,front,v,new Set(),p).size,0,`${kind} in front ${tag}`);
      // An ally behind it fades the same bands as a hero there would; two figures add up.
      const both=coveringColumns(cols,front,v,coveringColumns(cols,behind,v,new Set(),p),p);
      assert.deepEqual([...both].sort(),[...hit].sort());
    }
    // `cover` (an art lot's real sheet height) replaces occ for the test: a short ruin sheet does not fade.
    const lot=block('lot','building',3.5,10,10,2,2),tall=occluderFor(lot,asset,0,v,p),short=occluderFor({...lot,height:0.3},asset,0,v,p);
    const {x0,x1,y0}=tall.q,fig=heroAt((x0+x1)/2,y0-0.8,v,p);
    assert.equal(coveringColumns([{key:0,occ:tall,fade:'l'}],fig,v,new Set(),p).size,1,tag);
    assert.equal(coveringColumns([{key:0,occ:tall,fade:'l',cover:short}],fig,v,new Set(),p).size,0,tag);
    assert.equal(coveringColumns([{key:0,occ:tall}],fig,v,new Set(),p).size,0,'no fade id, skipped');
  });
});

test('propCovers: a tall prop fades only when drawn in front of the figure and over its box (all views)',()=>{
  each((v,p)=>{
    const pine={x:12,y:12};
    const at=project(pine.x,pine.y,0,v,p),rect={x:at.x-40,y:at.y-170,w:80,h:170};
    // A figure 0.5 u straight behind the pine (smaller depth, same screen column) is covered; one in front is not.
    let behind:{x:number;y:number;z:number}|undefined,front:{x:number;y:number;z:number}|undefined;
    for(const [dx,dy] of [[-.5,-.5],[.5,-.5],[-.5,.5],[.5,.5]]){
      const f={x:pine.x+dx,y:pine.y+dy,z:0},d=depth(f.x,f.y,v,p)-depth(pine.x,pine.y,v,p);
      if(d<-1e-9)behind=f;else if(d>1e-9)front=f;
    }
    assert.ok(behind&&front);
    assert.equal(propCovers({...pine,rect},behind!,v,p),true,`view ${v}`);
    assert.equal(propCovers({...pine,rect},front!,v,p),false,`view ${v}`);
    assert.equal(propCovers({...pine,rect:{x:rect.x+500,y:rect.y,w:80,h:170}},behind!,v,p),false,'far on screen');
  });
});

test('heroRelativeDepth: only where the hero overlaps the block; then behind -> above hero, in front -> below (all views)',()=>{
  each((v,p)=>{
    const o:Occluder=occluderFor(block('b','building',3),asset,0,v,p),{x0,x1,y0,y1}=o.q,tag=`view ${v} pivot ${p.x}`;
    const front=(x1+y1)*100,back=(x0+y0)*100,center=((x0+x1)/2+(y0+y1)/2)*100;
    const samples:[number,number][]=[];
    for(let qx=x0-2;qx<=x1+2;qx+=0.37)for(let qy=y0-2;qy<=y1+2;qy+=0.41)samples.push([qx,qy]);
    samples.push([x1,(y0+y1)/2],[(x0+x1)/2,y1],[x1,y1],[x0,y0]);
    for(const [qx,qy] of samples){
      const h=worldOf(qx,qy,v,p),hd=depth(h.x,h.y,v,p),behind=isBehind(o,h.x,h.y,v,p);
      const overlap=rectHitsConvex(heroRect(h.x,h.y,0,v,p),o.silhouette);
      for(const bd of [front,back,center,hd]){
        const r=heroRelativeDepth(o,bd,hd,{x:h.x,y:h.y,z:0},v,p);
        if(!overlap){assert.equal(r,bd,'no overlap: block keeps its own key');continue;}
        assert.equal(r>hd,behind,`q=(${qx.toFixed(2)},${qy.toFixed(2)}) key ${bd} ${tag}`);
        if(behind?bd>hd:bd<hd)assert.equal(r,bd,'already right: unchanged');
      }
    }
    // Explicit: just behind the back face with a back-corner key gets lifted above the hero.
    const hb=worldOf(x1-0.1,y0-0.1,v,p),hdb=depth(hb.x,hb.y,v,p);
    assert.ok(back<=hdb);assert.equal(heroRelativeDepth(o,back,hdb,{x:hb.x,y:hb.y,z:0},v,p),hdb+1);
    // Just in front of the front face with a front-corner key gets pushed below the hero.
    const hf=worldOf(x0-0.5,y1+0.1,v,p),hdf=depth(hf.x,hf.y,v,p);
    assert.ok(front>=hdf);assert.equal(heroRelativeDepth(o,front,hdf,{x:hf.x,y:hf.y,z:0},v,p),hdf-1);
  });
});

test('fixture: some building of cidade-mini covers a hero placed behind it',async()=>{
  const {readFileSync}=await import('node:fs');
  const {parseCityAsset,heightAt}=await import('../../src/client/render/city/asset.ts');
  const a=parseCityAsset(JSON.parse(readFileSync(new URL('./fixtures/cidade-mini.json',import.meta.url),'utf8')));
  const b=a.blocks.find(x=>x.kind==='building'&&x.height>=2);
  assert.ok(b,'fixture has a building');
  each((v,p)=>{
    const o=occluderFor(b,a,heightAt(a,b.x,b.y),v,p),{x0,x1,y0}=o.q;
    const h={...worldOf((x0+x1)/2,y0-0.2,v,p),z:o.base};
    assert.equal(covers(o,h,v,p),true,`view ${v}`);
  });
});

test('actorDepth: actors ≥ 0.22 u from blocks are never drawn on the wrong side of a column they overlap (all views)',async()=>{
  const {buildChunks}=await import('../../src/client/render/city/chunks.ts');
  const {pieceGeometry}=await import('../../src/client/render/city/faces.ts');
  const city:CityAsset={...asset,blocks:[block('a','building',3.5,10,10,3,5),block('w','wall',1.6,14,9,6,1),block('d','building',2,13,13,2,2)]};
  const cols=buildChunks(city).chunks.flatMap(c=>c.pieces),cell=city.cell;
  const clear=(x:number,y:number)=>city.blocks.every(b=>Math.hypot(Math.max(b.x*cell-x,0,x-(b.x+b.w)*cell),Math.max(b.y*cell-y,0,y-(b.y+b.h)*cell))>=0.22);
  let checked=0,adjusted=0;
  for(const v of [0,1,2,3]){
    const refs=cols.map(p=>({key:pieceGeometry(p,city,v).depthKey,occ:occluderFor({id:p.id,kind:p.kind,x:p.x,y:p.y,w:1,h:1,height:p.height},city,p.base,v)}));
    for(let x=7;x<=19;x+=0.17)for(let y=7;y<=19;y+=0.13){
      if(!clear(x,y))continue;
      const d=actorDepth(x,y,0,v,refs),rect=heroRect(x,y,0,v);
      if(d!==depth(x,y,v))adjusted++;
      for(const c of refs){
        if(!rectHitsConvex(rect,c.occ.silhouette))continue;
        assert.equal(c.key>d,isBehind(c.occ,x,y,v),`view ${v} actor (${x.toFixed(2)},${y.toFixed(2)}) column ${c.occ.id}`);
        checked++;
      }
    }
  }
  assert.ok(checked>5000,`${checked} overlapping actor/column pairs`);
  assert.ok(adjusted>0&&adjusted<checked/10,`${adjusted} actors nudged (the centre key alone is right for most)`);
  // Far from every column the actor keeps its own world depth.
  assert.equal(actorDepth(2,2,0,0,[]),depth(2,2,0));
});

test('actorDepth insideBehind (effects in the air, render/towers): inside the footprint sorts below the building, in front/behind unchanged (all views)',()=>{
  each((v,p)=>{
    const tag=`view ${v} pivot ${p.x}`,b=block('e','building',3.5),occ=occluderFor(b,asset,0,v,p),{x0,x1,y0,y1}=occ.q;
    const key=depth((b.x+b.w/2)*CELL,(b.y+b.h/2)*CELL,v,p),cols:ColumnRef[]=[{key,occ}];
    const at=(qx:number,qy:number)=>{const w=worldOf(qx,qy,v,p);return [actorDepth(w.x,w.y,0,v,cols,p),actorDepth(w.x,w.y,0,v,cols,p,HERO_SCREEN,true)] as const;};
    const [inActor,inEffect]=at((x0+x1)/2,(y0+y1)/2);
    assert.ok(inActor>key,`${tag}: an actor inside stays above (unchanged)`);
    assert.ok(inEffect<key,`${tag}: an effect over the footprint is covered by the building`);
    const [frontA,frontE]=at(x1+.3,(y0+y1)/2);assert.ok(frontA>key&&frontE>key,`${tag}: in front, both above`);
    const [backA,backE]=at(x0-.3,(y0+y1)/2);assert.ok(backA<key&&backE<key,`${tag}: behind, both below`);
  });
});

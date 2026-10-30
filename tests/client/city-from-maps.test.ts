import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CityTerrain,decodeCityAsset,type CityAsset as MapsCityAsset} from '../../src/maps/index.ts';
import {parseCityAsset,type CityAsset} from '../../src/client/render/city/asset.ts';
import {HEIGHT_PX} from '../../src/client/render/city/projection.ts';
import {
  AVENUE_HALF_WIDTH_CELLS,BUILDING_HEIGHT_MAX,BUILDING_HEIGHT_MIN,CLIFF_LIP_HEIGHT,EDGE_HEIGHT,PLAZA_PAD_CELLS,PROP_DEDUP,PROP_STACK,PROP_R_MAX,PROP_R_MIN,
  RUBBLE_HEIGHT,WALKABLE_MIN_SAMPLES,WALL_HEIGHT,WATER_MIN_SAMPLES,cityRenderAsset,leftoverWallLines,
} from '../../src/client/render/city/from-maps.ts';
import {CITY_MAP_SCALE} from '../../src/rules/index.ts';
import {WALL_FAMILIES,wallLines} from '../../src/maps/city-decor.ts';

const decoded=decodeCityAsset(readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const maps:MapsCityAsset=decoded.asset;
const city:CityAsset=cityRenderAsset(maps);
const W=city.width,H=city.height,CELL=city.cell;
/** NEW-20261013-ORQ-cidade-escala-1-7: the asset (version 2) is the .w3x map × K; map lengths and block heights below are × K. */
const K=CITY_MAP_SCALE;
/** Spots of the .w3x map on asset v4 (NEW-20261023-ORQ-mapa-175-com-viaduto): × K, then the compaction's 192 → 110 cells. */
const AT=K*110/192;

/** Deterministic LCG in [0,1). */
const rng=(seed:number)=>()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/0x100000000);
/** Which render blocks cover each cell (index into city.blocks, -1 = none). */
const coverOf=(()=>{
  const out=new Int32Array(W*H).fill(-1);
  city.blocks.forEach((b,k)=>{for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)out[y*W+x]=k;});
  return out;
})();
const letter=(cx:number,cy:number)=>city.ground[cy*W+cx];
const samplesIn=(cx:number,cy:number,fn:(sx:number,sy:number)=>boolean)=>{
  let n=0;
  for(let j=0;j<4;j++)for(let i=0;i<4;i++)if(fn(cx*4+i,cy*4+j))n++;
  return n;
};

test('grid: same cells, 1.496 u (0.88 × K) per cell, origin at the NW corner like the maps asset and the terrain',()=>{
  assert.equal(W,maps.cells.w);assert.equal(H,maps.cells.h);
  assert.equal(CELL,maps.unitsPerCell);assert.equal(CELL,1.496);assert.equal(K,1.7);
  assert.deepEqual(city.origin,{x:0,y:0});
  assert.equal(city.heights.length,W*H);assert.equal(city.ground.length,W*H);
  assert.equal(city.corners?.length,(W+1)*(H+1));
});

test('heights: the render ground (bilinear of the corners × HEIGHT_PX) sits exactly where the terrain puts actors',()=>{
  const terrain=new CityTerrain(maps,'0'.repeat(64));
  const corners=city.corners!,hw=W+1;
  const ground=(x:number,y:number)=>{
    const fx=x/CELL,fy=y/CELL,cx=Math.min(W-1,Math.floor(fx)),cy=Math.min(H-1,Math.floor(fy)),tx=fx-cx,ty=fy-cy,i=cy*hw+cx;
    const top=corners[i]+(corners[i+1]-corners[i])*tx,bottom=corners[i+hw]+(corners[i+hw+1]-corners[i+hw])*tx;
    return (top+(bottom-top)*ty)*HEIGHT_PX;
  };
  const r=rng(7);
  let worst=0;
  for(let k=0;k<20000;k++){
    const x=r()*W*CELL,y=r()*H*CELL;
    worst=Math.max(worst,Math.abs(ground(x,y)-terrain.height(x,y)));
  }
  // Exactly on corners too.
  for(let k=0;k<2000;k++){
    const hx=Math.floor(r()*W),hy=Math.floor(r()*H);
    worst=Math.max(worst,Math.abs(ground(hx*CELL,hy*CELL)-terrain.height(hx*CELL,hy*CELL)));
  }
  assert.ok(worst<1e-6,`worst mismatch ${worst} px`);
  assert.equal(Math.min(...corners),0,'the lowest corner is the terrain zero');
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){
    const i=cy*hw+cx,mean=(corners[i]+corners[i+1]+corners[i+hw]+corners[i+hw+1])/4;
    assert.ok(Math.abs(city.heights[cy*W+cx]-mean)<1e-12);
  }
});

test('heights: an explicit terrainMinHeight shifts the ground by (min - given) * 21 / 42',()=>{
  let min=Infinity;
  for(let y=0;y<maps.heightGrid.h;y++)for(let x=0;x<maps.heightGrid.w;x++)min=Math.min(min,maps.height(x,y));
  assert.deepEqual(cityRenderAsset(maps,min).corners,city.corners);
  const lower=cityRenderAsset(maps,min-2).corners!;
  for(let i=0;i<lower.length;i+=97)assert.ok(Math.abs(lower[i]-city.corners![i]-1)<1e-9);
});

test('blocks: every rect is covered exactly by render blocks of its group (cells whose centre is inside it)',()=>{
  const EPS=1e-3;
  const byGroup=new Map<string,CityAsset['blocks']>();
  for(const b of city.blocks){
    assert.ok(b.group,`${b.id} has a group`);
    assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=W&&b.y+b.h<=H&&b.w>0&&b.h>0,`${b.id} inside the grid and not empty`);
    assert.ok(Number.isInteger(b.x)&&Number.isInteger(b.y)&&Number.isInteger(b.w)&&Number.isInteger(b.h));
    const list=byGroup.get(b.group!)??[];list.push(b);byGroup.set(b.group!,list);
  }
  for(const src of maps.blocks){
    const mine=byGroup.get(src.id)??[];
    for(const b of mine)assert.match(b.id,new RegExp(`^${src.id}#r\\d+$`));
    const covered=new Set<number>();
    for(const b of mine)for(let y=b.y;y<b.y+b.h;y++)for(let x=b.x;x<b.x+b.w;x++)covered.add(y*W+x);
    // Cells whose centre lies inside a rect (cell units), strictly or within EPS of its border.
    const inside=(cx:number,cy:number,eps:number)=>src.rects.some(([x,y,w,h])=>{
      const px=cx+.5,py=cy+.5,x0=x/CELL,y0=y/CELL,x1=(x+w)/CELL,y1=(y+h)/CELL;
      return px>x0+eps&&px<x1-eps&&py>y0+eps&&py<y1-eps;
    });
    for(const [x,y,w,h] of src.rects){
      for(let cy=Math.max(0,Math.floor(y/CELL));cy<Math.min(H,Math.ceil((y+h)/CELL));cy++)
        for(let cx=Math.max(0,Math.floor(x/CELL));cx<Math.min(W,Math.ceil((x+w)/CELL));cx++)
          if(inside(cx,cy,EPS))assert.ok(covered.has(cy*W+cx),`${src.id}: cell ${cx},${cy} is inside a rect but not drawn`);
    }
    for(const i of covered)assert.ok(inside(i%W,Math.floor(i/W),-EPS),`${src.id}: cell ${i%W},${Math.floor(i/W)} drawn outside its rects`);
  }
});

test('blocks: kinds and heights follow the rules; ~60% of buildings are ruined, the same on all their rects',()=>{
  const srcKind=new Map(maps.blocks.map(b=>[b.id,b.kind]));
  const groups=new Map<string,{height:number;ruined:boolean}>();
  for(const b of city.blocks){
    const kind=srcKind.get(b.group!);
    assert.ok(kind,`${b.id} comes from a maps block`);
    if(kind==='building'){
      assert.equal(b.kind,'building');
      assert.ok(b.height>=BUILDING_HEIGHT_MIN&&b.height<=BUILDING_HEIGHT_MAX,`${b.id} height ${b.height}`);
      const seen=groups.get(b.group!);
      if(seen)assert.deepEqual(seen,{height:b.height,ruined:!!b.ruined},`${b.id} matches its group`);
      else groups.set(b.group!,{height:b.height,ruined:!!b.ruined});
    }else{
      assert.equal(b.ruined,undefined,`${b.id}: only buildings are ruined`);
      const want={wall:['wall',WALL_HEIGHT],edge:['wall',EDGE_HEIGHT],cliff:['cliff',CLIFF_LIP_HEIGHT],rubble:['rubble',RUBBLE_HEIGHT]}[kind!]!;
      assert.deepEqual([b.kind,b.height],want,b.id);
    }
  }
  const all=[...groups.values()],ruined=all.filter(g=>g.ruined).length;
  assert.ok(all.length>=20,`${all.length} buildings drawn`);
  assert.ok(ruined/all.length>0.35&&ruined/all.length<0.85,`${ruined}/${all.length} ruined`);
  assert.ok(new Set(all.map(g=>g.height)).size>5,'building heights vary');
  // Art bible limits at the .w3x scale (1.6 / 0.3), × K for the 1.7× blocks; the lip stays low.
  assert.ok(WALL_HEIGHT<=1.6*K+1e-9&&CLIFF_LIP_HEIGHT<=1.6&&RUBBLE_HEIGHT<=0.3*K+1e-9,'art bible limits');
  assert.equal(BUILDING_HEIGHT_MIN,3.74);assert.equal(BUILDING_HEIGHT_MAX,6.46);assert.equal(WALL_HEIGHT,2.72);assert.equal(EDGE_HEIGHT,2.72);assert.equal(RUBBLE_HEIGHT,.51);
});

test('ground: water from the samples, rubble on blocked ground, no street or cobble under blocks',()=>{
  let water=0;
  for(let cy=0;cy<H;cy++)for(let cx=0;cx<W;cx++){
    const g=letter(cx,cy),wet=samplesIn(cx,cy,maps.water)>=WATER_MIN_SAMPLES;
    assert.equal(g==='w',wet,`cell ${cx},${cy}`);
    if(wet){water++;continue;}
    const covered=coverOf[cy*W+cx]>=0;
    if(covered)assert.ok(g==='s'||g==='r',`cell ${cx},${cy} under a block is ${g}`);
    else if(samplesIn(cx,cy,maps.walkable)<WALKABLE_MIN_SAMPLES)assert.equal(g,'r',`unwalkable cell ${cx},${cy}`);
    else assert.ok('scp'.includes(g),`walkable cell ${cx},${cy} is ${g}`);
  }
  assert.ok(water>0,'water cells exist');
  assert.ok(/^[spirwc]+$/.test(city.ground));
});

test('ground: the plaza around the praça is cobble (asset v4: its fountains and their water were dropped)',()=>{
  const p=maps.points,mouths=[p.bocas.N,p.bocas.S,p.bocas.L,p.bocas.O];
  const x0=Math.min(...mouths.map(m=>m.x))/CELL-PLAZA_PAD_CELLS,x1=Math.max(...mouths.map(m=>m.x))/CELL+PLAZA_PAD_CELLS;
  const y0=Math.min(...mouths.map(m=>m.y))/CELL-PLAZA_PAD_CELLS,y1=Math.max(...mouths.map(m=>m.y))/CELL+PLAZA_PAD_CELLS;
  let open=0,cobble=0,wet=0;
  for(let cy=Math.floor(y0);cy<y1;cy++)for(let cx=Math.floor(x0);cx<x1;cx++){
    if(cx+.5<x0||cx+.5>x1||cy+.5<y0||cy+.5>y1)continue; // cell centre inside the box
    const g=letter(cx,cy);
    if(g==='w')wet++;
    if(coverOf[cy*W+cx]<0&&g!=='w'&&g!=='r'){open++;if(g==='c')cobble++;}
  }
  assert.ok(open>100&&cobble/open>0.95,`${cobble}/${open} open plaza cells are cobble`);
  // mapa-175-com-viaduto: the plaza 1.75× smaller lost its fountains with their basins (scripts/compactar-cidade.ts PLAZA_DROP).
  assert.equal(wet,0,'no fountain water left in the plaza');
  // Near the praça itself.
  const pcx=p.praca.x/CELL,pcy=p.praca.y/CELL;
  let near=0,nearC=0;
  for(let cy=Math.floor(pcy-5);cy<=pcy+5;cy++)for(let cx=Math.floor(pcx-5);cx<=pcx+5;cx++){
    if((cx+.5-pcx)**2+(cy+.5-pcy)**2>25||coverOf[cy*W+cx]>=0||letter(cx,cy)==='w')continue;
    near++;if(letter(cx,cy)==='c')nearC++;
  }
  assert.ok(near>20&&nearC/near>0.85,`${nearC}/${near} open cells within 5 of the praça are cobble`);
});

test('ground: the four avenues of the cross (mouth → spawn) are packed snow, and so is the ring road',()=>{
  const p=maps.points;
  for(const [name,a,b] of [['N',p.bocas.N,p.spawnN],['S',p.bocas.S,p.spawnS],['L',p.bocas.L,p.spawnL],['O',p.bocas.O,p.spawnO]] as const){
    const steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/CELL*2);
    const seen=new Set<number>();
    let open=0,packed=0;
    for(let k=0;k<=steps;k++){
      const t=k/steps,cx=Math.floor((a.x+(b.x-a.x)*t)/CELL),cy=Math.floor((a.y+(b.y-a.y)*t)/CELL),i=cy*W+cx;
      if(seen.has(i))continue;
      seen.add(i);
      const g=letter(cx,cy);
      if(g==='c'||g==='w'||g==='r'||coverOf[i]>=0)continue; // the plaza, water, blocked ground
      open++;if(g==='p')packed++;
    }
    // Asset v4 (mapa-175-com-viaduto): the avenues are 1.75× shorter (was > 40 open cells each).
    assert.ok(open>20&&packed/open>0.95,`avenue ${name}: ${packed}/${open} open cells are packed snow`);
  }
  assert.ok(AVENUE_HALF_WIDTH_CELLS>=1);
  // The ring road: a few cells inside the north edge, below the north spawn, most open cells are packed snow.
  const row=Math.floor(p.spawnN.y/CELL)+3;
  let open=0,packed=0;
  for(let cx=0;cx<W;cx++){const g=letter(cx,row);if(coverOf[row*W+cx]<0&&'spc'.includes(g)){open++;if(g==='p')packed++;}}
  // Asset v4: 110 cells a row (was 192, > 100 open).
  assert.ok(open>60&&packed/open>0.8,`ring row ${row}: ${packed}/${open}`);
  const counts:Record<string,number>={};
  for(const g of city.ground)counts[g]=(counts[g]??0)+1;
  assert.ok(counts.s>counts.p&&counts.p>counts.c,`fresh snow dominates, then streets, then the plaza: ${JSON.stringify(counts)}`);
});

test('points: all ten mapped, unchanged, walkable, on open street or plaza ground',()=>{
  const p=maps.points;
  assert.deepEqual(city.points,{inicio:p.inicio,praca:p.praca,spawnN:p.spawnN,spawnS:p.spawnS,spawnL:p.spawnL,spawnO:p.spawnO,
    bocaN:p.bocas.N,bocaS:p.bocas.S,bocaL:p.bocas.L,bocaO:p.bocas.O});
  for(const [name,pt] of Object.entries(city.points)){
    assert.ok(maps.walkableAt(pt.x,pt.y),`${name} walkable`);
    const cx=Math.floor(pt.x/CELL),cy=Math.floor(pt.y/CELL);
    assert.equal(coverOf[cy*W+cx],-1,`${name} not under a block`);
    assert.ok('pc'.includes(letter(cx,cy)),`${name} on ${letter(cx,cy)}`);
  }
});

test('props: kinds mapped, radius clamped, ids stable, none inside a block',()=>{
  const expected:Record<string,readonly string[]>={tree:['pine'],rock:['rubble'],wreck:['car'],ruin:['debris'],prop:['crate','barrel','bench','lamp']};
  const ids=new Set<string>(),kinds=new Set<string>();
  for(const q of city.props){
    assert.ok(!ids.has(q.id));ids.add(q.id);
    const src=maps.props[Number(q.id.slice(1))];
    assert.ok(src&&q.id===`p${maps.props.indexOf(src)}`,q.id);
    assert.ok(src.kind!=='fountain'&&src.kind!=='door',`${q.id}: ${src.kind} is not drawn as a prop`);
    assert.ok((expected[src.kind]??['debris']).includes(q.kind),`${q.id}: ${src.kind} → ${q.kind}`);
    assert.equal(q.x,src.x);assert.equal(q.y,src.y);
    assert.equal(q.r,Math.min(PROP_R_MAX,Math.max(PROP_R_MIN,src.r)));
    assert.equal(coverOf[Math.floor(q.y/CELL)*W+Math.floor(q.x/CELL)],-1,`${q.id} inside a block`);
    kinds.add(q.kind);
  }
  // Asset v4: ~1/3 of the ground, the stacks dedup'd (PROP_DEDUP): ~30 drawn (was > 50 on the 1.7× city).
  assert.ok(city.props.length>25,`${city.props.length} props`);
  for(const k of ['crate','barrel','bench','lamp'])assert.ok(kinds.has(k),`generic props spread over ${k}`);
});

test('props (proporcoes-postes-predios): one per spot — no two closer than PROP_STACK, none of a kind closer than PROP_DEDUP; a stacked doodad keeps its first copy',()=>{
  for(const a of city.props)for(const b of city.props){
    if(a===b)continue;
    const d=Math.hypot(a.x-b.x,a.y-b.y);
    assert.ok(d>=Math.max(PROP_STACK,0.45),`${a.id} (${a.kind}) and ${b.id} (${b.kind}) stacked`);
    if(a.kind===b.kind)assert.ok(d>=PROP_DEDUP[a.kind],`${a.id} and ${b.id} (${a.kind}) stacked`);
  }
  // The .w3x stacks 5 lamps within 1 u by the start (× AT on asset v4): one stays, the one first in source order.
  const lamps=city.props.filter(p=>p.kind==='lamp'&&Math.hypot(p.x-98.3*AT,p.y-160*AT)<1.25*AT);
  assert.equal(lamps.length,1);
  // The same stack also hashes copies to barrel, crate and bench: those go with it.
  assert.deepEqual(city.props.filter(p=>Math.hypot(p.x-lamps[0].x,p.y-lamps[0].y)<PROP_STACK).map(p=>p.id),[lamps[0].id]);
  const sources=maps.props.map((p,i)=>({p,i})).filter(({p})=>Math.hypot(p.x-98.3*AT,p.y-160*AT)<1.5*AT&&p.kind==='prop');
  assert.ok(sources.length>=3,'the source does stack them');
});

test('deterministic and already in parseCityAsset normal form',()=>{
  assert.deepEqual(cityRenderAsset(maps),city);
  assert.deepEqual(parseCityAsset(city),city);
  assert.deepEqual(parseCityAsset(JSON.parse(JSON.stringify(city))),city);
});

// D-031: a wall-clock limit, so it only gates with
//   BENCH=1 node --experimental-strip-types --test tests/client/city-from-maps.test.ts
// (the number is always logged; the conversion result is checked by the tests above).
test('the real asset converts in well under 300 ms (best of 3; gated by BENCH=1)',()=>{
  let best=Infinity;
  for(let k=0;k<3;k++){const t=performance.now();cityRenderAsset(maps);best=Math.min(best,performance.now()-t);}
  console.log(`[bench] city-from-maps: cityRenderAsset best of 3 ${best.toFixed(1)} ms`);
  if(process.env.BENCH==='1')assert.ok(best<300,`${best.toFixed(1)} ms`);
});

test('trocar-procedurais-por-arte: every wall cell of Cidade Nevada stands under a painted wall piece (none left bare by the keep-outs)', ()=>{
  const W=maps.cells.w,H=maps.cells.h,unit=maps.unitsPerCell,render=cityRenderAsset(maps),under=new Uint8Array(W*H);
  for(const d of render.decor??[])for(let r=d.r;r<d.r+d.h;r++)for(let c=d.c;c<d.c+d.w;c++)if(c>=0&&r>=0&&c<W&&r<H)under[r*W+c]=1;
  let walls=0;const bare:string[]=[];
  for(const b of maps.blocks){
    if(b.kind!=='wall')continue;
    for(const [x,y,w,h] of b.rects)for(let r=Math.round(y/unit);r<Math.round((y+h)/unit);r++)for(let c=Math.round(x/unit);c<Math.round((x+w)/unit);c++){
      if(c<0||r<0||c>=W||r>=H)continue;
      walls++;if(!under[r*W+c])bare.push(`${c},${r}`);
    }
  }
  assert.ok(walls>100,'the map has walls');
  assert.deepEqual(bare,[],'wall cells drawn as the procedural box');
  const extra=leftoverWallLines(maps);
  assert.ok(extra.length>0,'the plaza keep-out left wall cells for the render to line');
  assert.ok(extra.every(e=>/-reto-intacto$/.test(e.id)),'the families\' straight intact pieces');
  assert.deepEqual(leftoverWallLines({...maps,decor:[]}),[],'a map without scenery keeps its walls as they are');
});

/**
 * NEW-20261029-ORQ-cercas-nordeste-ligadas ("soltas, não se conectam… como se alguém colocasse outro na frente e outra
 * atrás"): the fences the game draws (the bake plus leftoverWallLines) are the one line maps/city-decor.ts wallLines
 * lays over every wall cell, not two lines broken where the keep-outs start; only on wall cells (a fence closes no
 * street or entrance); no two side by side closer than 1 u.
 */
test('cercas-nordeste-ligadas: the drawn fences are one line over every wall cell, only on wall cells, never parallel under 1 u', ()=>{
  const W=maps.cells.w,H=maps.cells.h,unit=maps.unitsPerCell,block:(string|undefined)[]=new Array(W*H);
  for(const b of maps.blocks)for(const [x,y,w,h] of b.rects)
    for(let r=Math.max(0,Math.round(y/unit));r<Math.min(H,Math.round((y+h)/unit));r++)for(let c=Math.max(0,Math.round(x/unit));c<Math.min(W,Math.round((x+w)/unit));c++)block[r*W+c]=b.kind==='wall'?b.id:undefined;
  const isFence=(id:string)=>WALL_FAMILIES.some(f=>id.startsWith(`${f}-`));
  const drawn=[...maps.decor,...leftoverWallLines(maps)].filter(d=>isFence(d.id)&&!d.cover);
  const at=(d:{c:number;r:number;w:number;h:number;rot:number})=>`${d.c},${d.r},${d.w}x${d.h},${d.rot}`;
  const line=wallLines(W,H,i=>block[i]!==undefined,()=>'x',new Uint8Array(W*H)).filter(d=>!d.cover).map(at);
  const lineSet=new Set(line),drawnAt=drawn.map(at);
  for(const d of drawn){
    assert.ok(lineSet.has(at(d)),`${d.id} at ${at(d)} is off the single line`);
    for(let r=d.r;r<d.r+d.h;r++)for(let c=d.c;c<d.c+d.w;c++)assert.ok(block[r*W+c]!==undefined,`${d.id} on ${c},${r}, not a wall cell`);
  }
  assert.equal(new Set(drawnAt).size,drawnAt.length,'no piece drawn twice');
  // Only the pieces under other scenery (a viaduct's span) are missing from the line.
  assert.ok(drawn.length>=line.length*.97,`${drawn.length} of ${line.length} pieces of the line drawn`);
  // Parallel pieces (same axis, spans overlapping) closer than 1 u.
  const seg=drawn.map(d=>{const cx=d.c+d.w/2,cy=d.r+d.h/2,h=d.rot===90;return {h,k:h?cy:cx,a:(h?cx:cy)-.5,b:(h?cx:cy)+.5,id:`${d.id}@${d.c},${d.r}`};});
  const close:string[]=[];
  for(let i=0;i<seg.length;i++)for(let j=i+1;j<seg.length;j++){
    const p=seg[i],q=seg[j],dk=Math.abs(p.k-q.k);
    if(p.h===q.h&&dk>0&&dk*unit<1&&Math.min(p.b,q.b)-Math.max(p.a,q.a)>0)close.push(`${p.id} ~ ${q.id}`);
  }
  assert.deepEqual(close,[],'parallel fences under 1 u');
});

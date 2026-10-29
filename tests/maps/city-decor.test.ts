/**
 * The scenery on Cidade Nevada (NEW-20261016-ORQ-cenario-no-mapa, src/maps/city-decor.ts, scripts/cenario-cidade.ts),
 * checked on the committed asset (version 3):
 *  - the decor list decodes and round-trips; old readers ignore it (it is one extra top-level key);
 *  - every piece is a delivered id, inside the map, no two overlap;
 *  - lines (walls, fences, cliffs) sit on their own block cells with the links of their neighbours; lots on unwalkable
 *    cells; poles and objects on walkable sidewalk cells; nothing in a keep-out;
 *  - poles keep POLE_SPACING; places with life: every kind at least once, never closer than LUGAR_SPACING on open ground;
 *  - the open-ground places only took cells off the plaza's ground without cutting any of it off (undecorate restores
 *    the grid exactly).
 * Re-running the placement is slow (~1 min): `node --experimental-strip-types scripts/cenario-cidade.ts --check`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeCityAsset,encodeCityAsset,cityAssetToData,type CityAsset,type CityDecor} from '../../src/maps/city-asset.ts';
import {BIG_ROCKS,DECOR_REFUSED,LINK,wallLines,LUGARES,LUGAR_SPACING,MORADIAS,MOUNTAINS,OBJETOS_1,OBJETOS_2,POLE_SPACING,POSTES,WALL_FAMILIES,bigCliffRocks,lineShape,turnLinks} from '../../src/maps/city-decor.ts';
import {KEEP,undecorate} from '../../scripts/cenario-cidade.ts';
import {pieceRect,wallPieces,wallRuns,type WallRun} from '../../src/maps/wall-lines.ts';
import {CITY_SITE_CELL,buildPlanFor,footprint} from '../../src/maps/build-sites.ts';
import {CityTerrain} from '../../src/maps/city/terrain.ts';

const TEXT=readFileSync('public/maps/cidade-nevada.json','utf8');
const decoded=decodeCityAsset(TEXT);
if(!decoded.ok)throw new Error(decoded.error);
const asset:CityAsset=decoded.asset,W=asset.cells.w,u=asset.unitsPerCell,S=asset.samples.w/W;
const cellWalk=(c:number,r:number)=>{let n=0;for(let j=0;j<S;j++)for(let i=0;i<S;i++)if(asset.walkable(c*S+i,r*S+j))n++;return n;};
const kindAt=new Map<number,string>();
for(const b of asset.blocks)for(const [x,y,w,h] of b.rects)
  for(let r=Math.round(y/u);r<Math.round((y+h)/u);r++)for(let c=Math.round(x/u);c<Math.round((x+w)/u);c++)kindAt.set(r*W+c,b.kind);
const cells=(d:CityDecor)=>{const out:[number,number][]=[];for(let r=d.r;r<d.r+d.h;r++)for(let c=d.c;c<d.c+d.w;c++)out.push([c,r]);return out;};
const isLugar=(id:string)=>LUGARES.some(([l])=>id.startsWith(`${l}-`));
const isLine=(id:string)=>WALL_FAMILIES.some(f=>id.startsWith(`${f}-`))||id.startsWith('penhasco');
const isPole=(id:string)=>POSTES.some(([p])=>p===id);
const isObject=(id:string)=>[...OBJETOS_1,...OBJETOS_2].some(o=>id===o||id.startsWith(`${o}-`));

test('the decor decodes, round-trips through the encoder, and is one extra top-level key',()=>{
  assert.equal(asset.version,7);
  // v4: the city 1.75× shorter (mapa-175-com-viaduto) holds ~3 300 pieces (7 535 on the 1.7× city).
  assert.ok(asset.decor.length>2500,`${asset.decor.length} pieces`);
  assert.equal(encodeCityAsset(cityAssetToData(asset)),TEXT);
  const keys=Object.keys(JSON.parse(TEXT));
  assert.equal(keys.at(-2)==='decor'||keys.at(-1)==='decor',true);
  // An asset without the key decodes with an empty list (the reader stays compatible both ways).
  const without=JSON.parse(TEXT);delete without.decor;
  const old=decodeCityAsset(JSON.stringify(without));
  assert.ok(old.ok&&old.asset.decor.length===0);
});

test('every piece is a delivered id inside the map; no two pieces share a cell (but the pieces of one wall line)',()=>{
  const known=(id:string)=>isLugar(id)||isLine(id)||isPole(id)||isObject(id)||MORADIAS.some(([m])=>id.startsWith(`${m}-`))
    ||MOUNTAINS.some(([m])=>id===m||id.startsWith(`${m}-`))||/^pedregulho-[123]$/.test(id);
  const taken=new Map<number,string>();
  for(const d of asset.decor){
    assert.ok(known(d.id),d.id);
    assert.ok(/-(1|2|3|intacto|quebrado|reto|externa|ponta|3x3)$/.test(d.id),`variant in ${d.id}`);
    const wallLine=WALL_FAMILIES.some(f=>d.id.startsWith(`${f}-`));
    for(const [c,r] of cells(d)){
      const other=taken.get(r*W+c);
      // The straight pieces of a wall line overlap their neighbours' cells (each is centred on the line, grade-sem-padrao).
      assert.ok(other===undefined||(wallLine&&other==='wall'),`${d.id} overlaps at ${c},${r}`);
      taken.set(r*W+c,wallLine?'wall':d.id);
    }
  }
});

test('lines on their block cells with the links of their neighbours; lots on unwalkable cells; sidewalk pieces on walkable cells',()=>{
  const lineKind=(id:string)=>id.startsWith('penhasco')?'cliff':'wall';
  for(const d of asset.decor){
    if(d.id.startsWith('penhasco3-')){
      // The big cliff pieces (rochas-grandes): a 2×2 massif or a 2×1 wall, every cell of them a cliff cell.
      const bloco=BIG_ROCKS.bloco.includes(d.id);
      assert.ok(bloco?d.w===2&&d.h===2:d.id===BIG_ROCKS.reto&&d.w*d.h===2,`${d.id} ${d.w}×${d.h}`);
      for(const [c,r] of cells(d))assert.equal(kindAt.get(r*W+c),'cliff',`${d.id} at ${c},${r}`);
    }else if(WALL_FAMILIES.some(f=>d.id.startsWith(`${f}-`))){
      // Wall lines (grade-sem-padrao): straight pieces only, turned along their axis, on wall cells.
      assert.match(d.id,/-reto-(intacto|quebrado)$/);
      for(const [c,r] of cells(d))assert.equal(kindAt.get(r*W+c),'wall',`${d.id} at ${c},${r}`);
      if(d.cover)assert.ok(d.w===1&&d.h===1&&d.id.endsWith('-intacto'));
      else assert.equal(d.links,d.rot===90?LINK.E|LINK.W:LINK.N|LINK.S);
    }else if(isLine(d.id)){
      const k=lineKind(d.id),same=(c:number,r:number)=>kindAt.get(r*W+c)===k;
      assert.equal(kindAt.get(d.r*W+d.c),k,`${d.id} at ${d.c},${d.r}`);
      const links=(same(d.c,d.r-1)?LINK.N:0)|(same(d.c+1,d.r)?LINK.E:0)|(same(d.c,d.r+1)?LINK.S:0)|(same(d.c-1,d.r)?LINK.W:0);
      assert.equal(d.links,links);assert.equal(d.rot,lineShape(links).rot);
    }else if(d.id.startsWith('pedregulho-')){
      // Boulders cover the border band, mixed edge cells too (the render boxed them all); never an open cell.
      assert.equal(kindAt.get(d.r*W+d.c),'edge',`${d.id} at ${d.c},${d.r}`);
      assert.ok(cellWalk(d.c,d.r)<S*S,`${d.id} at ${d.c},${d.r} not on an open cell`);
    }else if(isPole(d.id)||isObject(d.id)){
      for(const [c,r] of cells(d))assert.equal(cellWalk(c,r),S*S,`${d.id} at ${c},${r} on a walkable cell`);
    }else for(const [c,r] of cells(d))assert.equal(cellWalk(c,r),0,`${d.id} at ${c},${r} on an unwalkable cell`);
  }
  // lineShape draws every mask with the base turned the way rot goes.
  for(let m=0;m<16;m++){const {rot}=lineShape(m);let b=m;for(let k=0;k<(4-rot/90)%4;k++)b=turnLinks(b);assert.ok([5,6,7,4,15].includes(b)||m===0||m===15,`mask ${m}`);}
});

test('nothing stands in a keep-out: the plaza, the start, spawns, mouths, build sites',()=>{
  const p=asset.points;
  const discs=[{...p.praca,r:KEEP.praca},{...p.inicio,r:KEEP.inicio},...[p.spawnN,p.spawnS,p.spawnL,p.spawnO].map(q=>({...q,r:KEEP.spawn})),
    ...Object.values(p.bocas).map(q=>({...q,r:KEEP.boca}))];
  const sites=buildPlanFor(new CityTerrain(asset,'decor-test')).sites.map(s=>footprint(s,s.maxSize,CITY_SITE_CELL));
  for(const d of asset.decor){
    const x0=d.c*u,y0=d.r*u,x1=(d.c+d.w)*u,y1=(d.r+d.h)*u;
    // Lines and border boulders only dress solid block cells: only the plaza (the base) stays bare of them.
    const dresses=isLine(d.id)||d.id.startsWith('pedregulho-');
    for(const k of dresses?discs.slice(0,1):discs){
      const nx=Math.max(x0,Math.min(k.x,x1)),ny=Math.max(y0,Math.min(k.y,y1));
      assert.ok(Math.hypot(nx-k.x,ny-k.y)>=k.r-1e-6,`${d.id} at ${d.c},${d.r} inside a keep-out disc`);
    }
    for(const s of sites)assert.ok(x1<=s.x+1e-6||x0>=s.x+s.w-1e-6||y1<=s.y+1e-6||y0>=s.y+s.h-1e-6,`${d.id} at ${d.c},${d.r} on a build site`);
  }
});

test('poles keep their spacing; every place with life at least once, apart on open ground',()=>{
  const poles=asset.decor.filter(d=>isPole(d.id));
  assert.ok(poles.length>300,`${poles.length} poles`);
  for(let i=0;i<poles.length;i++)for(let j=i+1;j<poles.length;j++)
    assert.ok(Math.max(Math.abs(poles[i].c-poles[j].c),Math.abs(poles[i].r-poles[j].r))>=POLE_SPACING);
  const lugares=asset.decor.filter(d=>isLugar(d.id));
  // Every place with a variant whose art was accepted (DECOR_REFUSED: lava-jato and posto-gasolina have none).
  for(const [l] of LUGARES){
    const art=[1,2].some(v=>!DECOR_REFUSED.has(`${l}-${v}`));
    assert.equal(lugares.some(d=>d.id.startsWith(`${l}-`)),art,`${l} placed: ${art}`);
  }
  const open=lugares.filter(d=>cells(d).some(([c,r])=>!kindAt.has(r*W+c)));
  assert.ok(open.length>=10,`${open.length} places on open ground`);
  for(let i=0;i<open.length;i++)for(let j=i+1;j<open.length;j++)
    assert.ok(Math.max(Math.abs(open[i].c-open[j].c),Math.abs(open[i].r-open[j].r))>=LUGAR_SPACING);
});

test('undecorate gives back the grid without the places: they only took cells, all on open ground',()=>{
  const before=decodeCityAsset(undecorate(TEXT));
  assert.ok(before.ok);
  const b=before.asset;
  assert.equal(b.decor.length,0);assert.equal(b.version,6);
  let changed=0;
  for(let s=0;s<b.samples.w*b.samples.h;s++){
    const x=s%b.samples.w,y=(s-x)/b.samples.w,was=b.walkable(x,y),now=asset.walkable(x,y);
    if(was!==now){changed++;assert.ok(was&&!now,`sample ${x},${y} only goes unwalkable`);}
  }
  const open=asset.decor.filter(d=>isLugar(d.id)).flatMap(cells).filter(([c,r])=>!kindAt.has(r*W+c)).length;
  assert.equal(changed,open*S*S);
});

test('rochas-grandes: the thick cliffs are big massifs, the same cliff cells covered, nothing else moved',()=>{
  // A 3×3 cliff square, a 3-cell line and a wall piece: one 2×2, then 2×1s, the cell left keeps its piece.
  const one=(id:string,c:number,r:number):CityDecor=>({id,c,r,w:1,h:1,rot:0,links:0});
  const square=[0,1,2].flatMap(r=>[0,1,2].map(c=>one('penhasco2-reto',c,r)));
  const line=[5,6,7].map(c=>one('penhasco2-reto',c,9)),wall=one('grade-reto-intacto',4,4);
  const out=bigCliffRocks([...square,...line,wall],BIG_ROCKS,1);
  const big=out.filter(d=>d.id.startsWith('penhasco3-'));
  assert.deepEqual(big.filter(d=>d.w===2&&d.h===2).map(d=>[d.c,d.r]),[[0,0]]);
  assert.ok(out.includes(wall));
  const covered=(list:readonly CityDecor[])=>new Set(list.filter(d=>d.id.startsWith('penhasco')).flatMap(d=>cells(d).map(([c,r])=>`${c},${r}`)));
  assert.deepEqual([...covered(out)].sort(),[...covered([...square,...line])].sort());
  assert.equal(out.length,1+2+1+1+1+1,'in the square one 2×2, two 2×1 and a 1×1 left; on the line a 2×1 and a 1×1; the wall');
  // On the asset: most cliff cells are under a big piece (the rows of 1-cell walls the user saw are gone).
  const cliff=asset.decor.filter(d=>d.id.startsWith('penhasco')),bigCells=cliff.filter(d=>d.id.startsWith('penhasco3-')).reduce((n,d)=>n+d.w*d.h,0);
  const all=cliff.reduce((n,d)=>n+d.w*d.h,0);
  // v6 (uno-anda-mapa-todo): the Uno's lanes cut 10 cliff cells, all under big pieces (v5 990 of 1099, v6 980 of 1089).
  assert.ok(bigCells/all>.89,`${bigCells} of ${all} cliff cells under a big piece`);
});

/**
 * BUG-20261022-ORQ-grades-sem-padrao: the walls and fences were one piece per cell shaped by its neighbours, so a band
 * 2 cells thick was two rows of T pieces (the grade's T art is an X): crosses scattered over the street. Now one line.
 */
test('grades-sem-padrao: each wall is one line of straight pieces along it, back to back, never crossed or stacked',()=>{
  const walls=asset.decor.filter(d=>WALL_FAMILIES.some(f=>d.id.startsWith(`${f}-`)));
  const pieces=walls.filter(d=>!d.cover);
  // cercas-nordeste-ligadas: the keep-outs' pieces are the runtime's (leftoverWallLines) and a free end no longer
  // doubles its last half cell (was > 450).
  assert.ok(pieces.length>400,`${pieces.length} pieces`);
  // Centre (sub units, half cells) and axis: rot 0 along y (rows), rot 90 along x; the rect is centred on the line.
  const key=(x:number,y:number)=>`${x},${y}`,centre=new Map<string,string>(),posts=new Map<string,number>();
  for(const d of pieces){
    assert.ok(d.rot===0||d.rot===90,`${d.id} rot ${d.rot}`);
    assert.ok(d.w<=2&&d.h<=2,`${d.id} ${d.w}×${d.h}`);
    const cx=2*d.c+d.w,cy=2*d.r+d.h,k=key(cx,cy);
    // No two pieces on one point: no stacked duplicate, no X of two axes.
    assert.ok(!centre.has(k),`${d.id} at ${d.c},${d.r} on another piece's centre`);
    centre.set(k,d.id);
    for(const s of [-1,1]){const p=d.rot===90?key(cx+s,cy):key(cx,cy+s);posts.set(p,(posts.get(p)??0)+1);}
  }
  // Back to back: most posts are shared by two pieces (the ends of a line are the only lone posts). Asset v4: the walls
  // are 1.75× shorter, so a line has fewer pieces between its two ends (was < 35 %).
  const lone=[...posts.values()].filter(n=>n===1).length;
  assert.ok(lone<posts.size*.45,`${lone} lone posts of ${posts.size}`);
});

test('wallLines: every wall cell is drawn by its line (a piece or a cover), nothing off the wall; a lone bit gets a piece',()=>{
  const rows=['##########......','##########......','........##......','........##...#..','........##......','..###...........'];
  const W0=rows[0].length,H0=rows.length,isWall=(i:number)=>rows[Math.floor(i/W0)][i%W0]==='#';
  const out=wallLines(W0,H0,isWall,()=>'grade',new Uint8Array(W0*H0));
  const seen=new Set<number>();
  for(const d of out)for(const [c,r] of cells(d)){assert.ok(isWall(r*W0+c),`${d.id} off the wall at ${c},${r}`);seen.add(r*W0+c);}
  for(let i=0;i<W0*H0;i++)if(isWall(i))assert.ok(seen.has(i),`wall cell ${i%W0},${Math.floor(i/W0)} not drawn`);
  // The lone cell (13, 3) and the 3×1 bit both have a visible piece, along their longer side.
  assert.ok(out.some(d=>!d.cover&&d.c===13&&d.r===3));
  assert.ok(out.some(d=>!d.cover&&d.r===5&&d.rot===90));
  assert.ok(out.every(d=>d.id==='grade-reto-intacto'));
});

const grid=(rows:string[])=>({W:rows[0].length,H:rows.length,wall:(c:number,r:number)=>rows[r]?.[c]==='#'});
const runsOf=(rows:string[])=>{const g=grid(rows);return wallRuns(g.W,g.H,g.wall).map(r=>`${r.o}${r.k}:${r.a}-${r.b}`).sort();};

test('wallRuns: a band 2 cells thick is one line between its rows; 1 thick, through its cells',()=>{
  assert.deepEqual(runsOf(['......','######','######','......']),['h4:0-12']);
  assert.deepEqual(runsOf(['......','######','......']),['h3:0-12']);
  assert.deepEqual(runsOf(['.##.','.##.','.##.','.##.','.##.']),['v4:0-10']);
});

test('wallRuns: L corners and T junctions meet on one post, no X',()=>{
  // L: a 2-thick band along x turning down along y.
  assert.deepEqual(runsOf(['######','######','....##','....##','....##']),['h2:0-10','v10:2-10']);
  // T: a 2-thick stem under the middle of a bar.
  const t=runsOf(['########','########','...##...','...##...','...##...']);
  assert.deepEqual(t,['h2:0-8','h2:8-16','v8:2-10']);
});

test('wallPieces: one cell long each, centred on the line; an odd half left at a free end, overlapped only between junctions; rects centred on them',()=>{
  // An even run; an odd one free at both ends (the half left at b).
  const free=wallPieces([{o:'h',k:4,a:0,b:6},{o:'v',k:9,a:1,b:4}]);
  assert.deepEqual(free,[{cx:1,cy:4,o:'h'},{cx:3,cy:4,o:'h'},{cx:5,cy:4,o:'h'},{cx:9,cy:2,o:'v'}]);
  // A T on (3, 4): each odd run leaves its half at its free end, none over another.
  assert.deepEqual(wallPieces([{o:'h',k:4,a:0,b:3},{o:'h',k:4,a:3,b:6},{o:'v',k:3,a:1,b:4}]),
    [{cx:2,cy:4,o:'h'},{cx:4,cy:4,o:'h'},{cx:3,cy:3,o:'v'}]);
  // An odd run between two junctions (a U): its last piece overlaps the one before by half.
  const u=wallPieces([{o:'h',k:0,a:0,b:3},{o:'v',k:0,a:0,b:2},{o:'v',k:3,a:0,b:2}]);
  assert.deepEqual(u.filter(p=>p.o==='h'),[{cx:1,cy:0,o:'h'},{cx:2,cy:0,o:'h'}]);
  for(const p of [...free,...u]){const q=pieceRect(p);assert.equal(2*q.c+q.w,p.cx);assert.equal(2*q.r+q.h,p.cy);}
});

test('cercas-nordeste-ligadas: wallLines split by `keep` draws the one same line as a single call',()=>{
  const rows=['##########......','##########......','........##......','........##...#..','........##......','..###...........'];
  const W0=rows[0].length,H0=rows.length,isWall=(i:number)=>rows[Math.floor(i/W0)][i%W0]==='#',none=new Uint8Array(W0*H0);
  const keep=(i:number)=>i%W0<6,key=(d:CityDecor)=>`${d.id}@${d.c},${d.r},${d.w}x${d.h},${d.rot}${d.cover?'c':''}`;
  const whole=wallLines(W0,H0,isWall,()=>'grade',none).map(key).sort();
  const a=wallLines(W0,H0,isWall,()=>'grade',none,keep),b=wallLines(W0,H0,isWall,()=>'grade',none,i=>!keep(i));
  for(const d of a)for(const [c,r] of cells(d))assert.ok(keep(r*W0+c));
  for(const d of b)for(const [c,r] of cells(d))assert.ok(!keep(r*W0+c));
  // The pieces across the split are in neither part (the caller draws them later, wholly on its own cells).
  const both=new Set([...a,...b].map(key));
  assert.ok(whole.filter(k=>!both.has(k)).length<=1,'only the piece over the split is left out');
  for(const k of both)assert.ok(whole.includes(k),`${k} not on the single line`);
});

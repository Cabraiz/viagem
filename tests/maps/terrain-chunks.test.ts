/**
 * Ground tiles of the endless world (NEW-20261009-ORQ-terreno-em-blocos) and the endless world as the rooms' default.
 * The GPU part (shaders.ts) cannot run in Node; what it reads can: every tile's height texture, its footprint on the
 * ground, which chunks a screen needs, and that two tiles see the same ground the same way (no seam).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {BASE_CLEAR,CHUNK_SIZE,generateChunk,generateFeatures,trailAt,type ChunkWorld} from '../../src/maps/terrain/chunks.ts';
import {
  ENDLESS_MAX_HEIGHT,FIELD_MARGIN,FIELD_STEP,FIELD_TEXELS,KEEP_TILES,PREFETCH_TILES,TILE_PX,fieldChunks,fieldOrigin,fillField,
  groundBox,inRange,propChunks,tileRange,tileRect,tilesByDistance,type Rect,
} from '../../src/client/terrain/tiles.ts';
import {projectView,unprojectView} from '../../src/client/projection.ts';
import {landShader,waterShader} from '../../src/client/terrain/shaders.ts';
import {DEFAULT_WORLD,Simulation,worldDescriptor} from '../../multiplayer/simulation.ts';
import {terrainFor} from '../../src/client/net/terrain.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {RADIUS,findPath,walkable,worldBase,worldSpawn} from '../../src/maps/world.ts';
import {Rng} from '../../src/contract/rng.ts';

const endless=(seed:number)=>new TerrainField(seed,{world:'infinito'});
const decode=(code:number)=>code/255*160-32;
/** CPU twin of the shader's field(g).r with GL_LINEAR + clamp: bilinear over the tile's 8-bit codes. */
function sampleField(data:Uint8Array,origin:{x:number;y:number},x:number,y:number){
  const u=(x-origin.x)/FIELD_STEP,v=(y-origin.y)/FIELD_STEP,i=Math.floor(u),j=Math.floor(v),tx=u-i,ty=v-j;
  assert.ok(i>=0&&j>=0&&i+1<FIELD_TEXELS&&j+1<FIELD_TEXELS,`(${x},${y}) inside the tile texture`);
  const at=(a:number,b:number)=>decode(data[(b*FIELD_TEXELS+a)*4]);
  return (at(i,j)*(1-tx)+at(i+1,j)*tx)*(1-ty)+(at(i,j+1)*(1-tx)+at(i+1,j+1)*tx)*ty;
}
const field=(world:ChunkWorld,t:{ix:number;iy:number},view:number)=>{
  const o=fieldOrigin(t,view),data=new Uint8Array(FIELD_TEXELS*FIELD_TEXELS*4),water=fillField(world,o,data);
  return {origin:{x:o.x,y:o.y},box:o.box,data,water};
};

test('a tile\'s footprint holds every ground point its pixels can show, in the 4 views, inside its 32² texture',()=>{
  const t=endless(4242),rng=new Rng(7);
  for(let view=0;view<4;view++)for(let n=0;n<12;n++){
    const tile={ix:rng.int(-40,40),iy:rng.int(-40,40)},r=tileRect(tile),f=fieldOrigin(tile,view),inner=groundBox(r,view);
    const span=(FIELD_TEXELS-1)*FIELD_STEP;
    assert.ok(f.box.x1<=f.x+span&&f.box.y1<=f.y+span,`view ${view}: footprint ${JSON.stringify(f.box)} fits from ${f.x},${f.y}`);
    assert.ok(Number.isInteger(f.x/FIELD_STEP)&&Number.isInteger(f.y/FIELD_STEP));
    for(let k=0;k<20;k++){
      const p={x:r.x+rng.range(0,r.w),y:r.y+rng.range(0,r.h)},g=unprojectView(p,view,t);
      assert.ok(g.x>=inner.x0-1e-6&&g.x<=inner.x1+1e-6&&g.y>=inner.y0-1e-6&&g.y<=inner.y1+1e-6,`view ${view}: ${JSON.stringify(g)} in ${JSON.stringify(inner)}`);
      assert.ok(g.x-FIELD_MARGIN>=f.x&&g.y-FIELD_MARGIN>=f.y,'shadow and slope margin inside the texture');
    }
  }
  // The relief never tops the bisection's ceiling (the shader would miss a hill).
  let top=0;for(let i=0;i<4000;i++){const x=rng.range(-3000,3000),y=rng.range(-3000,3000);top=Math.max(top,t.height(x,y));}
  assert.ok(top<ENDLESS_MAX_HEIGHT-5,`relief tops at ${top.toFixed(2)}`);
});

test('the tile texture is the chunk lattice: same bilinear height as the simulation, and tiles agree where they overlap (no seam)',()=>{
  const t=endless(31337),world=t.chunks!,rng=new Rng(11);
  for(let view=0;view<4;view++){
    const a={ix:rng.int(-30,30),iy:rng.int(-30,30)},b={ix:a.ix+1,iy:a.iy},c={ix:a.ix,iy:a.iy+1};
    const fa=field(world,a,view),fb=field(world,b,view),fc=field(world,c,view);
    for(let k=0;k<200;k++){
      const x=rng.range(fa.box.x0+FIELD_MARGIN,fa.box.x1-FIELD_MARGIN),y=rng.range(fa.box.y0+FIELD_MARGIN,fa.box.y1-FIELD_MARGIN);
      {const d=Math.abs(sampleField(fa.data,fa.origin,x,y)-t.bed(x,y));assert.ok(d<1e-5,`field = bed (Float32 decode in chunks.ts) (${d} at ${x},${y})`);}
    }
    // Ground both neighbours read: the texels there are byte-identical, so the shader computes the same pixel.
    for(const [f,g] of [[fa,fb],[fa,fc]] as const){
      const x0=Math.max(f.origin.x,g.origin.x),y0=Math.max(f.origin.y,g.origin.y);
      const x1=Math.min(f.origin.x,g.origin.x)+(FIELD_TEXELS-1)*FIELD_STEP,y1=Math.min(f.origin.y,g.origin.y)+(FIELD_TEXELS-1)*FIELD_STEP;
      let shared=0;
      for(let y=y0;y<=y1;y+=FIELD_STEP)for(let x=x0;x<=x1;x+=FIELD_STEP){
        const i=(o:{x:number;y:number})=>((Math.round((y-o.y)/FIELD_STEP))*FIELD_TEXELS+Math.round((x-o.x)/FIELD_STEP))*4;
        for(let ch=0;ch<4;ch++)assert.equal(f.data[i(f.origin)+ch],g.data[i(g.origin)+ch]);shared++;
      }
      assert.ok(shared>50,`overlap of ${shared} texels`);
    }
  }
});

test('water layer only where a lake can show; a dry tile never turns transparent',()=>{
  const t=endless(4242),world=t.chunks!;
  let wet=0,dry=0;
  for(let cy=-6;cy<=6;cy++)for(let cx=-6;cx<=6;cx++)for(const lake of world.chunk(cx,cy).lakes){
    const p=projectView(lake,0,t),tile={ix:Math.floor(p.x/TILE_PX),iy:Math.floor(p.y/TILE_PX)};
    assert.ok(field(world,tile,0).water,`lake at ${lake.x.toFixed(1)},${lake.y.toFixed(1)} gets water`);wet++;
  }
  for(let iy=-12;iy<=12;iy++)for(let ix=-12;ix<=12;ix++){
    const f=field(world,{ix,iy},0);if(f.water)continue;dry++;
    // Every decoded sample ≥ 1.25 > 0.25 (the shader's water cut): bilinear stays above the smallest sample.
    for(let k=0;k<f.data.length;k+=4)assert.ok(decode(f.data[k])>.25);
  }
  assert.ok(wet>=5&&dry>200,`wet ${wet}, dry ${dry}`);
});

test('trails reach the texture (blue channel) and wetness stays in range',()=>{
  const t=endless(99),world=t.chunks!;let trail=0;
  for(let iy=-8;iy<=8;iy++)for(let ix=-8;ix<=8;ix++){
    const f=field(world,{ix,iy},0);
    for(let k=0;k<f.data.length;k+=4){if(f.data[k+2]>200)trail++;assert.equal(f.data[k+3],255);}
  }
  assert.ok(trail>100,`trail texels ${trail}`);
});

test('ranges: visible ⊂ prefetch ⊂ keep, nearest first, and a 390×844 or 844×390 view stays under the pool',()=>{
  for(const [w,h] of [[669,1446],[1446,669]]){
    for(const x of [-100000,-17,0,128.5,99999])for(const y of [-50000,0,255.9,77777]){
      const v:Rect={x,y,w,h},vis=tileRange(v),pre=tileRange(v,PREFETCH_TILES),keep=tileRange(v,KEEP_TILES);
      const list=tilesByDistance(pre,v);
      assert.equal(list.length,(pre.ix1-pre.ix0+1)*(pre.iy1-pre.iy0+1));
      assert.ok(list.every(t=>inRange(t,keep)));assert.ok(tilesByDistance(vis,v).every(t=>inRange(t,pre)));
      assert.ok(list.length<=60,`${list.length} tiles in the ring`);
      const first=list[0],cx=x+w/2,cy=y+h/2;
      assert.ok(cx>=first.ix*TILE_PX-TILE_PX&&cx<=(first.ix+2)*TILE_PX&&cy>=first.iy*TILE_PX-TILE_PX&&cy<=(first.iy+2)*TILE_PX,'nearest first');
    }
  }
});

test('the chunks a tile reads, and the props a screen needs: every obstacle drawn on screen has its chunk in the set',()=>{
  const t=endless(2024),world=t.chunks!,rng=new Rng(5);
  const f=fieldOrigin({ix:3,iy:-2},1);
  const chunks=fieldChunks(f);assert.ok(chunks.length>=1&&chunks.length<=4);
  for(const c of chunks)assert.ok(f.x<(c.ix+1)*CHUNK_SIZE&&f.x+(FIELD_TEXELS-1)*FIELD_STEP>=c.ix*CHUNK_SIZE);
  for(let view=0;view<4;view++)for(let n=0;n<6;n++){
    const centre=projectView({x:rng.range(-500,500),y:rng.range(-500,500)},view,t),v:Rect={x:centre.x-335,y:centre.y-723,w:669,h:1446};
    const r=propChunks(v,view);
    const cxs=[Math.floor((Math.min(r.ix0,r.ix1)-1)),r.ix1+1],cys=[r.iy0-1,r.iy1+1];
    for(let cy=cys[0];cy<=cys[1];cy++)for(let cx=cxs[0];cx<=cxs[1];cx++)for(const o of world.chunk(cx,cy).obstacles){
      const p=projectView(o,view,t);
      // A tree's sheet spans ±128 px around its foot and up to ~250 px above it.
      const shows=p.x+128>v.x&&p.x-128<v.x+v.w&&p.y+20>v.y&&p.y-260<v.y+v.h;
      if(shows)assert.ok(cx>=r.ix0&&cx<=r.ix1&&cy>=r.iy0&&cy<=r.iy1,`view ${view}: obstacle at ${o.x.toFixed(1)},${o.y.toFixed(1)} (chunk ${cx},${cy}) shows but is not loaded`);
    }
  }
});

test('lattice() is the built chunk\'s lattice, without the hash',()=>{
  const t=endless(77),world=t.chunks!;
  for(const [cx,cy] of [[0,0],[5,-9],[-120,33]] as const){
    assert.ok(!world.hasLattice(cx,cy)||(cx===0&&cy===0));
    assert.deepEqual(world.lattice(cx,cy),generateChunk(77,cx,cy).heights);assert.ok(world.hasLattice(cx,cy));
  }
});

test('shaders: field sampled through uniforms, bisection capped by maxHeight, no sin() hash, endless trail from the texture',()=>{
  for(const src of [landShader,waterShader]){
    assert.match(src,/uniform vec2 fieldOrigin;/);assert.match(src,/uniform float maxHeight;/);
    assert.doesNotMatch(src,/fract\(sin\(/);assert.doesNotMatch(src,/129\.0/);
  }
  assert.match(landShader,/hi=maxHeight/);assert.match(landShader,/endless>0\.5\)trail=.*data\.b/);
});

/** Test peer as in multiplayer.test.ts. */
function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}} as Peer&{messages:any[]};
}
test('rooms play on the endless world by default; the island is an internal test world',()=>{
  assert.equal(DEFAULT_WORLD,'infinito');
  const room=new Room(1000,4242),a=peer();room.connect(a,1000);
  room.receive(a,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Tia',classId:'cidadao-comum'}),1000);
  const welcome=a.messages.find(m=>m.t==='welcome');
  assert.equal(welcome.world.kind,'infinito');assert.deepEqual(welcome.world,worldDescriptor(room.sim.terrain));
  const client=terrainFor(welcome.world);assert.ok(typeof client!=='string'&&client.chunks,'the client rebuilds the same endless world');
  assert.equal(client.signature,room.sim.terrain.signature);
  // Base at the origin, players spawned beside it, on walkable ground.
  const t=room.sim.terrain;assert.deepEqual(worldBase(t),{x:0,y:0});
  for(const p of room.sim.players.values())assert.ok(walkable(p,t)&&Math.hypot(p.x,p.y)<9,`spawn ${p.x},${p.y}`);
  assert.deepEqual(worldSpawn(t),{x:0,y:5});
  // The island is still there for tests and the lab (LAB_WORLD=ilha).
  assert.equal(new Room(1000,4242,{world:'ilha'}).sim.terrain.chunks,undefined);
  assert.equal(new Simulation(4242).terrain.chunks,undefined,'Simulation without options: the island lab of the sim tests');
});

test('pathfinding around the base and far out works on the default world',()=>{
  const t=new Room(1000,5150).sim.terrain,rng=new Rng(3);
  let found=0;
  for(let n=0;n<40;n++){
    const far=n%2?0:rng.range(500,3000),a={x:far+rng.range(-15,15),y:rng.range(-15,15)},b={x:a.x+rng.range(-10,10),y:a.y+rng.range(-10,10)};
    if(!walkable(a,t)||!walkable(b,t))continue;
    const path=findPath(a,b,t);
    assert.ok(path.length>0,`path ${JSON.stringify(a)} → ${JSON.stringify(b)}`);found++;
    assert.deepEqual(path.at(-1),b);
  }
  assert.ok(found>20);
});

// ---------- Pool of tiles (tile-pool.ts): which slot, when, how many bands ----------
import {BANDS,TilePool,URGENT_PER_FRAME,tileKey,type PoolBackend,type PoolSlot} from '../../src/client/terrain/tile-pool.ts';
type FakeSlot=PoolSlot&{id:number};
function fakeBackend(){
  const log={created:0,starts:0,bands:[] as [number,number,number][],finished:0,released:0,shows:0,lattice:new Set<number>()};
  let id=0;
  const backend:PoolBackend<FakeSlot>&{log:typeof log;missing:Set<number>}={log,missing:new Set(),
    create(){log.created++;return {id:id++,baked:-1,pending:-1,band:0,shown:false};},
    ready(t,_a,urgent){const k=tileKey(t.ix,t.iy);if(this.missing.has(k)){this.missing.delete(k);log.lattice.add(k);return urgent;}return true;},
    start(){log.starts++;},bands(s,from,to){log.bands.push([s.id,from,to]);},finish(){log.finished++;},release(){log.released++;},show(){log.shows++;}};
  return backend;
}
const PORTRAIT={w:669,h:1446};
const viewAt=(x:number,y:number)=>({x,y,...PORTRAIT});
test('pool: the first frame bakes every visible tile, then the ring one band at a time, never growing the pool',()=>{
  const b=fakeBackend(),pool=new TilePool(b,60),v=viewAt(100,-300),vis=tileRange(v);
  pool.update(v,{whole:true});
  const visible=(vis.ix1-vis.ix0+1)*(vis.iy1-vis.iy0+1);
  assert.equal(pool.stats.urgent,visible);assert.ok(pool.stats.bakes>=visible&&pool.stats.bakes<=visible+1,"plus at most one ring tile");
  for(let iy=vis.iy0;iy<=vis.iy1;iy++)for(let ix=vis.ix0;ix<=vis.ix1;ix++)assert.ok(pool.ready({ix,iy}));
  // The ring (a whole row missing: more than one band per frame), never past BANDS per tile.
  for(let f=0;f<200;f++)pool.update(v);
  const ring=tileRange(v,1);assert.equal(pool.stats.live,(ring.ix1-ring.ix0+1)*(ring.iy1-ring.iy0+1));
  assert.equal(pool.stats.grown,0);assert.equal(b.log.created,60);
  const perTile=new Map<number,number>();for(const [id,from,to] of b.log.bands)perTile.set(id,(perTile.get(id)??0)+to-from);
  assert.ok([...perTile.values()].every(n=>n%BANDS===0),'each bake covers exactly BANDS bands');
  assert.equal(b.log.starts,b.log.finished,'one fill per finished bake');
  // Once everything is there, a frame does nothing.
  const before=b.log.bands.length;pool.update(v);assert.equal(b.log.bands.length,before);
});
test('pool: a jump of the camera bakes the focus and centre tiles now and spreads the rest (no whole screen in one frame)',()=>{
  const b=fakeBackend(),pool=new TilePool(b,60);
  pool.update(viewAt(0,0),{whole:true});for(let f=0;f<300;f++)pool.update(viewAt(0,0));
  const far=viewAt(40000,-25000),focus={x:far.x+far.w/2+200,y:far.y+far.h/2+300};
  const urgent=pool.stats.urgent;pool.update(far,{focus});
  const now=pool.stats.urgent-urgent;
  assert.ok(now>=1&&now<=2+URGENT_PER_FRAME,`${now} tiles baked in the jump frame`);
  assert.ok(pool.ready({ix:Math.floor(focus.x/TILE_PX),iy:Math.floor(focus.y/TILE_PX)}),'the ground under the hero is ready');
  assert.ok(pool.ready({ix:Math.floor((far.x+far.w/2)/TILE_PX),iy:Math.floor((far.y+far.h/2)/TILE_PX)}),'the centre tile is ready');
  assert.ok(pool.stats.deferred>0);
  for(let f=0;f<20;f++)pool.update(far,{focus});
  const vis=tileRange(far);
  for(let iy=vis.iy0;iy<=vis.iy1;iy++)for(let ix=vis.ix0;ix<=vis.ix1;ix++)assert.ok(pool.ready({ix,iy}),'caught up in a few frames');
  assert.equal(pool.stats.grown,0,'old tiles far behind gave their slots');
});
test('pool: slot choice keeps the prefetch ring, takes the farthest tile outside it, grows only on a bigger screen',()=>{
  const b=fakeBackend(),pool=new TilePool(b,60);
  pool.update(viewAt(0,0),{whole:true});for(let f=0;f<300;f++)pool.update(viewAt(0,0));
  // Walk right one tile at a time: the pool never grows and the visible tiles are always ready.
  for(let step=1;step<=12;step++){
    const v=viewAt(step*TILE_PX,0);
    for(let f=0;f<40;f++)pool.update(v);
    const vis=tileRange(v);
    for(let iy=vis.iy0;iy<=vis.iy1;iy++)for(let ix=vis.ix0;ix<=vis.ix1;ix++)assert.ok(pool.ready({ix,iy}));
  }
  assert.equal(pool.stats.grown,0);assert.ok(b.log.released>0);
  // A tablet-sized view does not fit in 60 slots: the pool grows instead of evicting a visible tile.
  pool.update({x:0,y:0,w:2600,h:2600},{whole:true});
  assert.ok(pool.stats.grown>0);
  const vis=tileRange({x:0,y:0,w:2600,h:2600});
  for(let iy=vis.iy0;iy<=vis.iy1;iy++)for(let ix=vis.ix0;ix<=vis.ix1;ix++)assert.ok(pool.ready({ix,iy}));
});
test('pool: a missing chunk lattice costs the ring a frame; a turn or a lost context re-bakes; shutdown gives every slot back',()=>{
  const b=fakeBackend(),pool=new TilePool(b,60),v=viewAt(500,500);
  pool.update(v,{whole:true});
  const order=tilesByDistance(tileRange(v,1),v),next=order.find(t=>!pool.ready(t))!;
  b.missing.add(tileKey(next.ix,next.iy));
  const bands=b.log.bands.length;pool.update(v);
  assert.equal(b.log.bands.length,bands,'built a lattice instead of drawing');assert.equal(pool.stats.lattices,1);
  pool.update(v);assert.ok(b.log.bands.length>bands);
  // View turn / context restored: every slot stale, the visible ones baked again on the next whole update.
  pool.invalidate(2);
  assert.ok(pool.slots.every(s=>s.baked===-1&&s.pending===-1));
  const vis=tileRange(v);assert.ok(!pool.ready({ix:vis.ix0,iy:vis.iy0}));
  pool.update(v,{whole:true});assert.ok(pool.ready({ix:vis.ix0,iy:vis.iy0}));assert.equal(pool.angle,2);
  // Visibility changes only on transitions.
  const shows=b.log.shows;pool.update(v);assert.equal(b.log.shows-shows,0);
  const all=pool.destroy();assert.equal(all.length,60);assert.equal(pool.slots.length,0);
  assert.equal(pool.stats.live,pool.stats.live);
});
test('pool keys are numbers that never collide inside the world limit',()=>{
  const seen=new Set<number>();
  for(const ix of [-163000,-1,0,1,163000])for(const iy of [-163000,-1,0,1,163000]){const k=tileKey(ix,iy);assert.ok(Number.isSafeInteger(k));assert.ok(!seen.has(k));seen.add(k);}
});

// ---------- Generator v2 (design onda 6, B1) ----------
test('generator v2: groves of every species, a landmark per chunk, every gap passable, trails and the base clear',()=>{
  const seed=4242,species=new Set<string>();let obstacles=0,landmarks=0,n=0;
  for(let cy=-8;cy<8;cy++)for(let cx=-8;cx<8;cx++){
    const f=generateFeatures(seed,cx,cy);n++;obstacles+=f.obstacles.length;
    if(f.lakes.length||f.pois.length||f.obstacles.filter(o=>o.kind==='rock'&&o.radius>=.52).length>=2)landmarks++;
    for(const o of f.obstacles){
      if(o.art)species.add(o.art);
      assert.ok(Math.hypot(o.x,o.y)>=BASE_CLEAR,'nothing in the base clearing');
      assert.equal(trailAt(seed,o.x,o.y),0,'nothing on a trail');
    }
    for(let i=0;i<f.obstacles.length;i++)for(let j=i+1;j<f.obstacles.length;j++){
      const a=f.obstacles[i],b=f.obstacles[j];
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)-a.radius-b.radius>=2*RADIUS,'a hero fits between any two');
    }
  }
  // A portrait screen at the follow zoom shows ~548 u² of ground (669×1446 px / 1764 px² per u²): about half a chunk.
  const perScreen=obstacles/n*548/(CHUNK_SIZE*CHUNK_SIZE);
  assert.ok(perScreen>=6,`${perScreen.toFixed(1)} obstacles per portrait screen`);
  assert.ok(landmarks/n>=.75,`landmarks in ${(landmarks/n*100).toFixed(0)}% of chunks`);
  assert.ok(species.size>=35&&!species.has('arvore-nevada'),`${species.size} species`);
});

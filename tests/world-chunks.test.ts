import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SEED,TerrainField} from '../src/game/terrain/field.ts';
import {
  BASE,BASE_CLEAR,CHUNK_SAMPLES,CHUNK_SIZE,COAST_CAP,ChunkWorld,KEEP_CHUNKS,MAX_LIVE_CHUNKS,generateChunk,
} from '../src/game/terrain/chunks.ts';
import {
  PATH_MAX_NODES,RADIUS,SPAWN,clearSegment,findPath,isLand,obstacles,obstaclesNear,resourceObstacles,walkable,
  worldBase,worldSpawn,type Point,
} from '../src/game/world.ts';
import {Simulation} from '../src/game/net/shared.ts';
import {createStonewardsState} from '../src/game/sim/stonewards/system.ts';

const infinite=(seed:number,maxLiveChunks?:number)=>new TerrainField(seed,{world:'infinito',maxLiveChunks});
const SEEDS=Array.from({length:20},(_,i)=>(i*0x9e3779b1+17)>>>0);

test('island stays the default: same field, same obstacles, no chunks',()=>{
  const island=new TerrainField(DEFAULT_SEED),explicit=new TerrainField(DEFAULT_SEED,{world:'ilha'});
  assert.equal(island.world,'ilha');assert.equal(island.chunks,undefined);
  assert.equal(island.signature,explicit.signature);assert.deepEqual(island.heights,explicit.heights);
  assert.equal(obstaclesNear({x:0,y:0},1,island),obstacles);assert.equal(resourceObstacles(island),obstacles);
  assert.deepEqual(worldBase(island),{x:12,y:12});assert.deepEqual(worldSpawn(island),SPAWN);
  assert.equal(island.retain([{x:0,y:0}]),0);
  assert.notEqual(infinite(DEFAULT_SEED).signature,island.signature,'a client on the other world kind refuses the room');
});

test('same seed → same chunks (hash per chunk on 20 seeds), in any order and after eviction',()=>{
  const coords:[number,number][]=[];
  for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)coords.push([x,y]);
  coords.push([312,0],[-9000,4],[17,-31249],[31249,31249]);
  const all=new Set<string>();
  for(const seed of SEEDS){
    const forward=new ChunkWorld(seed),backward=new ChunkWorld(seed,{maxLive:9});
    const a=coords.map(([x,y])=>forward.chunk(x,y).hash);
    const b=[...coords].reverse().map(([x,y])=>backward.chunk(x,y).hash).reverse();
    assert.deepEqual(b,a,`seed ${seed}: order/eviction changed a chunk`);
    assert.ok(backward.evicted>0,'the small cache really evicted');
    // Rebuilt after eviction: same content.
    assert.deepEqual(coords.map(([x,y])=>backward.chunk(x,y).hash),a);
    assert.deepEqual(coords.map(([x,y])=>generateChunk(seed,x,y).hash),a);
    assert.equal(infinite(seed).signature,infinite(seed).signature);
    for(const h of a)all.add(`${seed}:${h}`);
    // No two chunks of one seed are identical (no visibly repeated neighbour).
    assert.equal(new Set(a).size,a.length,`seed ${seed}: repeated chunk`);
  }
  assert.equal(all.size,SEEDS.length*coords.length,'different seeds give different chunks');
});

test('golden chunk hashes: changing the generator must bump CHUNK_VERSION (server and client meet in one room)',()=>{
  // If this fails on purpose, bump CHUNK_VERSION in chunks.ts and update the values.
  const featured=generateChunk(DEFAULT_SEED,51,2);
  assert.ok(featured.lakes.length&&featured.pois.length&&featured.obstacles.length,'golden covers lake, POI and obstacles');
  const golden=[generateChunk(DEFAULT_SEED,0,0).hash,generateChunk(DEFAULT_SEED,3,-7).hash,generateChunk(1,-100,250).hash,featured.hash];
  assert.deepEqual(golden,GOLDEN);
});
const GOLDEN=['2aaba17d','a01218c5','4ef91b60','b84b2a9c'];

test('no seams: heights agree across chunk borders and slopes stay under the island bound',()=>{
  for(const seed of SEEDS.slice(0,6)){
    const w=new ChunkWorld(seed);
    for(let i=0;i<200;i++){
      const y=-40+i*.37,edge=CHUNK_SIZE*((i%5)-2);
      assert.ok(Math.abs(w.bed(edge-1e-7,y)-w.bed(edge,y))<1e-3,`seed ${seed}: seam at x=${edge}, y=${y}`);
      assert.ok(Math.abs(w.bed(y,edge-1e-7)-w.bed(y,edge))<1e-3,`seed ${seed}: seam at y=${edge}, x=${y}`);
    }
    for(const [cx,cy] of [[0,0],[5,-3],[-40,12]]){
      const c=w.chunk(cx,cy),h=c.heights,decode=(v:number)=>v/255*160-32;
      for(let j=0;j<CHUNK_SAMPLES;j++)for(let k=0;k<CHUNK_SAMPLES-1;k++){
        // Island bound: 3 per 0.25 → 6 per half-unit sample.
        assert.ok(Math.abs(decode(h[j*CHUNK_SAMPLES+k+1])-decode(h[j*CHUNK_SAMPLES+k]))<=6,`seed ${seed}: steep x`);
        assert.ok(Math.abs(decode(h[(k+1)*CHUNK_SAMPLES+j])-decode(h[k*CHUNK_SAMPLES+j]))<=6,`seed ${seed}: steep y`);
      }
    }
  }
});

test('the base clearing at the origin: no lake or obstacle, the wall and every spawn slot fit',()=>{
  for(const seed of SEEDS){
    const t=infinite(seed);
    assert.ok(obstaclesNear(BASE,BASE_CLEAR-1,t).every(o=>Math.hypot(o.x-BASE.x,o.y-BASE.y)>=BASE_CLEAR));
    for(let a=0;a<16;a++)for(const r of [0,3,6,BASE_CLEAR-1])assert.ok(walkable({x:Math.cos(a/16*Math.PI*2)*r,y:Math.sin(a/16*Math.PI*2)*r},t),`seed ${seed}`);
    assert.ok(walkable(worldSpawn(t),t));
    assert.ok(resourceObstacles(t).length>0,`seed ${seed}: gather nodes near the base`);
  }
});

/** Walkable point near `p` (spiral), for waypoints that landed on a rock or a lake. */
function near(p:Point,t:TerrainField):Point{
  if(walkable(p,t))return p;
  for(let r=.5;r<=8;r+=.5)for(let i=0;i<16;i++){const q={x:p.x+Math.cos(i/8*Math.PI)*r,y:p.y+Math.sin(i/8*Math.PI)*r};if(walkable(q,t))return q;}
  throw new Error(`no walkable ground near ${p.x},${p.y}`);
}

test('walk 2 000 units straight in any direction: no border, no hole, no repeated chunk',()=>{
  const t=infinite(SEEDS[3]),chunks=t.chunks!;
  const directions=[0,1,2,3,4,5,6,7].map(i=>i*Math.PI/4).concat([.3,2.1,3.9,5.5]);
  for(const angle of directions){
    const ux=Math.cos(angle),uy=Math.sin(angle);
    let at:Point={x:0,y:0},land=0,samples=0;
    const seen=new Map<string,string>();
    for(let d=0;d<=2000;d+=.5){
      const p={x:ux*d,y:uy*d},c=chunks.at(p.x,p.y)!;
      assert.ok(c,'chunk exists');assert.ok(Number.isFinite(t.height(p.x,p.y)));
      assert.ok(t.bed(p.x,p.y)>-13,'no bottomless hole');
      samples++;if(isLand(p,0,t))land++;
      const key=`${c.cx},${c.cy}`;
      if(!seen.has(key)){for(const [other,hash] of seen)assert.notEqual(c.hash,hash,`${key} repeats ${other}`);seen.set(key,c.hash);}
    }
    assert.ok(land/samples>.95,`mostly dry ground (${(land/samples*100).toFixed(1)}%)`);
    // And a hero really gets there: findPath hops of 12 units, every segment swept clear.
    for(let d=12;d<=2004;d+=12){
      const next=near({x:ux*Math.min(d,2000),y:uy*Math.min(d,2000)},t);
      const route=findPath(at,next,t);
      assert.ok(route.length,`angle ${angle.toFixed(2)}: blocked at ${d}`);
      for(const p of route){assert.ok(clearSegment(at,p,t));at=p;}
      t.retain([at]);
    }
    assert.ok(Math.hypot(at.x,at.y)>=1990,`reached ${Math.hypot(at.x,at.y).toFixed(0)}`);
    assert.ok(chunks.liveCount<=(2*KEEP_CHUNKS+1)**2+9,`live chunks while walking: ${chunks.liveCount}`);
  }
});

test('local pathfinding: around a rock far away, and refuses targets beyond the local box',()=>{
  const t=infinite(SEEDS[1]);
  let checked=0;
  for(const o of obstaclesNear({x:10000,y:10000},40,t)){
    const a={x:o.x-o.radius-1,y:o.y},b={x:o.x+o.radius+1,y:o.y};
    if(!walkable(a,t)||!walkable(b,t)||clearSegment(a,b,t))continue;
    const route=findPath(a,b,t);assert.ok(route.length>1);
    let p=a;for(const q of route){assert.ok(clearSegment(p,q,t));p=q;}
    checked++;
  }
  assert.ok(checked>=3,`detours checked: ${checked}`);
  const far=PATH_MAX_NODES*.5;
  const a=near({x:500,y:500},t),b=near({x:a.x+far+5,y:a.y+3},t);
  if(!clearSegment(a,b,t))assert.deepEqual(findPath(a,b,t),[]);
});

test('six players spread out: live chunks stay under a measured cap',()=>{
  const t=infinite(SEEDS[7]),chunks=t.chunks!;
  const players=[0,1,2,3,4,5].map(i=>({x:Math.cos(i)*3000*i,y:Math.sin(i)*3000*i,dx:Math.cos(i*2.4),dy:Math.sin(i*2.4)}));
  let peakAfterRetain=0,seed=1;const r=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/4294967296;};
  for(let tick=1;tick<=2400;tick++){
    for(const p of players){
      p.x+=p.dx*.6;p.y+=p.dy*.6;// 12 units/s, four times a hero: worst case churn
      for(let k=0;k<4;k++)walkable({x:p.x+(r()-.5)*40,y:p.y+(r()-.5)*40},t);// enemies around
    }
    if(tick%20===0){t.retain(players);peakAfterRetain=Math.max(peakAfterRetain,chunks.liveCount);}
  }
  const perPlayer=(2*KEEP_CHUNKS+1)**2;
  assert.ok(peakAfterRetain<=6*perPlayer,`after retain: ${peakAfterRetain} > ${6*perPlayer}`);
  assert.ok(chunks.peakLive<=MAX_LIVE_CHUNKS,`peak ${chunks.peakLive}`);
  console.log(`# blocos vivos: pico ${chunks.peakLive}, depois do retain ${peakAfterRetain} (teto ${6*perPlayer}), gerados ${chunks.generated}, descartados ${chunks.evicted}`);
  // A hard LRU cap holds even when nobody calls retain, and results do not depend on it.
  const small=new ChunkWorld(SEEDS[7],{maxLive:32}),big=new ChunkWorld(SEEDS[7]);
  for(let i=0;i<400;i++){
    const x=(i%20)*CHUNK_SIZE+3.3,y=Math.floor(i/20)*CHUNK_SIZE+7.1;
    assert.equal(small.clear(x,y,RADIUS),big.clear(x,y,RADIUS));assert.equal(small.bed(x,y),big.bed(x,y));
    assert.ok(small.liveCount<=32);
  }
});

function median(values:number[]){const s=[...values].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];}
function bench(t:TerrainField,cx:number,cy:number){
  let seed=99;const r=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/4294967296;};
  // A wide area (5×5 chunks) so the local layout (how many detours) averages out between places.
  const points:Point[]=[];while(points.length<3000)points.push({x:cx+(r()-.5)*160,y:cy+(r()-.5)*160});
  const pairs:[Point,Point][]=[];
  for(const a of points){if(pairs.length>=250)break;const b={x:a.x+(r()-.5)*16,y:a.y+(r()-.5)*16};if(walkable(a,t)&&walkable(b,t))pairs.push([a,b]);}
  for(const p of points)walkable(p,t);for(const [a,b] of pairs)findPath(a,b,t);// warm chunks and JIT
  const w:number[]=[],c:number[]=[],f:number[]=[];
  for(let round=0;round<5;round++){
    let s=performance.now();for(const p of points)walkable(p,t);w.push((performance.now()-s)/points.length);
    s=performance.now();for(const p of points)clearSegment(p,{x:p.x+1.2,y:p.y+.5},t);c.push((performance.now()-s)/points.length);
    s=performance.now();for(const [a,b] of pairs)findPath(a,b,t);f.push((performance.now()-s)/pairs.length);
  }
  return {walkable:median(w)*1000,clearSegment:median(c)*1000,findPath:median(f)*1000};
}

test('walkable/clearSegment/findPath cost the same at the origin and 10 000 units away (lab, 2 cores)',()=>{
  const t=infinite(SEEDS[5]);
  const origin=bench(t,0,0),far=bench(t,10000,0),diagonal=bench(t,-7071,7071);
  const fmt=(b:ReturnType<typeof bench>)=>`walkable ${b.walkable.toFixed(3)} µs, clearSegment ${b.clearSegment.toFixed(2)} µs, findPath ${b.findPath.toFixed(1)} µs`;
  console.log(`# origem: ${fmt(origin)}\n# x=10 000: ${fmt(far)}\n# (-7071,7071): ${fmt(diagonal)}`);
  // Same algorithm and data per query anywhere; only the local layout varies. Loose band against CI noise.
  for(const key of ['walkable','clearSegment','findPath'] as const)for(const other of [far,diagonal]){
    const ratio=other[key]/origin[key];
    assert.ok(ratio>.33&&ratio<3,`${key}: ratio ${ratio.toFixed(2)}`);
  }
});

test('coast is the capped distance to a lake shore, and land follows it',()=>{
  const t=infinite(SEEDS[2]),chunks=t.chunks!;
  let lakes=0;
  for(let cy=-3;cy<=3;cy++)for(let cx=-3;cx<=3;cx++)for(const l of chunks.chunk(cx,cy).lakes){
    lakes++;
    assert.ok(!t.land(l.x,l.y),'lake centre is water');assert.ok(t.bed(l.x,l.y)<0);
    const out={x:l.x+l.radius+l.wobble+COAST_CAP+.5,y:l.y};
    assert.equal(t.coast(out.x,out.y),COAST_CAP);assert.ok(t.land(out.x,out.y,1));
  }
  assert.ok(lakes>=5,`lakes seen: ${lakes}`);
});

test('a room on the endless world runs: players spawn by the base, wall at the origin, chunks pruned',()=>{
  const s=new Simulation(1234,{world:'infinito'});
  for(let i=0;i<6;i++)s.add(`p${i}`,`P${i}`,'cidadao-comum');
  s.resetRun();
  // Stonewards is not in the run yet (VGM-046B); its state already builds on the endless world.
  const stone=createStonewardsState({terrain:s.terrain});
  assert.ok(Math.hypot(stone.wall.x,stone.wall.y)<1,`wall at ${stone.wall.x},${stone.wall.y}`);
  assert.ok(stone.nodes.length>0&&stone.nodes.every(n=>Math.hypot(n.x,n.y)<=24));
  const players=[...s.players.values()];
  for(const p of players)assert.ok(walkable(p,s.terrain)&&Math.hypot(p.x,p.y)<BASE_CLEAR);
  for(let tick=0;tick<400;tick++){
    players.forEach((p,i)=>s.input(p.id,{seq:tick+1,x:Math.cos(i),y:Math.sin(i),attack:false}));
    s.step();
  }
  for(const p of players){assert.ok(walkable(p,s.terrain),`${p.id} at ${p.x},${p.y}`);}
  assert.ok(s.terrain.chunks!.liveCount<=MAX_LIVE_CHUNKS);
});

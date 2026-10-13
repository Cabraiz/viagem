/**
 * cidade-02 (terreno-motor): Cidade Nevada as the engine's terrain. CityTerrain (src/maps/city/terrain.ts) collides the
 * hero's disc (D-030: radius 0.22 u = half a cell = 1 sample) against the walkable bitset, and world.ts/prediction.ts
 * use it wherever a TerrainField goes (D-034: `cityAsField`). Result asserts only, no wall-clock limits (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom,cityAsField,cityTerrainFor} from '../../src/maps/city/terrain.ts';
import {encodeCityAsset,decodeCityAsset,type CityAssetData,type CityBlock,type CityPoint} from '../../src/maps/city-asset.ts';
import type {TerrainField} from '../../src/maps/terrain/field.ts';
import {walkable,clearSegment,moveDirection,findPath,worldBase,worldSpawn,obstaclesNear,resourceObstacles,RADIUS,CITY_HERO_SPEED,type Point} from '../../src/maps/world.ts';
import {simulate,reconcile,STEP} from '../../src/maps/prediction.ts';
import {TERRAIN_VERSION} from '../../src/maps/index.ts';
import {Rng} from '../../src/contract/rng.ts';
import type {PlayerInput} from '../../src/contract/index.ts';
import {screenDirection} from '../../src/client/projection.ts';
import {terrainFor} from '../../src/client/net/terrain.ts';
import {UPDATE_NEEDED} from '../../src/protocol/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
/** Longest move of one simulation tick (protocol 3: one STEP per input) at the city's faithful hero speed. */
const MAX_STEP=CITY_HERO_SPEED*STEP+1e-9;
const VIEWS=[0,1,2,3] as const;

/** A fresh, unregistered decode (cityTerrainFrom shares one instance per hash; determinism needs two). */
function build(json:string,hash:string):CityTerrain{
  const r=decodeCityAsset(json);
  if(!r.ok)throw new Error(r.error);
  return new CityTerrain(r.asset,hash);
}
const real=build(TEXT,HASH);
const field:TerrainField=cityAsField(real);
const input=(seq:number,d:Point):PlayerInput=>({seq,x:d.x,y:d.y,attack:false});

/**
 * Screen joystick that the camera view `view` turns into the world direction `d` (inverse of projection.screenDirection:
 * world = rotate({x/2+y, y−x/2}, −view)). Each of the 4 views needs a different thumb for the same world push.
 */
function joystickFor(d:Point,view:number):Point{
  // rotate(d, +view) undoes the view turn (rotateVector: 1 → (−y,x), 2 → (−x,−y), 3 → (y,−x)).
  const w=[d,{x:-d.y,y:d.x},{x:-d.x,y:-d.y},{x:d.y,y:-d.x}][view];
  return {x:w.x-w.y,y:(w.x+w.y)/2};
}
const unit=(p:Point)=>{const l=Math.hypot(p.x,p.y);return {x:p.x/l,y:p.y/l};};

// ---------------------------------------------------------------------------------------------------------------
// Synthetic city: 6×6 cells (0.88 u) → 24×24 samples of 0.22 u, all blocked except:
//  - a corridor exactly 2 samples tall (0.44 u): rows 2..3, columns 2..21 → x ∈ [0.44,4.84), y ∈ [0.44,0.88);
//  - four rooms (rows 6..22, columns 1..22) split by a cross wall exactly 1 sample thick:
//    column 12 (x ∈ [2.64,2.86)) and row 14 (y ∈ [3.08,3.30)). Every room is its own closed component.
// ---------------------------------------------------------------------------------------------------------------
const SIDE=24,S=.22;
const WALL_X0=12*S,WALL_X1=13*S,WALL_Y0=14*S,WALL_Y1=15*S;
const CORRIDOR_Y=3*S; // centre of rows 2..3
const ROOMS={NW:{x:1.43,y:2.2},NE:{x:3.96,y:2.2},SW:{x:1.43,y:4.18},SE:{x:3.96,y:4.18}} as const;
type Room=keyof typeof ROOMS;
const roomOf=(p:Point)=>`${p.y<(WALL_Y0+WALL_Y1)/2?'N':'S'}${p.x<(WALL_X0+WALL_X1)/2?'W':'E'}`;

function syntheticData():CityAssetData{
  const walk=new Uint8Array(SIDE*SIDE);
  const open=(x0:number,x1:number,y0:number,y1:number)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)walk[y*SIDE+x]=1;};
  open(2,21,2,3);
  open(1,22,6,22);
  for(let y=6;y<=22;y++)walk[y*SIDE+12]=0;
  for(let x=1;x<=22;x++)walk[14*SIDE+x]=0;
  const c:CityPoint={x:2.2,y:CORRIDOR_Y};
  return {
    id:'sintetica',version:1,name:'Sintética',cells:{w:6,h:6},unitsPerCell:.88,playable:{x:0,y:0,w:5.28,h:5.28},
    walkable:walk,heights:new Float32Array(7*7),
    points:{praca:ROOMS.NW,inicio:ROOMS.SW,spawnN:ROOMS.NE,spawnS:ROOMS.SE,spawnL:ROOMS.NE,spawnO:ROOMS.NW,
      bocas:{N:c,S:ROOMS.SW,L:ROOMS.SE,O:ROOMS.NW}},
    blocks:[],props:[],loot:[],
  };
}
const synthetic=build(encodeCityAsset(syntheticData()),'sintetica-city-terrain-test');
const synthField:TerrainField=cityAsField(synthetic);

test('synthetic: a 2-sample corridor (0.44 u) fits a 0.22 disc only when centred',()=>{
  for(const x of [.66,1.1,2.2,3.3,4.18]){
    assert.equal(synthetic.clearDisc(x,CORRIDOR_Y,.22),true,`r=.22 centred at x=${x}`);
    assert.equal(walkable({x,y:CORRIDOR_Y},synthField),true,'the hero (RADIUS) stands in the alley');
    assert.equal(synthetic.clearDisc(x,CORRIDOR_Y,.23),false,`r=.23 at x=${x}`);
    for(const dy of [-.04,-.01,.01,.04])assert.equal(synthetic.clearDisc(x,CORRIDOR_Y+dy,.22),false,`off-centre dy=${dy}`);
  }
  assert.equal(RADIUS,.22,'D-030: the hero collision is half a cell');
  // The ends of the alley are walls too: touching is allowed, entering is not.
  assert.equal(synthetic.clearDisc(.66,CORRIDOR_Y,.22),true);
  assert.equal(synthetic.clearDisc(.65,CORRIDOR_Y,.22),false);
  // The hero walks the whole alley along its axis without being pushed off it.
  let p:Point={x:.7,y:CORRIDOR_Y};
  // 48 ticks at the city speed (≈4.8 u) cover the ≈3.9 u alley and then press on its far wall.
  for(let i=0;i<48;i++){const q=moveDirection(p,{x:1,y:0},STEP,synthField);assert.ok(walkable(q,synthField));assert.equal(q.y,CORRIDOR_Y);p=q;}
  assert.ok(p.x>4.4&&p.x<=4.84-.22+1e-9,`reached the far end, x=${p.x}`);
});

test('synthetic: pushing into a 1-sample wall in all 4 views never crosses it and every position is walkable',()=>{
  // Each room pushes at each wall it shares, straight and sliding (a tangential component), in every camera view.
  const pushes:Record<Room,Point[]>={NW:[{x:1,y:0},{x:0,y:1}],NE:[{x:-1,y:0},{x:0,y:1}],SW:[{x:1,y:0},{x:0,y:-1}],SE:[{x:-1,y:0},{x:0,y:-1}]};
  const touch=(room:Room,d:Point)=>d.x>0?WALL_X0-RADIUS:d.x<0?WALL_X1+RADIUS:d.y>0?WALL_Y0-RADIUS:WALL_Y1+RADIUS;
  for(const view of VIEWS)for(const room of Object.keys(ROOMS) as Room[])for(const d of pushes[room])for(const slide of [0,.4,-.4]){
    const world={x:d.x+(d.x?0:slide),y:d.y+(d.y?0:slide)};
    const thumb=joystickFor(world,view),dir=screenDirection(thumb.x,thumb.y,view);
    const got=unit(dir),want=unit(world);
    assert.ok(Math.abs(got.x-want.x)<1e-12&&Math.abs(got.y-want.y)<1e-12,`view ${view} maps the thumb to the push`);
    let p:Point={...ROOMS[room]};
    for(let tick=0;tick<100;tick++){
      const q=moveDirection(p,dir,STEP,synthField);
      assert.ok(walkable(q,synthField),`view ${view} ${room} tick ${tick}: (${q.x},${q.y}) not walkable`);
      assert.equal(roomOf(q),room,`view ${view} ${room} crossed the wall at tick ${tick}: (${q.x},${q.y})`);
      assert.ok(Math.hypot(q.x-p.x,q.y-p.y)<=MAX_STEP);
      p=q;
    }
    // Pressed against the wall: at most one tick of travel away from touching it, never inside it.
    const along=d.x?p.x:p.y,line=touch(room,d),gap=(d.x||d.y)>0?line-along:along-line;
    assert.ok(gap>=-1e-9&&gap<=MAX_STEP,`view ${view} ${room} push ${JSON.stringify(world)}: gap ${gap}`);
  }
  // Every joystick direction (8 compass thumbs) in every view keeps each hero in its own room.
  for(const view of VIEWS)for(const room of Object.keys(ROOMS) as Room[])for(let k=0;k<8;k++){
    const a=k*Math.PI/4,dir=screenDirection(Math.cos(a),Math.sin(a),view);
    let p:Point={...ROOMS[room]};
    for(let tick=0;tick<100;tick++){
      p=moveDirection(p,dir,STEP,synthField);
      assert.ok(walkable(p,synthField)&&roomOf(p)===room,`view ${view} ${room} thumb ${k} tick ${tick}: (${p.x},${p.y})`);
    }
  }
});

test('clearDisc rejects non-finite input, negative radius and the outside of the grid; r=0 is walkableAt',()=>{
  for(const [x,y,r] of [[NaN,2.2,.22],[1.43,NaN,.22],[Infinity,2.2,.22],[1.43,-Infinity,.22],[1.43,2.2,NaN],[1.43,2.2,Infinity],
    [NaN,2.2,0],[Infinity,2.2,0]] as const)assert.equal(synthetic.clearDisc(x,y,r),false,`(${x},${y},${r})`);
  assert.equal(synthetic.clearDisc(1.43,2.2,.22),true,'room centre');
  for(const r of [-1e-9,-.22,-Infinity])assert.equal(synthetic.clearDisc(1.43,2.2,r),false,`r=${r}`);
  for(const [x,y] of [[-.1,2.2],[-5,-5],[5.3,2.2],[2.2,5.29],[100,100]] as const)
    for(const r of [0,.22])assert.equal(synthetic.clearDisc(x,y,r),false,`outside (${x},${y}) r=${r}`);
  // Outside the grid is blocked even next to walkable samples: a fully open 1×1-cell city.
  const open=syntheticData();
  Object.assign(open,{cells:{w:1,h:1},playable:{x:0,y:0,w:.88,h:.88},walkable:new Uint8Array(16).fill(1),heights:new Float32Array(4)});
  const p={x:.44,y:.44};
  open.points={inicio:p,praca:p,spawnN:p,spawnS:p,spawnL:p,spawnO:p,bocas:{N:p,S:p,L:p,O:p}};
  const tiny=build(encodeCityAsset(open),'aberta-city-terrain-test');
  assert.equal(tiny.clearDisc(.22,.44,.22),true,'touching the map edge');
  assert.equal(tiny.clearDisc(.21,.44,.22),false,'past the west edge');
  assert.equal(tiny.clearDisc(.44,.67,.22),false,'past the south edge');
  assert.equal(tiny.clearDisc(.44,.44,.45),false,'wider than the map');
  // r = 0 is exactly the asset's sample query, inside and outside the grid, on both maps.
  for(let y=-.5;y<5.8;y+=.037)for(let x=-.5;x<5.8;x+=.041)assert.equal(synthetic.clearDisc(x,y,0),synthetic.asset.walkableAt(x,y),`(${x},${y})`);
  for(let y=-1;y<171;y+=.73)for(let x=-1;x<171;x+=.61)assert.equal(real.clearDisc(x,y,0),real.asset.walkableAt(x,y),`real (${x},${y})`);
  for(const q of [{x:0,y:0},{x:2.64,y:3.08},{x:4.84,y:.88}])assert.equal(synthetic.clearDisc(q.x,q.y,0),synthetic.asset.walkableAt(q.x,q.y));
});

// ---------------------------------------------------------------------------------------------------------------
// The real city (public/maps/cidade-nevada.json, 1 cell = 0.88 u, samples 0.22 u, origin NW, y south).
// ---------------------------------------------------------------------------------------------------------------
const pts=real.asset.points;
const NAMED:[string,CityPoint][]=[['praca',pts.praca],['inicio',pts.inicio],['spawnN',pts.spawnN],['spawnS',pts.spawnS],
  ['spawnL',pts.spawnL],['spawnO',pts.spawnO],['boca N',pts.bocas.N],['boca S',pts.bocas.S],['boca L',pts.bocas.L],['boca O',pts.bocas.O]];

test('real city: world.walkable is the hero disc of CityTerrain; base, spawn and obstacles come from the asset',()=>{
  assert.equal(real.world,'cidade');
  for(const [name,p] of NAMED){
    assert.equal(real.clearDisc(p.x,p.y,RADIUS),true,`${name} fits the hero`);
    assert.equal(walkable(p,field),real.clearDisc(p.x,p.y,RADIUS),name);
  }
  const solid=(kind:CityBlock['kind'])=>real.asset.blocks.filter(b=>b.kind===kind).slice(0,8);
  for(const kind of ['building','wall'] as const){
    const blocks=solid(kind);assert.ok(blocks.length>=3,`some ${kind} blocks`);
    for(const b of blocks)for(const r of b.rects.slice(0,6)){
      const c={x:r[0]+r[2]/2,y:r[1]+r[3]/2};
      assert.equal(real.clearDisc(c.x,c.y,RADIUS),false,`${kind} ${b.id} rect centre (${c.x},${c.y})`);
      assert.equal(walkable(c,field),false,`${kind} ${b.id}`);
    }
  }
  assert.deepEqual(worldBase(field),{x:pts.praca.x,y:pts.praca.y});
  assert.deepEqual(worldSpawn(field),{x:pts.inicio.x,y:pts.inicio.y});
  for(const [,p] of NAMED)assert.deepEqual(obstaclesNear(p,RADIUS,field),[]);
  assert.deepEqual(resourceObstacles(field),[]);
});

/** 40 deterministic walkable starts inside the playable area. */
function starts(seed:number,count:number):Point[]{
  const rng=new Rng(seed),pl=real.asset.playable,out:Point[]=[];
  for(let tries=0;out.length<count&&tries<20000;tries++){
    const p={x:pl.x+rng.next()*pl.w,y:pl.y+rng.next()*pl.h};
    if(walkable(p,field))out.push(p);
  }
  assert.equal(out.length,count,'enough walkable starts');
  return out;
}
/** Deterministic random thumb: a new direction (or a release) every 15 ticks, as a screen joystick. */
function thumbs(seed:number,ticks:number):Point[]{
  const rng=new Rng(seed),out:Point[]=[];let cur={x:0,y:0};
  for(let i=0;i<ticks;i++){
    if(i%15===0){
      if(rng.chance(.1))cur={x:0,y:0};
      else{const a=rng.range(0,Math.PI*2),m=rng.range(.3,1);cur={x:Math.cos(a)*m,y:Math.sin(a)*m};}
    }
    out.push(cur);
  }
  return out;
}

test('real city, 4 views: random joystick from 40 starts stays walkable, swept and within one tick of speed',()=>{
  let travelled=0;
  starts(20261012,40).forEach((start,s)=>{
    for(const view of VIEWS){
      const stick=thumbs(1000+s*4+view,300);
      let p={...start};
      for(let tick=0;tick<300;tick++){
        const d=screenDirection(stick[tick].x,stick[tick].y,view);
        const q=simulate(p,input(tick,d),field);
        const step=Math.hypot(q.x-p.x,q.y-p.y);
        if(!walkable(q,field)||!clearSegment(p,q,field)||!(step<=MAX_STEP))
          assert.fail(`start ${s} view ${view} tick ${tick}: (${p.x},${p.y}) → (${q.x},${q.y}), step ${step}`);
        travelled+=step;p=q;
      }
    }
  });
  assert.ok(travelled>40*4*300*MAX_STEP*.2,`the heroes actually moved (${travelled.toFixed(1)} u)`);
});

test('determinism: reconcile equals stepping simulate; two decodes of the same JSON give identical trajectories',()=>{
  const rng=new Rng(77),inputs:PlayerInput[]=[];
  for(let i=0;i<240;i++){
    if(rng.chance(.08)){inputs.push(input(i,{x:0,y:0}));continue;}
    const a=rng.range(0,Math.PI*2);inputs.push(input(i,screenDirection(Math.cos(a),Math.sin(a),i%4)));
  }
  const other=build(TEXT,HASH),otherField:TerrainField=cityAsField(other);
  assert.notEqual(other,real);
  for(const start of [...starts(4242,6),{x:pts.praca.x,y:pts.praca.y},{x:pts.inicio.x,y:pts.inicio.y}]){
    let p={...start};const a:Point[]=[];
    for(const i of inputs){p=simulate(p,i,field);a.push(p);}
    assert.deepEqual(reconcile(start,inputs,field),p,'room replay = phone prediction');
    for(let k=0;k<inputs.length;k+=37)assert.deepEqual(reconcile(start,inputs.slice(0,k+1),field),a[k]);
    let q={...start};const b:Point[]=[];
    for(const i of inputs){q=simulate(q,i,otherField);b.push(q);}
    assert.deepEqual(b,a,'independent decode, same trajectory to the last bit');
  }
});

test('findPath goes around a building of the real city with swept legs',()=>{
  const blocks=real.asset.blocks.filter(b=>b.kind==='building'&&b.bbox[2]>=1.5&&b.bbox[3]>=1.5&&b.bbox[2]<=12&&b.bbox[3]<=12);
  const inside=(b:CityBlock,p:Point)=>b.rects.some(r=>p.x>=r[0]&&p.x<r[0]+r[2]&&p.y>=r[1]&&p.y<r[1]+r[3]);
  let found:{a:Point;b:Point;route:Point[];id:string}|undefined,searches=0;
  search:for(const block of blocks){
    const [x,y,w,h]=block.bbox,c={x:x+w/2,y:y+h/2};
    if(!inside(block,c))continue;
    for(const m of [.6,1,1.5])for(const [a,b] of [[{x:x-m,y:c.y},{x:x+w+m,y:c.y}],[{x:c.x,y:y-m},{x:c.x,y:y+h+m}]]){
      if(!walkable(a,field)||!walkable(b,field)||clearSegment(a,b,field))continue;
      if(++searches>12)break search;
      const route=findPath(a,b,field);
      if(route.length){found={a,b,route,id:block.id};break search;}
    }
  }
  assert.ok(found,`a building with walkable ground on opposite sides and a local path (${searches} searches)`);
  const {a,b,route}=found;
  assert.ok(route.length>=2,'the straight line is blocked, so the route bends');
  let at=a,length=0;
  for(const p of route){assert.ok(clearSegment(at,p,field),`leg (${at.x},${at.y}) → (${p.x},${p.y})`);length+=Math.hypot(p.x-at.x,p.y-at.y);at=p;}
  assert.deepEqual(at,b);
  assert.ok(length>Math.hypot(b.x-a.x,b.y-a.y),'a detour is longer than the blocked straight line');
});

test('heights: finite, ≥ 0, the lowest corner is 0 and the hill rises in the east',()=>{
  const g=real.asset.heightGrid,u=real.asset.unitsPerCell;
  let min=Infinity,maxH=-Infinity,mx=0,my=0;
  for(let hy=0;hy<g.h;hy++)for(let hx=0;hx<g.w;hx++){
    const h=real.height(hx*u,hy*u);
    assert.ok(Number.isFinite(h)&&h>=0,`corner (${hx},${hy}) = ${h}`);
    min=Math.min(min,h);if(h>maxH){maxH=h;mx=hx;my=hy;}
  }
  assert.equal(min,0,'the lowest corner is the zero of the height scale');
  let east=0,west=0,ne=0,nw=0;
  for(let y=-2;y<real.asset.size.h+2;y+=.55)for(let x=-2;x<real.asset.size.w+2;x+=.55){
    const h=real.height(x,y);
    assert.ok(Number.isFinite(h)&&h>=0&&h<=maxH+1e-9,`(${x},${y}) = ${h}`);
    if(x>real.asset.size.w/2){east+=h;ne++;}else{west+=h;nw++;}
  }
  assert.ok(maxH>0,'the city is not flat');
  assert.ok(mx>g.w/2,`the highest corner (${mx},${my}) is in the east half`);
  assert.ok(east/ne>west/nw,`the east half is higher on average (${(east/ne).toFixed(2)} vs ${(west/nw).toFixed(2)})`);
  // Orientation: x is east and y is south, not transposed.
  assert.ok(real.height(mx*u,my*u)>real.height(my*u,mx*u),'swapping x and y moves off the hill');
  // Same numbers whatever the instance (both sides of the wire).
  const other=build(TEXT,HASH);
  for(const [,p] of NAMED)assert.equal(other.height(p.x,p.y),real.height(p.x,p.y));
});

test('client welcome: terrainFor finds the decoded city by hash and refuses an unknown one',async()=>{
  const r=await cityTerrainFrom(TEXT,HASH);assert.ok(r.ok);
  assert.equal((await cityTerrainFrom(TEXT,HASH)).ok&&cityTerrainFor(HASH),r.terrain,'one shared instance per hash');
  const city={kind:'cidade' as const,terrainVersion:TERRAIN_VERSION,generatorVersion:0,seed:0,signature:HASH};
  assert.equal(cityTerrainFor(HASH),r.terrain);
  assert.equal(terrainFor(city),r.terrain);
  assert.equal(terrainFor({...city,signature:'0'.repeat(64)}),UPDATE_NEEDED);
  assert.equal(terrainFor({...city,terrainVersion:TERRAIN_VERSION+1}),UPDATE_NEEDED);
  // A bad asset, or a good one under the wrong hash, never registers anything (D-034: different hash → update).
  const bad=await cityTerrainFrom('{"format":"viagem-city"}','f'.repeat(64));
  assert.equal(bad.ok,false);assert.equal(cityTerrainFor('f'.repeat(64)),undefined);
  const forged=await cityTerrainFrom(TEXT,'a'.repeat(64));
  assert.equal(forged.ok,false);assert.equal(cityTerrainFor('a'.repeat(64)),undefined);
  assert.equal(decodeCityAsset(TEXT).ok,true);
});

test('bodies wider than the hero (elite, boss) keep their own disc out of city walls while pushing into them',async()=>{
  const {moveSafely}=await import('../../src/sim/enemies/ai.ts');
  const rng=new Rng(4242);let pushes=0;
  for(const radius of [.32,.48,.9,1.5]){
    for(let k=0;k<60;k++){
      const p={x:rng.range(20,150),y:rng.range(20,150)};
      if(!real.clearDisc(p.x,p.y,radius))continue;
      const a=rng.range(0,Math.PI*2),dir={x:Math.cos(a),y:Math.sin(a)};
      for(let t=0;t<120;t++)moveSafely(p,dir.x*.15,dir.y*.15,field,radius);
      assert.ok(real.clearDisc(p.x,p.y,radius),`radius ${radius} ended inside a wall at (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
      pushes++;
    }
  }
  assert.ok(pushes>40,`${pushes} pushes`);
  // The reviewer's repro: a boss pushed north into a building from (17.48, 9.04).
  const boss={x:17.48,y:9.04};
  if(real.clearDisc(boss.x,boss.y,.9)){for(let t=0;t<60;t++)moveSafely(boss,0,-.15,field,.9);assert.ok(real.clearDisc(boss.x,boss.y,.9));}
});

test("'cidade' only exists with the decoded city: no seed-built city, no silent island",async()=>{
  const {Simulation}=await import('../../multiplayer/simulation.ts');
  assert.throws(()=>new Simulation(7,{world:'cidade'}),/decoded city/);
  const sim=new Simulation(7,{world:'cidade',terrain:field});
  assert.equal(sim.terrain,field);assert.equal(sim.terrain.world,'cidade');
});

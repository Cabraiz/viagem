// NEW-20261028-ORQ-caixa-sempre-alcancavel (auditoria de jogabilidade, item 5): every spot a crate may take in the city
// (the placed crates' loot points, the first minute's spots around the Uno and the wreck, the plaza ring, the trail's
// spotAhead) is reached on foot from the Uno's start by the hero's own step (maps moveDirection: clearSegment against
// the walkable mask), not only by the cell flood that picks them. Asset-deterministic: a seed only chooses among these
// spots, so checking them all covers every seed.
// The k13 of the audit (75.55, 93.5; 4 u south of where the hero stood at y 89.5; an aroundUno spot of seeds 8 and 101
// solo) is pinned: a strip of the mask (y 90–91, x 70.5–82, the white edge of the snow) stops a hero walking straight
// south from x 71–79; the way down at x ≈ 81.5, right under the start, reaches it, but at 1.5× the straight line, so it
// is no longer a first-minute spot (AROUND_DETOUR_MAX).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {FlowField} from '../../src/maps/flowfield.ts';
import {clearSegment,heroSpeed,moveDirection,walkable,type Point} from '../../src/maps/world.ts';
import {Rng,SIM_HZ} from '../../src/contract/index.ts';
import {UNREACHABLE} from '../../src/maps/index.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {cityUnoStart} from '../../src/sim/city/uno-start.ts';
import {AROUND_DETOUR_MAX,cityLoot} from '../../src/sim/stonewards/loot.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const manifest=JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string};
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,grid=cityFlowGrid(city),loot=cityLoot(city)!,start=cityUnoStart(city);
const STEP=1/SIM_HZ,ARRIVE=.6,NEAR=1.5;

/**
 * Seconds a hero takes from `from` to `to` walking the room's step (moveDirection), steered by a flow field to `to`
 * and straight at it once the line is clear; -1 when he does not get there within `limit` s.
 */
function walkTo(from:Point,to:Point,limit:number):number{
  const field=new FlowField(grid,[to]);
  let p={...from};
  for(let t=0;t<limit*SIM_HZ;t++){
    const d=Math.hypot(p.x-to.x,p.y-to.y);
    if(d<ARRIVE)return t/SIM_HZ;
    const dir=d<NEAR||clearSegment(p,to,city)?{x:to.x-p.x,y:to.y-p.y}:field.directionAt(p.x,p.y);
    p=moveDirection(p,dir,STEP,city);
  }
  return -1;
}
/** Every spot of `spots` the walker misses, with a budget of 3× its straight walk + 10 s. */
function missed(spots:readonly Point[]):Point[]{
  const speed=heroSpeed(city);
  return spots.filter(s=>walkTo(start,s,3*Math.hypot(s.x-start.x,s.y-start.y)/speed+10)<0);
}

test('the walker misses walkable ground walled off from the Uno (the check can fail)', ()=>{
  const fromStart=new FlowField(grid,[start]),cs=grid.cellSize;
  let shut:Point|undefined;
  for(let cy=0;cy<grid.height&&!shut;cy++)for(let cx=0;cx<grid.width&&!shut;cx++){
    const p={x:(cx+.5)*cs,y:(cy+.5)*cs};
    if(grid.walkable(cx,cy)&&fromStart.cellCost(cx,cy)===UNREACHABLE&&Math.hypot(p.x-start.x,p.y-start.y)<60)shut=p;
  }
  assert.ok(shut,'the city has a walled-off pocket near the Uno');
  assert.deepEqual(missed([shut]),[shut]);
});

// NEW-20261030-ORQ-uno-estaciona-fora-da-boca: the start moved off the street mouths to (85.7, 84.9), whence the way down
// at x ≈ 81.5 is on the road to k13 (1.26× the straight line): a first-minute spot again, under AROUND_DETOUR_MAX.
test('the k13 of the audit is reached from the Uno, by the way down under the start, within AROUND_DETOUR_MAX', ()=>{
  const k13={x:75.55,y:93.5};
  const at=loot.aroundUno.find(p=>p.x===k13.x&&p.y===k13.y);
  if(at)assert.ok(at.walk<=AROUND_DETOUR_MAX*Math.hypot(k13.x-start.x,k13.y-start.y),`k13 a start spot at ${at.walk} u on foot`);
  // Where the auditor stood: straight south is the mask's edge.
  for(const x of [71,73,75,77,79])assert.equal(clearSegment({x,y:88.5},{x,y:91.5},city),false,`x ${x}: the edge stops a straight walk`);
  const s=walkTo(start,k13,10);
  assert.ok(s>0&&s<5,`k13 reached in ${s} s`);
});

test('every placed-crate loot point is reached on foot from the Uno', ()=>{
  const spots=loot.crates.map(c=>({x:c.node.x,y:c.node.y}));
  assert.ok(spots.length>50);
  assert.deepEqual(missed(spots),[]);
});

test('every first-minute spot (around the Uno, around the wreck) and the plaza ring is reached from the Uno', ()=>{
  for(const [name,spots] of [['aroundUno',loot.aroundUno],['aroundStart',loot.aroundStart],['aroundPlaza',loot.aroundPlaza]] as const){
    assert.ok(spots.length>0,name);
    assert.deepEqual(missed(spots),[],name);
  }
});

test('trail spots (spotAhead) from walkable ground around the Uno are reached from the Uno', ()=>{
  const rng=new Rng(13),spots:Point[]=[];
  for(let i=0;spots.length<200&&i<4000;i++){
    const at={x:start.x+rng.range(-40,40),y:start.y+rng.range(-40,40)};
    if(!walkable(at,city)||walkTo(start,at,60)<0)continue;
    const a=rng.range(0,Math.PI*2),spot=loot.spotAhead(at,{x:Math.cos(a),y:Math.sin(a)},10,rng);
    if(spot)spots.push(spot);
  }
  assert.ok(spots.length>=100,`${spots.length} trail spots`);
  assert.deepEqual(missed(spots),[]);
});

test("the Uno's first-minute spots are at most AROUND_DETOUR_MAX × the straight line on foot from the start", ()=>{
  for(const p of loot.aroundUno)assert.ok(p.walk<=AROUND_DETOUR_MAX*Math.hypot(p.x-start.x,p.y-start.y)+.01,`${p.x},${p.y}: walk ${p.walk}`);
});

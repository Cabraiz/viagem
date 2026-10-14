/**
 * pontos-de-obra (D-041): the build sites around the Cidade Nevada plaza and the endless camp, the Gustavão's rail,
 * and the validator that keeps them honest (open ground, clear of the wall/forge, the mouths/barricades and the spawn,
 * nothing overlapping, everything reachable with all of it built). Result asserts only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  CityTerrain,TerrainField,decodeCityAsset,worldBase,worldSpawn,buildPlanFor,validateBuildPlan,footprint,railRect,rectDistance,
  CITY_BUILD_CELL,CITY_SITE_CELL,MOUTH_KEEP_OUT,ENDLESS_BUILD_CELL,MIN_SITES,MAX_SITES,type BuildPlan,type BuildSite,
} from '../../src/maps/index.ts';
import {CITY_MAP_SCALE,scaleProfile} from '../../src/rules/index.ts';
import {BARRICADE_MAX_R,sealRadii} from '../../src/sim/stonewards/barricades.ts';
import {cityPlanner} from '../../src/sim/city/grid.ts';
import {DEFENSES,ROOT_DEFENSE} from '../../src/sim/towers/catalog.ts';
import {DIRS} from '../../src/maps/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const city=new CityTerrain(decoded.asset,'test');
const endless=(seed:number)=>new TerrainField(seed,{world:'infinito'});
/** A site on the centre of asset cell (cx, cy): asset cells are CITY_SITE_CELL wide (the towers' own unit is CITY_BUILD_CELL). */
const cellSite=(id:string,cx:number,cy:number,maxSize:1|2|3=1):BuildSite=>({id,x:(cx+.5)*CITY_SITE_CELL,y:(cy+.5)*CITY_SITE_CELL,maxSize});

// NEW-20261013-ORQ-cidade-escala-1-7: the map grew 1.7× (asset version 2) while the towers kept the people's size.
test('the site rows are written in the asset cell (= the scale profile map cell); the towers keep the 0.88 u person cell', () => {
  assert.equal(CITY_SITE_CELL,decoded.asset.unitsPerCell,'build-sites CITY_SITE_CELL = asset unitsPerCell');
  assert.ok(Math.abs(scaleProfile('cidade-nevada').cell-CITY_SITE_CELL)<1e-12,'= rules cidade-nevada cell');
  assert.ok(Math.abs(CITY_BUILD_CELL*CITY_MAP_SCALE-CITY_SITE_CELL)<1e-12,'site cell = build cell × CITY_MAP_SCALE');
  assert.equal(CITY_BUILD_CELL,.88);
});
const reasons=(plan:BuildPlan,terrain:CityTerrain|TerrainField)=>validateBuildPlan(plan,terrain).map(p=>`${p.id}: ${p.reason}`);

test('the city has 12–16 build sites around the plaza and a 12×4 rail on the west avenue, all valid', () => {
  const plan=buildPlanFor(city);
  assert.equal(plan.cell,CITY_BUILD_CELL);
  assert.ok(plan.sites.length>=MIN_SITES&&plan.sites.length<=MAX_SITES,`${plan.sites.length} sites`);
  assert.deepEqual(reasons(plan,city),[]);
  assert.deepEqual([...new Set(plan.sites.map(s=>s.maxSize))].sort(),[2,3],'footprints from 2×2 to 3×3');
  const base=worldBase(city);
  // 25 u around the plaza on the .w3x map, × CITY_MAP_SCALE on the 1.7× one.
  for(const s of plan.sites)assert.ok(Math.hypot(s.x-base.x,s.y-base.y)<25*CITY_MAP_SCALE,`${s.id} is around the plaza`);
  const rail=plan.rail!;
  assert.equal(rail.length,12);assert.equal(rail.width,4);assert.equal(rail.axis,'x');
  const r=railRect(rail,plan.cell),west=decoded.asset.points.bocas.O;
  assert.ok(r.x+r.w<west.x&&r.y<west.y&&r.y+r.h>west.y-4,'the rail lies on the avenue leading into the west mouth');
});

test('the plan is fixed data: frozen, stable ids, the same object every call', () => {
  const plan=buildPlanFor(city);
  assert.equal(buildPlanFor(city),plan);
  assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.sites)&&plan.sites.every(Object.isFrozen));
  assert.deepEqual(plan.sites.map(s=>s.id),plan.sites.map((_,i)=>`obra-${String(i+1).padStart(2,'0')}`));
});

test('the endless camp has 12 fixed sites plus 3×3 ones past the clearing, valid on every seed, no rail; the island has none', () => {
  for(let k=1;k<=40;k++){
    const t=endless(k*2654435761>>>0),plan=buildPlanFor(t);
    assert.equal(plan.cell,ENDLESS_BUILD_CELL);
    assert.ok(plan.sites.length>=MIN_SITES&&plan.sites.length<=MAX_SITES);assert.equal(plan.rail,null);
    assert.ok(plan.sites.filter(s=>s.maxSize===3).length>=2,`seed ${k}: room for the 3×3 ápices`);
    assert.equal(buildPlanFor(t),plan);
    assert.deepEqual(reasons(plan,t),[],`seed ${k}`);
  }
  const t=endless(7),plan=buildPlanFor(t),base=worldBase(t);
  for(const s of plan.sites)assert.ok(rectDistance(footprint(s,s.maxSize,plan.cell),base)>=3,`${s.id} leaves the wall free`);
  assert.deepEqual(buildPlanFor(new TerrainField(7)).sites,[]);
  assert.deepEqual(buildPlanFor().sites,[]);
});

test('a smaller build sits inside the site’s largest footprint, centred', () => {
  const s=buildPlanFor(city).sites.find(x=>x.maxSize===3)!;
  const big=footprint(s,3,CITY_BUILD_CELL),small=footprint(s,1,CITY_BUILD_CELL);
  assert.ok(small.x>big.x&&small.y>big.y&&small.x+small.w<big.x+big.w&&small.y+small.h<big.y+big.h);
  assert.ok(Math.abs(big.w-3*CITY_BUILD_CELL)<1e-9&&Math.abs(small.x+small.w/2-s.x)<1e-9);
});

test('the validator refuses a site on a building, the wall, a mouth, the spawn, or on top of another', () => {
  const plan=buildPlanFor(city),base=worldBase(city),mouth=decoded.asset.points.bocas.N,spawn=worldSpawn(city);
  const withSite=(site:BuildSite):BuildPlan=>({...plan,sites:[...plan.sites.slice(0,15),site]});
  assert.ok(reasons(withSite(cellSite('x',94,86)),city).includes('x: não cabe no chão livre'));
  assert.ok(reasons(withSite({id:'x',x:base.x,y:base.y,maxSize:1}),city).includes('x: cobre a muralha/forja'));
  assert.ok(reasons(withSite({id:'x',x:mouth.x,y:mouth.y-2,maxSize:1}),city).includes('x: cobre uma boca/barricada'));
  assert.ok(reasons(withSite({id:'x',x:spawn.x+.5,y:spawn.y,maxSize:1}),city).includes('x: cobre o ponto de nascer'));
  const first=plan.sites[0];
  assert.ok(reasons(withSite({...first,id:'x'}),city).some(r=>/sobrepõe x$/.test(r)));
  const rail=railRect(plan.rail!,plan.cell);
  assert.ok(reasons(withSite({id:'x',x:rail.x+rail.w/2,y:rail.y+rail.h/2,maxSize:1}),city).includes('x: sobrepõe trilho'));
  assert.ok(reasons({...plan,sites:plan.sites.slice(0,8)},city).some(r=>r.startsWith('plano:')),'too few sites');
});

test('a ring of builds that walls the camp in is refused: the base must stay reachable', () => {
  const t=endless(11),base=worldBase(t),sites:BuildSite[]=[];
  for(let i=0;i<16;i++){const a=i/16*2*Math.PI;sites.push({id:`r${i}`,x:base.x+6*Math.cos(a),y:base.y+6*Math.sin(a),maxSize:2});}
  const out=reasons({cell:ENDLESS_BUILD_CELL,sites,rail:null},t);
  assert.ok(out.some(r=>/não chega na base/.test(r)),out.join('\n'));
});

test('MOUTH_KEEP_OUT is the barricade\'s largest seal (kept by hand: maps may not import the sim)',()=>{
  assert.ok(Math.abs(MOUTH_KEEP_OUT-BARRICADE_MAX_R)<1e-9,`${MOUTH_KEEP_OUT} vs ${BARRICADE_MAX_R}`);
});

// NEW-20261014-ORQ-balanco-pos-1-7-e-chaveiro (part A): on the 1.7× city the mouths N/L/O sit 18.7–21.5 u from the wall
// and the old ring of sites 12–15 u from them, out of a root tower's range. The plan now opens with a 3×3 on each side
// of the last stretch of those avenues, interleaved N, L, O (the bots build the largest free site in plan order).
test('the first six city sites are 3×3 beside the N, L and O avenues, in reach of the bodies walking up to the barricade', () => {
  const plan=buildPlanFor(city),pts=decoded.asset.points,mouths=['N','L','O','N','L','O'] as const;
  const range=DEFENSES[ROOT_DEFENSE].range,seal=sealRadii(city),field=cityPlanner(city).plazaField,cs=field.cellSize;
  /** The enemies' route from the avenue end to the plaza (the planner's plaza field), cell centres. */
  const route=(m:'N'|'L'|'O')=>{
    const at=pts[`spawn${m}`],out:{x:number;y:number}[]=[];
    let cx=Math.floor(at.x/cs),cy=Math.floor(at.y/cs);
    for(let i=0;i<1000;i++){
      out.push({x:(cx+.5)*cs,y:(cy+.5)*cs});
      if(field.cellCost(cx,cy)===0)break;
      const d=field.nextCell(cx,cy);if(d<0)break;
      cx+=DIRS[d].dx;cy+=DIRS[d].dy;
    }
    return out;
  };
  plan.sites.slice(0,6).forEach((s,i)=>{
    const m=mouths[i],mouth=pts.bocas[m],fromMouth=Math.hypot(s.x-mouth.x,s.y-mouth.y);
    assert.equal(s.maxSize,3,`${s.id} is a 3×3`);
    assert.ok(fromMouth<10.5,`${s.id} is ${fromMouth.toFixed(1)} u from mouth ${m}`);
    // The avenue's last 8 u outside the barricade: the bodies walk it and stand on it while they bash the barricade.
    const stretch=route(m).filter(p=>{const d=Math.hypot(p.x-mouth.x,p.y-mouth.y);return d>=seal[m]!&&d<=8;});
    assert.ok(stretch.length>=3,`mouth ${m}: ${stretch.length} route cells`);
    const inRange=stretch.filter(p=>Math.hypot(p.x-s.x,p.y-s.y)<=range+.25);
    assert.ok(inRange.length>=1,`${s.id}: a root (range ${range}) reaches the last stretch of avenue ${m}`);
  });
  for(const m of ['N','L','O'] as const){
    const near=plan.sites.filter(s=>Math.hypot(s.x-pts.bocas[m].x,s.y-pts.bocas[m].y)<10.5);
    assert.ok(near.length>=2,`mouth ${m} has ${near.length} sites within 10.5 u`);
  }
});

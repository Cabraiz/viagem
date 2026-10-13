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
  CITY_BUILD_CELL,ENDLESS_BUILD_CELL,MIN_SITES,MAX_SITES,type BuildPlan,type BuildSite,
} from '../../src/maps/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const city=new CityTerrain(decoded.asset,'test');
const endless=(seed:number)=>new TerrainField(seed,{world:'infinito'});
const cellSite=(id:string,cx:number,cy:number,maxSize:1|2|3=1):BuildSite=>({id,x:(cx+.5)*CITY_BUILD_CELL,y:(cy+.5)*CITY_BUILD_CELL,maxSize});
const reasons=(plan:BuildPlan,terrain:CityTerrain|TerrainField)=>validateBuildPlan(plan,terrain).map(p=>`${p.id}: ${p.reason}`);

test('the city has 12–16 build sites around the plaza and a 12×4 rail on the west avenue, all valid', () => {
  const plan=buildPlanFor(city);
  assert.equal(plan.cell,CITY_BUILD_CELL);
  assert.ok(plan.sites.length>=MIN_SITES&&plan.sites.length<=MAX_SITES,`${plan.sites.length} sites`);
  assert.deepEqual(reasons(plan,city),[]);
  assert.deepEqual([...new Set(plan.sites.map(s=>s.maxSize))].sort(),[2,3],'footprints from 2×2 to 3×3');
  const base=worldBase(city);
  for(const s of plan.sites)assert.ok(Math.hypot(s.x-base.x,s.y-base.y)<25,`${s.id} is around the plaza`);
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

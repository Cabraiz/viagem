import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {
  WC3_UNIT,WC3_CELL,CIDADE_NEVADA_WC3,SCALE_PROFILES,scaleProfile,isMapId,wc3ToUnits,unitsToWc3,cellsToUnits,unitsToCells,
  heroWidthCells,enemySpeed,relativeRadius,traversalSeconds,convertSpeed,cameraOrientation,visibleWidthUnits,zoomFor,
  floorWidthUnits,
} from '../../src/rules/scale.ts';
import type {MapId,ScaleProfile} from '../../src/rules/scale.ts';
import {CITY_HERO_SPEED,HERO_SPEED_MULT,RADIUS,SPEED,baseHeroSpeed,heroSpeed} from '../../src/maps/world.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {CAMP_RADIUS,WALK_SPEED,returnTicks} from '../../src/rules/stonewards.ts';
import {SIM_HZ} from '../../src/contract/index.ts';
import {HERO_MIN_SCREEN_PX} from '../../src/contract/index.ts';
import {ENEMIES} from '../../src/sim/enemies/catalog.ts';
import {UNITS_PER_CELL} from '../../src/maps/city-asset.ts';

const near=(actual:number,expected:number,tol:number,what:string)=>
  assert.ok(Math.abs(actual-expected)<=tol,`${what}: ${actual} not within ${tol} of ${expected}`);
const within=(actual:number,min:number,max:number,what:string)=>
  assert.ok(actual>=min&&actual<=max,`${what}: ${actual} not in [${min},${max}]`);
const city=scaleProfile('cidade-nevada'),inf=scaleProfile('infinito');
const widthsPerSecond=(speed:number,p:ScaleProfile)=>speed/(2*p.hero.radius);

/** Tiny stand-in for the future public/maps/cidade-nevada.json, built from the documented WC3 distances (mvp-mapa-snow.md). */
const startToPlaza=wc3ToUnits(CIDADE_NEVADA_WC3.startToPlaza),plazaToSpawn=wc3ToUnits(CIDADE_NEVADA_WC3.plazaToSpawn);
const centre=cellsToUnits(CIDADE_NEVADA_WC3.mapCells,city)/2;
const EXAMPLE_ASSET={
  cell:.88,
  points:{praca:{x:centre,y:centre},inicio:{x:centre,y:centre+startToPlaza*.8},spawnS:{x:centre+plazaToSpawn*.3,y:centre+plazaToSpawn*.7}},
  paths:{'inicio-praca':startToPlaza,'praca-spawnS':plazaToSpawn},
};

test('constants: cell, WC3 round-trip, frozen profiles, lookups',()=>{
  assert.equal(WC3_CELL,128);assert.equal(WC3_UNIT,.006875);
  near(city.cell,.88,1e-12,'cidade cell');near(WC3_CELL*WC3_UNIT,.88,1e-12,'128 × WC3_UNIT');
  for(const v of [0,1,32,290,9600,24576])near(unitsToWc3(wc3ToUnits(v)),v,1e-9,`wc3 round-trip ${v}`);
  near(unitsToCells(cellsToUnits(7.5,city),city),7.5,1e-12,'cells round-trip');
  for(const p of Object.values(SCALE_PROFILES)){
    assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.hero)&&Object.isFrozen(p.sizes)&&Object.isFrozen(p.sizes.boss));
    assert.ok(Object.isFrozen(p.zoom)&&Object.isFrozen(p.zoom.portrait)&&Object.isFrozen(p.zoom.landscape));
    assert.throws(()=>{(p.hero as {speed:number}).speed=99;},TypeError);
    assert.throws(()=>{(p.sizes.boss as {max:number}).max=99;},TypeError);
    assert.throws(()=>{(p.zoom.landscape as unknown as number[])[0]=1;},TypeError);
  }
  assert.ok(Object.isFrozen(SCALE_PROFILES)&&Object.isFrozen(CIDADE_NEVADA_WC3)&&Object.isFrozen(CIDADE_NEVADA_WC3.bossScale));
  assert.throws(()=>{(SCALE_PROFILES as Record<string,unknown>).infinito=null;},TypeError);
  assert.equal(scaleProfile('infinito').id,'infinito');assert.equal(city.id,'cidade-nevada');
  assert.throws(()=>scaleProfile('lua' as MapId));assert.throws(()=>scaleProfile('toString' as MapId));
  assert.equal(isMapId('infinito'),true);assert.equal(isMapId('cidade-nevada'),true);
  for(const v of ['lua','','toString','__proto__',null,undefined,1,{}])assert.equal(isMapId(v),false,String(v));
});

test('cidade-nevada keeps the D-026 person × terrain ratios',()=>{
  near(heroWidthCells(city),.5,.01,'hero width in cells');
  near(city.hero.speed,2,.01,'hero speed');near(city.hero.speed,1.99375,1e-12,'hero speed exact');
  near(enemySpeed(city)/city.hero.speed,.9,.01,'enemy/hero speed');assert.ok(enemySpeed(city)<city.hero.speed,'enemy slower than hero');
  near(relativeRadius(city,city.sizes.enemy)/city.hero.radius,1.3,1e-12,'enemy radius ratio');
  near(city.sizes.boss.min,2,1e-12,'boss min');near(city.sizes.boss.max,3.5,1e-12,'boss max');
  near(relativeRadius(city,city.sizes.boss.max),3.5*city.hero.radius,1e-12,'boss max radius');
  near(widthsPerSecond(city.hero.speed,city),4.53,.1,'hero widths per second');
  const side=cellsToUnits(CIDADE_NEVADA_WC3.mapCells,city);
  near(side,169,1,'city side in units');near(traversalSeconds(side,city),85,2,'city crossing seconds');
});

test('example asset: start → plaza ≈ 33 s, plaza → spawn ≈ 36 s, enemies are slower',()=>{
  const a=EXAMPLE_ASSET;
  near(a.cell,city.cell,1e-12,'asset cell');
  const hypot=(p:{x:number;y:number},q:{x:number;y:number})=>Math.hypot(p.x-q.x,p.y-q.y);
  assert.ok(hypot(a.points.inicio,a.points.praca)<=a.paths['inicio-praca']+1e-9,'path ≥ straight line');
  assert.ok(hypot(a.points.praca,a.points.spawnS)<=a.paths['praca-spawnS']+1e-9,'path ≥ straight line');
  near(traversalSeconds(a.paths['inicio-praca'],city),33,1.5,'inicio → praca');
  near(traversalSeconds(a.paths['praca-spawnS'],city),36,1.5,'praca → spawnS');
  for(const d of Object.values(a.paths))assert.ok(traversalSeconds(d,city,enemySpeed(city))>traversalSeconds(d,city),'escape is possible');
});

test('the city asset format and the scale profile agree on the cell size (drift guard)',()=>{
  assert.equal(UNITS_PER_CELL,city.cell,'src/maps/city-asset.ts UNITS_PER_CELL = cidade-nevada cell (0.88)');
});

test('real cidade-nevada asset (when imported): same cell size, straight start → plaza walk is 25–38 s',t=>{
  const url=new URL('../../public/maps/cidade-nevada.json',import.meta.url);
  // Only a missing file skips; a present asset with a wrong scale or missing points fails.
  if(!existsSync(url)){t.skip('asset not imported yet');return;}
  // D-027 (viagem-city) keeps the scale in the top-level unitsPerCell.
  const asset=JSON.parse(readFileSync(url,'utf8')) as {unitsPerCell?:unknown;points?:Record<string,{x?:unknown;y?:unknown}>};
  near(Number(asset.unitsPerCell),city.cell,1e-9,'asset unitsPerCell = profile cell');
  const start=asset.points?.inicio,plaza=asset.points?.praca;
  const ok=(p:{x?:unknown;y?:unknown}|undefined):p is {x:number;y:number}=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  assert.ok(ok(start)&&ok(plaza),'asset has points.inicio and points.praca');
  // The doc's ~33 s (9,600 WC3 u) was an estimate: the real straight line already measures more.
  // The source start→boss line is ~34.4 s; the importer moves inicio ~1.9 u off the wreck for clearance (cidade-01).
  within(traversalSeconds(Math.hypot(start.x-plaza.x,start.y-plaza.y),city),25,38,'asset inicio → praca seconds');
});

test('zoom per orientation: faithful 18 / 10–11 cells, narrowed by the 56 px floor (D-030)',()=>{
  assert.equal(cameraOrientation(390,844),'portrait');assert.equal(cameraOrientation(844,390),'landscape');assert.equal(cameraOrientation(500,500),'portrait');assert.equal(cameraOrientation(501,500),'landscape');
  near(visibleWidthUnits(city,'landscape')/city.cell,18,1e-9,'landscape cells');
  near(visibleWidthUnits(city,'portrait')/city.cell,10.5,1e-9,'portrait cells (midpoint of 10–11)');
  const land=zoomFor(city,844,390),port=zoomFor(city,390,844);
  assert.equal(land.orientation,'landscape');assert.equal(port.orientation,'portrait');
  near(land.pixelsPerUnit*land.visibleWidth,844,1e-9,'landscape fills the viewport width');
  // D-030: on the reference phones the floor wins in both orientations; the hero is drawn at exactly 56 px.
  assert.ok(land.floored&&port.floored,'floor binds on both reference phones');
  near(land.heroPixels,HERO_MIN_SCREEN_PX,1e-9,'landscape hero = 56 px floor');
  near(port.heroPixels,HERO_MIN_SCREEN_PX,1e-9,'portrait hero = 56 px floor');
  near(land.visibleCells,844/56,1e-9,'landscape ≈15.1 cells');within(land.visibleCells,13.5,15.5,'landscape ~14 cells (D-030)');
  near(port.visibleCells,390/56,1e-9,'portrait ≈7.0 cells');within(port.visibleCells,6.5,7.5,'portrait ~7 cells (D-030)');
  assert.ok(land.visibleWidth<visibleWidthUnits(city,'landscape')&&port.visibleWidth<visibleWidthUnits(city,'portrait'),'never wider than the faithful view');
  // Without the floor the faithful view gives the doc's ~45 / ~37 px (heroPixels is the drawn ~1-cell figure).
  near(zoomFor(city,844,390,1).heroPixels,844/18,1e-9,'faithful landscape ≈47 px');near(zoomFor(city,390,844,1).heroPixels,390/10.5,1e-9,'faithful portrait ≈37 px');
  assert.equal(zoomFor(city,844,390,1).floored,false);
  near(floorWidthUnits(city,844),844*city.cell/56,1e-9,'floor width');
  near(city.hero.drawnSize,city.cell,1e-12,'drawn hero ≈ one cell');
  near(land.bodyPixels,land.heroPixels/2,1e-9,'collision is half the drawn figure');
  // Same measure as today's camera floor: the endless map's drawn hero is exactly HERO_MIN_SCREEN_PX.
  const inf=scaleProfile('infinito');
  near(zoomFor(inf,390,844).heroPixels,HERO_MIN_SCREEN_PX,1e-9,'infinito portrait hero = 56 px floor');
  near(zoomFor(inf,844,390).heroPixels,HERO_MIN_SCREEN_PX,1e-9,'infinito landscape hero = 56 px floor');
  assert.equal(zoomFor(inf,390,844).floored,false,'infinito is tuned at the floor, not narrowed by it');
  // A big tablet reaches the faithful view (floor no longer binds); a slightly bigger phone stays at the floor.
  const big=zoomFor(city,1688,780);assert.equal(big.floored,false);near(big.visibleCells,18,1e-9,'tablet sees the faithful 18 cells');
  assert.ok(big.heroPixels>HERO_MIN_SCREEN_PX);
  near(zoomFor(city,430,932).pixelsPerUnit,port.pixelsPerUnit,1e-9,'bigger phone in portrait stays at the floor scale');
  assert.throws(()=>zoomFor(city,390,844,0),RangeError,'floor must be positive');
});

test('conversions: identity, hero-speed share, relative radius, linear enemy speed',()=>{
  for(const p of [inf,city])for(const x of [0,1.4,3.1,7])near(convertSpeed(x,p,p),x,1e-12,`identity ${p.id} ${x}`);
  // The endless hero (3.1 u/s) becomes the city hero (~2.0 u/s); a bêbado keeps its share of the hero speed.
  near(convertSpeed(inf.hero.speed,inf,city),city.hero.speed,1e-12,'hero 3.1 → 1.99');
  near(convertSpeed(1.4,inf,city),1.4/3.1*city.hero.speed,1e-12,'bebado 1.4 → ~0.90');
  assert.ok(convertSpeed(3.1,inf,city)<3.1,'the city is slower, the conversion is not a no-op');
  for(const x of [inf.hero.speed,1.4,.5])near(convertSpeed(x,inf,city)/city.hero.speed,x/inf.hero.speed,1e-12,`share ${x}`);
  near(convertSpeed(convertSpeed(2.4,inf,city),city,inf),2.4,1e-12,'speed round-trip');
  for(const p of [inf,city]){
    assert.equal(relativeRadius(p,1),p.hero.radius);near(relativeRadius(p,2.5),2.5*p.hero.radius,1e-12,'relative 2.5');
    near(enemySpeed(p,2),2*enemySpeed(p),1e-12,'multiplier 2');near(enemySpeed(p,.5),enemySpeed(p)/2,1e-12,'multiplier .5');
    assert.equal(enemySpeed(p,1),enemySpeed(p));assert.equal(enemySpeed(p,0),0);
  }
});

test('infinito equals the current game code (drift guard)',()=>{
  assert.equal(inf.hero.radius,RADIUS);assert.equal(inf.hero.speed,SPEED);assert.equal(HERO_MIN_SCREEN_PX,56,'56 px floor');
  assert.equal(inf.hero.radius,.22);assert.equal(inf.hero.speed,3.1);assert.equal(inf.cell,1);
  near(enemySpeed(inf),ENEMIES.bebado.speed,1e-12,'bebado speed');
  near(relativeRadius(inf,inf.sizes.enemy),ENEMIES.bebado.radius,1e-12,'bebado radius');
  near(relativeRadius(inf,inf.sizes.boss.max),ENEMIES.chefe.radius,1e-12,'chefe radius');
  assert.ok(inf.sizes.boss.min<=inf.sizes.boss.max);
});

test('maps walks at 2 × the profile speeds: base city CITY_HERO_SPEED, island and infinito SPEED (drift guard)',()=>{
  // Exact equality: maps repeats 290 × 0.006875 (it may not import rules), so any drift on either side fails here.
  assert.equal(CITY_HERO_SPEED,SCALE_PROFILES['cidade-nevada'].hero.speed,'world.ts CITY_HERO_SPEED = cidade-nevada hero.speed');
  assert.equal(SPEED,SCALE_PROFILES.infinito.hero.speed,'world.ts SPEED = infinito hero.speed');
  // The profiles keep the BASE walk (enemySpeed/citySpeed multiply by it: enemies must not get faster); the heroes walk
  // HERO_SPEED_MULT × it (velocidade-heroi-e-projetil).
  assert.equal(baseHeroSpeed({world:'cidade'} as unknown as TerrainField),city.hero.speed,'baseHeroSpeed(city)');
  assert.equal(baseHeroSpeed(new TerrainField(7,{world:'infinito'})),inf.hero.speed,'baseHeroSpeed(infinito)');
  assert.equal(baseHeroSpeed(new TerrainField(7)),SPEED,'baseHeroSpeed(island)');assert.equal(baseHeroSpeed(),SPEED,'baseHeroSpeed(no terrain)');
  assert.equal(HERO_SPEED_MULT,2);
  assert.equal(heroSpeed({world:'cidade'} as unknown as TerrainField),city.hero.speed*HERO_SPEED_MULT,'heroSpeed(city)');
  assert.equal(heroSpeed(new TerrainField(7,{world:'infinito'})),inf.hero.speed*HERO_SPEED_MULT,'heroSpeed(infinito)');
  assert.equal(heroSpeed(new TerrainField(7)),SPEED*HERO_SPEED_MULT,'heroSpeed(island)');assert.equal(heroSpeed(),SPEED*HERO_SPEED_MULT,'heroSpeed(no terrain)');
  near(enemySpeed(inf),ENEMIES.bebado.speed,1e-12,'the enemy speeds still derive from the base hero');
  // The horn's return estimate (stonewards.ts) is told the world's speed: the slower city hero gets more time.
  assert.equal(WALK_SPEED,SPEED,'stonewards WALK_SPEED = world.ts SPEED');
  assert.equal(returnTicks(150),returnTicks(150,SPEED));
  assert.equal(returnTicks(150,CITY_HERO_SPEED),Math.ceil(((150-CAMP_RADIUS)/CITY_HERO_SPEED*1.1+2)*SIM_HZ));
  assert.ok(returnTicks(80,CITY_HERO_SPEED)>returnTicks(80,SPEED),'city return takes longer');
  assert.equal(returnTicks(CAMP_RADIUS,CITY_HERO_SPEED),0);
  for(const bad of [0,-1,Number.NaN,Number.POSITIVE_INFINITY])assert.equal(returnTicks(150,bad),returnTicks(150),`speed ${bad} falls back`);
});

test('input validation',()=>{
  for(const d of [Number.NaN,-1,Number.POSITIVE_INFINITY])assert.throws(()=>traversalSeconds(d,city),RangeError,`distance ${d}`);
  for(const s of [0,-2,Number.NaN])assert.throws(()=>traversalSeconds(10,city,s),RangeError,`speed ${s}`);
  assert.equal(traversalSeconds(0,city),0);
  for(const v of [Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY]){
    assert.throws(()=>cellsToUnits(v,city),RangeError);assert.throws(()=>wc3ToUnits(v),RangeError);
    assert.throws(()=>unitsToWc3(v),RangeError);assert.throws(()=>unitsToCells(v,city),RangeError);
  }
  assert.throws(()=>cameraOrientation(0,100),RangeError);
  // Hand-built bad profiles are rejected, not silently used.
  const bad=(patch:object)=>({...city,...patch}) as unknown as ScaleProfile;
  assert.throws(()=>visibleWidthUnits(bad({zoom:{landscape:[18,18],portrait:[11,10]}}),'portrait'),RangeError,'inverted zoom range');
  assert.throws(()=>zoomFor(bad({hero:{...city.hero,drawnSize:0}}),390,844),RangeError,'zero drawn size');
  assert.throws(()=>visibleWidthUnits(city,'sideways' as never),RangeError,'unknown orientation');assert.throws(()=>zoomFor(city,Number.NaN,100),RangeError);
  assert.throws(()=>convertSpeed(-1,inf,city),RangeError);assert.throws(()=>enemySpeed(city,-1),RangeError);
});

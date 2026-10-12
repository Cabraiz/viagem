/**
 * cidade-06 (base-praca, part 1): per-room blocking discs on the city terrain. The decoded city is shared by every
 * room of the process, so barricades live on a `fork()` of it: same asset and signature, its own blockers. Blockers
 * stop ENEMIES only: the terrain's own clearDisc (land/walkable/moveDirection: heroes, bots, client prediction) ignores
 * them; its `forEnemies()` view (`enemyTerrain`: moveSafely, the flow grid) treats them as solid. Result asserts only
 * (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityAsField,enemyTerrain} from '../../src/maps/city/terrain.ts';
import {encodeCityAsset,decodeCityAsset,type CityAssetData,type CityPoint} from '../../src/maps/city-asset.ts';
import {walkable,moveDirection,RADIUS} from '../../src/maps/world.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {moveSafely} from '../../src/sim/enemies/ai.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;

function build(json:string,hash:string):CityTerrain{
  const r=decodeCityAsset(json);
  if(!r.ok)throw new Error(r.error);
  return new CityTerrain(r.asset,hash);
}
/** A fully walkable 6×6-cell city (5.28 u square): only the map edge and the blockers block. */
function openCity():CityTerrain{
  const c:CityPoint={x:2.64,y:2.64},p:CityPoint={x:1,y:1};
  const data:CityAssetData={
    id:'aberta',version:1,name:'Aberta',cells:{w:6,h:6},unitsPerCell:.88,playable:{x:0,y:0,w:5.28,h:5.28},
    walkable:new Uint8Array(24*24).fill(1),heights:new Float32Array(7*7),
    points:{praca:c,inicio:p,spawnN:p,spawnS:p,spawnL:p,spawnO:p,bocas:{N:p,S:p,L:p,O:p}},
    blocks:[],props:[],loot:[],
  };
  return build(encodeCityAsset(data),'aberta-city-blockers-test');
}
const C={x:2.64,y:2.64};

test('a blocker disc blocks enemy bodies that overlap it, lets touching ones stand, and unblocks when removed',()=>{
  const city=openCity(),t=city.forEnemies(),field=cityAsField(t);
  assert.equal(t.blockerVersion,0);assert.deepEqual(t.blockers(),[]);
  assert.equal(t.clearDisc(C.x,C.y,0),true);assert.equal(t.clearDisc(C.x,C.y,RADIUS),true);
  t.setBlocker('barricada-N',{x:C.x,y:C.y,r:1});
  assert.equal(t.blockerVersion,1);assert.equal(city.blockerVersion,1,'the view sets the blockers of its terrain');
  assert.deepEqual(city.blockers(),t.blockers());
  // The terrain itself (heroes) ignores blockers: the same queries are clear there.
  assert.equal(city.clearDisc(C.x,C.y,0),true);assert.equal(city.clearDisc(C.x,C.y,RADIUS),true);
  assert.equal(walkable(C,cityAsField(city)),true);assert.equal(city.land(C.x+1.1,C.y,RADIUS),true);
  // Points (r = 0): inside the disc is blocked, outside is not.
  assert.equal(t.clearDisc(C.x,C.y,0),false,'centre');
  assert.equal(t.clearDisc(C.x+.99,C.y,0),false,'just inside');
  assert.equal(t.clearDisc(C.x+1.01,C.y,0),true,'just outside');
  // Discs: overlap blocks, touching (centres r + 1 apart) does not, in every direction.
  for(let k=0;k<16;k++){
    const a=k*Math.PI/8,ux=Math.cos(a),uy=Math.sin(a);
    assert.equal(t.clearDisc(C.x+ux*(1+RADIUS),C.y+uy*(1+RADIUS),RADIUS),true,`touching at angle ${k}`);
    assert.equal(t.clearDisc(C.x+ux*(1+RADIUS-.01),C.y+uy*(1+RADIUS-.01),RADIUS),false,`overlapping at angle ${k}`);
  }
  // land/walkable (the hero rule) read the same union.
  assert.equal(t.land(C.x+1.1,C.y,RADIUS),false);assert.equal(walkable({x:C.x+1.1,y:C.y},field),false);
  assert.equal(walkable({x:C.x+1.3,y:C.y},field),true);
  // A second blocker joins the union; removing one leaves the other.
  t.setBlocker('barricada-S',{x:.8,y:.8,r:.3});
  assert.equal(t.clearDisc(.8,.8,0),false);assert.equal(t.blockerVersion,2);
  t.setBlocker('barricada-N',undefined);
  assert.equal(t.clearDisc(C.x,C.y,RADIUS),true,'removed');assert.equal(t.clearDisc(.8,.8,0),false,'the other one stays');
  assert.equal(t.blockerVersion,3);
  t.setBlocker('barricada-S',undefined);
  assert.equal(t.blockerVersion,4);assert.deepEqual(t.blockers(),[]);
  // The edge of the map still blocks with no blockers at all.
  assert.equal(t.clearDisc(.1,2,RADIUS),false);
});

test('blockerVersion moves only on real changes; bad discs are refused',()=>{
  const t=openCity(),e=t.forEnemies();
  t.setBlocker('a',{x:1,y:1,r:.5});assert.equal(t.blockerVersion,1);assert.equal(e.blockerVersion,1);
  t.setBlocker('a',{x:1,y:1,r:.5});assert.equal(t.blockerVersion,1,'same disc: no-op');
  t.setBlocker('a',{x:1.5,y:1,r:.5});assert.equal(t.blockerVersion,2,'moved');
  assert.equal(e.clearDisc(1,1,0),true);assert.equal(e.clearDisc(1.5,1,0),false);assert.equal(t.clearDisc(1.5,1,0),true,'heroes');
  t.setBlocker('a',{x:1.5,y:1,r:.75});assert.equal(t.blockerVersion,3,'resized');
  t.setBlocker('ausente',undefined);assert.equal(t.blockerVersion,3,'removing an absent id: no-op');
  for(const bad of [{x:NaN,y:1,r:1},{x:1,y:Infinity,r:1},{x:1,y:1,r:0},{x:1,y:1,r:-1},{x:1,y:1,r:NaN},{x:1,y:1,r:Infinity}])
    assert.throws(()=>t.setBlocker('b',bad),RangeError,JSON.stringify(bad));
  assert.equal(t.blockerVersion,3);assert.deepEqual(t.blockers().map(b=>b.id),['a']);
});

test('blockers() is sorted by id whatever the insertion order, frozen, and stable until the next change',()=>{
  const ids=['barricada-S','barricada-L','barricada-O','barricada-N'];
  const disc=(i:number)=>({x:1+i*.9,y:1,r:.3});
  const a=openCity(),b=openCity();
  ids.forEach((id,i)=>a.setBlocker(id,disc(i)));
  [...ids].reverse().forEach(id=>b.setBlocker(id,disc(ids.indexOf(id))));
  assert.deepEqual(a.blockers(),b.blockers());
  assert.deepEqual(a.blockers().map(x=>x.id),['barricada-L','barricada-N','barricada-O','barricada-S']);
  assert.deepEqual(a.blockers()[1],{id:'barricada-N',...disc(3)});
  // Same queries, same answers, on both terrains (deterministic union).
  for(let y=.3;y<5;y+=.17)for(let x=.3;x<5;x+=.13)for(const r of [0,.22])assert.equal(a.forEnemies().clearDisc(x,y,r),b.forEnemies().clearDisc(x,y,r),`(${x},${y}) r=${r}`);
  const list=a.blockers();
  assert.ok(Object.isFrozen(list)&&Object.isFrozen(list[0]));
  assert.equal(a.blockers(),list,'same array while nothing changes');
  a.setBlocker('barricada-N',undefined);
  assert.notEqual(a.blockers(),list);assert.equal(list.length,4,'an old list is a snapshot');
});

test('fork isolation: two forks of the shared city never see each other\'s blockers, nor change the original',()=>{
  const shared=build(TEXT,HASH),p=shared.asset.points.praca;
  const a=shared.fork(),b=shared.fork();
  assert.ok(a instanceof CityTerrain&&a!==shared&&b!==a);
  assert.equal(a.asset,shared.asset,'no asset copy');assert.equal(a.signature,shared.signature);assert.equal(a.world,'cidade');
  assert.equal(a.blockerVersion,0);assert.deepEqual(a.blockers(),[]);
  a.setBlocker('barricada-N',{x:p.x,y:p.y,r:2});
  assert.equal(a.forEnemies().clearDisc(p.x,p.y,RADIUS),false);
  assert.equal(b.forEnemies().clearDisc(p.x,p.y,RADIUS),true,'the other fork');
  assert.equal(shared.forEnemies().clearDisc(p.x,p.y,RADIUS),true,'the original');
  assert.deepEqual(b.blockers(),[]);assert.deepEqual(shared.blockers(),[]);assert.equal(b.blockerVersion,0);
  // A fork starts from a copy of the current blockers, then goes its own way.
  const c=a.fork();
  assert.deepEqual(c.blockers(),a.blockers());assert.equal(c.forEnemies().clearDisc(p.x,p.y,0),false);
  c.setBlocker('barricada-N',undefined);
  assert.equal(c.forEnemies().clearDisc(p.x,p.y,RADIUS),true);assert.equal(a.forEnemies().clearDisc(p.x,p.y,RADIUS),false,'the parent keeps its blocker');
  // A fork of the enemy view is a fork of its terrain (independent), not a view.
  const d=a.forEnemies().fork();
  assert.ok(d!==a&&d.forEnemies()!==a.forEnemies());assert.deepEqual(d.blockers(),a.blockers());
  a.setBlocker('barricada-S',{x:p.x+5,y:p.y,r:1});assert.deepEqual(c.blockers(),[]);
  // A fork without blockers is the original, sample for sample, and so are heights.
  for(let y=-1;y<171;y+=1.37)for(let x=-1;x<171;x+=1.13){
    for(const r of [0,RADIUS,.9]){
      assert.equal(b.clearDisc(x,y,r),shared.clearDisc(x,y,r),`(${x},${y}) r=${r}`);
      assert.equal(b.forEnemies().clearDisc(x,y,r),shared.clearDisc(x,y,r),`enemy view (${x},${y}) r=${r}`);
      assert.equal(a.clearDisc(x,y,r),shared.clearDisc(x,y,r),`heroes ignore a's blockers (${x},${y}) r=${r}`);
    }
    assert.equal(b.height(x,y),shared.height(x,y));
  }
});

test('enemy bodies pushed into a blocker stop at its rim, heroes walk through; the flow grid of the fork loses the covered cells',()=>{
  const city=build(TEXT,HASH).fork(),field=cityAsField(city),enemy=city.forEnemies(),m=city.asset.points.bocas.N,R=1.5;
  const before=cityFlowGrid(city);
  city.setBlocker('barricada-N',{x:m.x,y:m.y,r:R});
  const after=cityFlowGrid(city),cs=city.asset.unitsPerCell;
  let lost=0;
  for(let cy=0;cy<after.height;cy++)for(let cx=0;cx<after.width;cx++){
    const centre={x:(cx+.5)*cs,y:(cy+.5)*cs},inside=Math.hypot(centre.x-m.x,centre.y-m.y)<R;
    if(inside)assert.equal(after.walkable(cx,cy),false,`cell (${cx},${cy}) under the disc`);
    else if(Math.hypot(centre.x-m.x,centre.y-m.y)>R+RADIUS+1e-6)assert.equal(after.walkable(cx,cy),before.walkable(cx,cy),`cell (${cx},${cy}) away from it`);
    if(before.walkable(cx,cy)&&!after.walkable(cx,cy))lost++;
  }
  assert.ok(lost>0,'the mouth cells left the grid');
  // Bodies of several sizes pushed straight at the centre from around the disc never overlap it.
  let pushes=0;
  for(const radius of [RADIUS,.32,.48,.9])for(let k=0;k<16;k++){
    const a=k*Math.PI/8,body={x:m.x+Math.cos(a)*(R+radius+1.2),y:m.y+Math.sin(a)*(R+radius+1.2)};
    if(!enemy.clearDisc(body.x,body.y,radius))continue;
    // moveSafely (enemies) reads the enemy view itself, even when handed the terrain.
    for(let t=0;t<80;t++)moveSafely(body,-Math.cos(a)*.15,-Math.sin(a)*.15,field,radius);
    assert.ok(Math.hypot(body.x-m.x,body.y-m.y)>=R+radius-1e-6,`radius ${radius} angle ${k} entered the blocker`);
    assert.ok(enemy.clearDisc(body.x,body.y,radius));
    pushes++;
  }
  assert.ok(pushes>=8,`${pushes} pushes`);
  // A hero (moveDirection: the players' movement and the client prediction) walks deep into the blocker disc.
  let heroes=0;
  for(let k=0;k<16;k++){
    const a=k*Math.PI/8;let hero={x:m.x+Math.cos(a)*(R+RADIUS+1.2),y:m.y+Math.sin(a)*(R+RADIUS+1.2)};
    if(!enemy.clearDisc(hero.x,hero.y,RADIUS))continue;
    let closest=Infinity;
    for(let t=0;t<120;t++){
      const dx=m.x-hero.x,dy=m.y-hero.y,l=Math.hypot(dx,dy);
      if(l<.05)break;
      hero=moveDirection(hero,{x:dx/l,y:dy/l},1/30,field);closest=Math.min(closest,Math.hypot(hero.x-m.x,hero.y-m.y));
    }
    if(closest<R-RADIUS)heroes++;
  }
  assert.ok(heroes>=4,`${heroes} heroes got inside the blocker disc`);
});

test('forEnemies() is one cached live view; enemyTerrain is that view for a city and the identity elsewhere',()=>{
  const city=openCity(),view=city.forEnemies();
  assert.equal(city.forEnemies(),view);assert.equal(view.forEnemies(),view);assert.ok(view instanceof CityTerrain);
  assert.equal(view.asset,city.asset);assert.equal(view.signature,city.signature);assert.equal(view.world,'cidade');assert.equal(view.seed,0);
  assert.equal(enemyTerrain(city),view);assert.equal(enemyTerrain(view),view);assert.equal(enemyTerrain(undefined),undefined);
  // Live: blockers set on the terrain after the view was made are solid in it; removing them through the view frees it.
  assert.equal(view.clearDisc(C.x,C.y,0),true);
  city.setBlocker('x',{x:C.x,y:C.y,r:.5});
  assert.equal(view.clearDisc(C.x,C.y,0),false);assert.equal(view.blockerVersion,1);assert.equal(view.blockers(),city.blockers());
  view.setBlocker('x',undefined);
  assert.equal(city.blockerVersion,2);assert.deepEqual(city.blockers(),[]);assert.equal(view.clearDisc(C.x,C.y,0),true);
  // Same heights and coast as the terrain.
  assert.equal(view.height(1.3,2.1),city.height(1.3,2.1));assert.equal(view.coast(1.3,2.1),city.coast(1.3,2.1));
  // The island and the endless world: the very same object (their runs never change).
  for(const world of ['ilha','infinito'] as const){
    const t=new TerrainField(7,{world});
    assert.equal(enemyTerrain(t),t,world);
  }
});

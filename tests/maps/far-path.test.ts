/**
 * minimapa-wc3: a click on the minimap orders the hero across the map. farPath reaches what findPath's box cannot:
 * across the real city (one flow field) and across the endless world (hops), snapping a target on a roof to open ground.
 * Results only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,TerrainField,decodeCityAsset,findPath,farPath,snapWalkable,walkable,clearSegment,worldBase} from '../../src/maps/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const decoded=decodeCityAsset(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'));
if(!decoded.ok)throw new Error(decoded.error);
const city=new CityTerrain(decoded.asset,'t');
const walkOk=(start:{x:number;y:number},route:{x:number;y:number}[],t:CityTerrain|TerrainField)=>{let a=start;for(const b of route){if(!clearSegment(a,b,t))return false;a=b;}return true;};

test('across the city: from the crashed helicopter to the far north spawn, where findPath gives up', () => {
  const P=decoded.asset.points,start=P.inicio,target=P.spawnN;
  assert.deepEqual(findPath(start,target,city),[],'too far for the local box');
  const route=farPath(start,target,city);
  assert.ok(route.length>1,`${route.length} waypoints`);
  const end=route[route.length-1];
  assert.ok(Math.hypot(end.x-target.x,end.y-target.y)<1,'ends at the target');
  assert.ok(walkOk(start,route,city),'every leg a straight walk');
});

test('a click on a roof walks to the open ground beside it', () => {
  const b=decoded.asset.blocks.find(x=>x.kind==='building')!,r=b.rects[0],roof={x:r[0]+r[2]/2,y:r[1]+r[3]/2};
  const snapped=snapWalkable(roof,city);
  assert.ok(snapped&&walkable(snapped,city));
  assert.ok(Math.hypot(snapped!.x-roof.x,snapped!.y-roof.y)<=8);
});

test('across the endless world: hops of short paths to a point 90 u away', () => {
  const t=new TerrainField(4242,{world:'infinito'}),start=worldBase(t),start2={x:start.x,y:start.y+5};
  const goal=snapWalkable({x:start.x+70,y:start.y-55},t)!;
  const route=farPath(start2,goal,t);
  assert.ok(route.length>0);
  const end=route[route.length-1];
  assert.ok(Math.hypot(end.x-goal.x,end.y-goal.y)<1,'reaches it');
  assert.ok(walkOk(start2,route,t),'every leg a straight walk');
});

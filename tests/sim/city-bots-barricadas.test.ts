/**
 * cidade-10 after cidade-06 (barricades at the plaza mouths): the room bots still walk the city like heroes.
 *  1. A gem past the band where gems lure a city bot (LEASH - ROAM_IN from the wall) is no lure. city-room-bots seed 4242
 *     had bot-2 at (88.0,94.2), 5.5 u from the wall, pacing in place for 8.8 s: a gem 7 u from the wall pulled it out
 *     to the band's edge (out = -1), where the lure stopped and its circle pulled it back in, every think.
 *  2. The bot routes ignore the barricades: their blocker discs are solid for enemies only (maps city/terrain.ts), and
 *     the routes' grid (cityFlowGrid reads the enemy view) is built on a blocker-free terrain, the same for every fork.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {walkable} from '../../src/maps/world.ts';
import {LEASH,ROAM_IN,decide,newMemory} from '../../src/sim/bot-brain.ts';
import {botRoute,botRouteDistance,dropBotRoutes} from '../../src/sim/city/bot-routes.ts';
import {BARRICADE_MAX_R} from '../../src/sim/stonewards/barricades.ts';
import type {RunView} from '../../src/contract/view.ts';
import {CITY_MAP_SCALE} from '../../src/rules/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,P=city.asset.points;
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);

test('city bot: a gem past the lure band is no lure (no pacing at the band edge); one inside it still is',()=>{
  // The seed-4242 spots were (88.03,94.18) for the bot, gems at (88.5,95.9) and (85,95), on the .w3x-sized city. The
  // distances that matter are the bot's leash band around the wall (LEASH, ROAM_IN: bot lengths, not map ones), so on
  // the 1.7× map (NEW-20261013-ORQ-cidade-escala-1-7) the spots keep those distances from the wall (5.45, 7.05 and 4.6 u),
  // 15° south of east in the plaza's south street: the old offsets from the praca land inside a building there.
  const wall=P.praca,at={x:wall.x+5.264,y:wall.y+1.411},far={x:wall.x+6.81,y:wall.y+1.825},near={x:wall.x+4.443,y:wall.y+1.191};
  for(const p of [at,far,near])assert.ok(walkable(p,city),'every spot on walkable ground');
  assert.ok(dist(at,wall)>LEASH-ROAM_IN-.1&&dist(at,wall)<LEASH-ROAM_IN,'the bot stands just inside the band');
  assert.ok(dist(far,wall)>LEASH&&dist(near,wall)<LEASH-ROAM_IN,'one gem past the leash, one inside the band');
  const run=(pickups:{x:number;y:number}[])=>decide({
    view:{tick:2400,team:{xp:0,level:3,nextXp:50},round:{index:2,total:10,phase:'wave',phaseEndsTick:4000,remaining:30},
      enemies:[],pickups:pickups.map((p,i)=>({id:`g${i}`,kind:'xp',x:p.x,y:p.y})),projectiles:[],telegraphs:[],
      structures:[{id:'s1',kind:'muralha',x:wall.x,y:wall.y,hp:600,maxHp:600}],
      players:[{id:'bot-2',name:'bot-2',hp:100,maxHp:100,x:at.x,y:at.y,online:true}],offers:[],events:[],camp:{coco:0,pedra:0}} as unknown as RunView,
    selfId:'bot-2',at,index:1,terrain:city,memory:newMemory(1)});
  const none=run([]),pastBand=run([far]),inside=run([near]);
  assert.equal(none.mode,'fight');
  assert.deepEqual(pastBand.direction,none.direction,'the gem 7 u from the wall does not pull the bot out of the band');
  assert.notDeepEqual(inside.direction,none.direction,'a gem well inside the leash still lures the bot');
});

test('bot routes walk through the barricades (blockers stop enemies only), the same on every fork',()=>{
  const fork=city.fork();
  for(const m of ['N','S','L','O'] as const)fork.setBlocker(`barricada-${m}`,{x:P.bocas[m].x,y:P.bocas[m].y,r:BARRICADE_MAX_R});
  // 6 u south of mouth S on the .w3x-sized city (past BARRICADE_MAX_R), × CITY_MAP_SCALE (NEW-20261013-ORQ-cidade-escala-1-7).
  const from={x:P.bocas.S.x,y:P.bocas.S.y+6*CITY_MAP_SCALE};
  assert.ok(walkable(from,fork)&&walkable(P.bocas.S,fork),'heroes stand south of and on the S mouth (blockers ignored)');
  assert.equal(fork.forEnemies().clearDisc(P.bocas.S.x,P.bocas.S.y,.22),false,'the S mouth is closed to enemies');
  dropBotRoutes(city);
  // Asked on the fork with its four mouths sealed first: a grid read through the blockers would leave the plaza
  // unreachable from outside (Infinity) or route around.
  const blocked=botRouteDistance(fork,from,P.praca),out={x:0,y:0},goal=botRoute(fork,from,P.praca,out);
  dropBotRoutes(city);
  const open=botRouteDistance(city,from,P.praca);
  assert.ok(Number.isFinite(blocked),`the plaza is reachable through the sealed mouths (${blocked})`);
  assert.equal(blocked,open,'the same street distance with or without the barricades');
  assert.ok(goal>=0&&(out.x!==0||out.y!==0),'a street way is given from outside the S mouth');
});

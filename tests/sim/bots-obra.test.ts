/**
 * D-052 slice 5b, bots-obra (card NEW-20261016-ORQ-carro-e-fortificacao-livre; src/sim/towers/bot-spots.ts and the
 * room bots): in the free build the bots build around the car, wherever it stands now.
 *  - botSites on the real Cidade Nevada: the spots are free-build ground (walkable, CAR_BUILD_GAP off the body, off the
 *    nests, over nothing standing), between BOT_SPOT_GAP and BOT_SPOT_REACH of the car, BOT_SPOT_SPREAD apart, at most
 *    BOT_SPOTS; a defense of theirs is its own `d:<id>` site; the spot ids turn into the root's FreeOrder;
 *  - a city chaveiro run with three RoomBots: every root they build is a free build around the car (no fixed obra, no
 *    refusal for the place), and after the car is moved the next one goes up around its new spot; a bot on its own obra
 *    (holdsObra: the sim holds it still) stands in mode 'build' with the stick at rest, never steering into 'unstick'.
 * D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CAR_RADIUS,ticks} from '../../src/contract/index.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {rectDistance} from '../../src/maps/index.ts';
import {CAR_BUILD_GAP,ROOT_DEFENSE} from '../../src/rules/index.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {createStonewardsState} from '../../src/sim/stonewards/system.ts';
import {FREE_CELL,freeCity,onGround,pieceRect,rectsOverlap,defenseRectOf} from '../../src/sim/towers/free-build.ts';
import {BOT_SPOTS,BOT_SPOT_GAP,BOT_SPOT_REACH,BOT_SPOT_SPREAD,botSiteDefense,botSites,botSpotOrder,withBotSites} from '../../src/sim/towers/bot-spots.ts';
import {holdsObra} from '../../src/sim/towers/system.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots,BOT_THINK_EVERY} from '../../multiplayer/room-bots.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const terrain=loaded.terrain,CAR=placeWall(terrain);
const city=freeCity(terrain)!;

test('botSites: free ground around the car, spread out, at most BOT_SPOTS; same input, same spots',()=>{
  const state=createStonewardsState({terrain,barricades:false});
  const world={car:{x:CAR.x,y:CAR.y,radius:CAR_RADIUS},nests:[]};
  const sites=botSites(city,state,world);
  assert.ok(sites.length>=3&&sites.length<=BOT_SPOTS,`${sites.length} spots`);
  for(const s of sites){
    const o=botSpotOrder(s.id)!;
    assert.equal(o.piece,ROOT_DEFENSE);
    const rect=pieceRect(o,1,1),d=Math.hypot(s.x-CAR.x,s.y-CAR.y);
    assert.ok(onGround(city,o,1,1),`${s.id} on the grid's ground`);
    assert.ok(rectDistance(rect,CAR)>=CAR_RADIUS+CAR_BUILD_GAP,`${s.id} off the body`);
    assert.ok(d<=BOT_SPOT_REACH&&d-CAR_RADIUS>=BOT_SPOT_GAP,`${s.id} at ${d.toFixed(2)} u`);
    assert.ok(Math.abs(s.x-(o.c+.5)*FREE_CELL)<1e-9,'x is the cell centre');
    assert.ok(s.maxSize>=1&&s.maxSize<=3);
    for(const t of sites)if(t!==s)assert.ok(Math.hypot(t.x-s.x,t.y-s.y)>=BOT_SPOT_SPREAD-1e-9,`${s.id} and ${t.id} apart`);
  }
  assert.deepEqual(botSites(city,state,world),sites,'deterministic');
  // Larger room first: the first spot fits the 3×3 tiers.
  assert.equal(sites[0].maxSize,3);
  // A living nest near one side keeps its spots CAR_NEST_KEEP_OUT away.
  const nest={x:sites[0].x,y:sites[0].y};
  assert.ok(botSites(city,state,{...world,nests:[nest]}).every(s=>Math.hypot(s.x-nest.x,s.y-nest.y)>3),'the nest\'s side is left');
  assert.equal(botSpotOrder('obra-03'),undefined,'a fixed obra is not a spot');
});

test('botSites: a free-built defense is its own d: site (room to grow), and no new spot covers it',()=>{
  const state=createStonewardsState({terrain,barricades:false});
  const world={car:{x:CAR.x,y:CAR.y,radius:CAR_RADIUS},nests:[]};
  const first=botSites(city,state,world)[0],o=botSpotOrder(first.id)!;
  const rect=pieceRect(o,1,1);
  state.defenses={list:[{id:'def-1',kind:ROOT_DEFENSE,site:'',cell:{c:o.c,r:o.r},owner:'bot-1',x:rect.x+rect.w/2,y:rect.y+rect.h/2,
    hp:400,maxHp:400,r:FREE_CELL/2,startTick:0,readyTick:0,fireTick:0}],gustavoes:0} as unknown as typeof state.defenses;
  const sites=botSites(city,state,world);
  const own=sites.find(s=>botSiteDefense(s.id)==='def-1');
  assert.ok(own,'its own site');assert.equal(own!.maxSize,first.maxSize,'the same room to grow');
  for(const s of sites.filter(s=>s.id.startsWith('c:'))){
    const c=botSpotOrder(s.id)!;
    assert.ok(!rectsOverlap(pieceRect(c,1,1),defenseRectOf(state.defenses!.list[0])),`${s.id} off it`);
    assert.ok(Math.hypot(s.x-own!.x,s.y-own!.y)>=BOT_SPOT_SPREAD-1e-9);
  }
  // The tower view: the defense stands on its d: site; another (a person's, on a fixed obra) keeps its own.
  const v=withBotSites({sites:[],defenses:[{id:'def-1',site:''},{id:'def-9',site:'obra-02'}]},sites);
  assert.deepEqual(v.defenses.map(d=>d.site),['d:def-1','obra-02']);
  assert.equal(v.sites,sites);
});

test('room: three bots on a chaveiro run build their roots around the car, and around its new spot once it is moved',()=>{
  // Seed 9 (4 until the vehicles: their rides end its wave 2 earlier, the bots go to the bank first and the run is won
  // before a second ficha).
  const sim=new Simulation(9,{world:'cidade',terrain,objective:'chaveiro'}),bots=new RoomBots();
  const ids=['bot-1','bot-2','bot-3'];
  ids.forEach((id,i)=>{sim.addBot(id,id,['cidadao-comum','clt-cansado','feirante'][i]);bots.add(id,i);});
  sim.resetRun();
  const built:{order:string;ok:boolean;reason?:string;car:{x:number;y:number};at?:{x:number;y:number}}[]=[];
  const build=sim.build.bind(sim);
  sim.build=(id,order,req)=>{
    const car=sim.objectiveView()!.car,r=build(id,order,req);
    const d=r.ok?sim.run.stonewards.state.defenses?.list.find(x=>x.id===r.defense):undefined;
    built.push({order:typeof order==='string'?order:`${order.piece}@${order.c},${order.r}`,ok:r.ok,...(r.ok?{}:{reason:r.reason}),car:{x:car.x,y:car.y},...(d?{at:{x:d.x,y:d.y}}:{})});
    return r;
  };
  let held=0;
  const run=(until:()=>boolean)=>{while(!sim.outcome&&!until()&&sim.tick<ticks(25*60)){
    bots.think(sim);
    for(const id of ids)if(holdsObra(sim.run.stonewards.state,id,sim.tick)&&(sim.tick+ids.indexOf(id))%BOT_THINK_EVERY===0){
      held++;assert.equal(bots.modes.get(id),'build',`${id} on its obra at tick ${sim.tick}`);
    }
    sim.step();
  }};
  run(()=>built.some(b=>b.ok)&&sim.world.round.phase==='wave');
  const roots=built.filter(b=>b.ok);
  assert.ok(roots.length>=1,`the bots built: ${JSON.stringify(built)}`);
  assert.ok(held>0,'a bot stood on its obra');
  for(const b of built){
    assert.ok(b.order.startsWith(`${ROOT_DEFENSE}@`),`a free build, not a fixed obra: ${b.order}`);
    assert.ok(b.ok||!['fora','carro','ninho','away'].includes(b.reason!),`never refused for the place: ${JSON.stringify(b)}`);
  }
  for(const b of roots)assert.ok(Math.hypot(b.at!.x-b.car.x,b.at!.y-b.car.y)<=BOT_SPOT_REACH+1,`around the car: ${JSON.stringify(b)}`);
  // Move the car down the street (as a push would) and play on to the next root.
  const car=sim.run.chaveiro!.state.car,from={x:car.x,y:car.y};
  for(const dx of [12,-12,8,-8]){if(city.clearDisc(from.x+dx,from.y,CAR_RADIUS)){car.x=from.x+dx;break;}}
  assert.notEqual(car.x,from.x,'moved');
  const before=roots.length;
  run(()=>built.filter(b=>b.ok).length>before&&built.at(-1)!.ok);
  const next=built.filter(b=>b.ok).slice(before);
  assert.ok(next.length>=1,`another root after the move: ${JSON.stringify(built.slice(-4))}`);
  for(const b of next){
    assert.ok(Math.hypot(b.at!.x-car.x,b.at!.y-car.y)<=BOT_SPOT_REACH+1,`around the new spot: ${JSON.stringify(b)}`);
    assert.ok(Math.hypot(b.at!.x-from.x,b.at!.y-from.y)>Math.hypot(b.at!.x-car.x,b.at!.y-car.y),'nearer the new spot than the old');
  }
});

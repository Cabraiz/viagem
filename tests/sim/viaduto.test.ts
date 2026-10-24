/**
 * NEW-20261023-ORQ-mapa-175-com-viaduto, etapa 3 (plans/mapa-175-viaduto.md §4): the main viaduct on the REAL asset.
 * Two floors (maps city/viaduct.ts): the ground (the asset's walkable bitset, the pillars and the ramp's embankment
 * solid) and the deck (the deck and its ramp). The floor only changes on the ramp; contact, hits, projectiles and
 * telegraphs only land on the same floor; a body hunting a hero on the other floor walks to the ramp. Result asserts
 * only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom,type CityTerrain} from '../../src/maps/city/terrain.ts';
import {RAMP_SWITCH_CELLS,floorAfter,floorOf,floorPortal,groundSolidCells,onFloor,rampFoot,surfaceHeight,viaductProblem,type CityViaduct} from '../../src/maps/city/viaduct.ts';
import {RADIUS,walkable,type Point} from '../../src/maps/world.ts';
import {decodeCityAsset,encodeCityAsset,cityAssetToData} from '../../src/maps/city-asset.ts';
import {BASE_STATS,ticks,type SimPlayer} from '../../src/contract/types.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {movePlayer} from '../../src/sim/systems/players.ts';
import {createEnemyAi} from '../../src/sim/enemies/ai.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {cityPlanner,citySteer} from '../../src/sim/city/grid.ts';
import {createProjectileSystem,spawnProjectile} from '../../src/sim/projectiles.ts';
import {addTelegraph,telegraphSystem} from '../../src/sim/telegraphs.ts';
import {cityRunStart} from '../../src/sim/city/tutorial.ts';
import {reconcile} from '../../src/maps/prediction.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const shared=loaded.terrain,A=shared.asset,U=A.unitsPerCell;
const V=A.viaducts[0];
const [DC,DR,DW,DH]=V.deck,[RC,RR,RW,RH]=V.ramp.rect;
/** The deck's middle line (x) and a row's centre (y). */
const MID=(DC+DW/2)*U,row=(r:number)=>(r+.5)*U;

function player(id:string,p:Point,extra:Partial<SimPlayer>={}):SimPlayer{
  return {id,x:p.x,y:p.y,classId:'test',hp:100,online:true,spectator:false,facing:{x:0,y:1},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
}
let seq=0;
const step=(p:SimPlayer,t:CityTerrain,dx:number,dy:number,tick=0)=>movePlayer(p,{seq:++seq,x:dx,y:dy,attack:false},t,tick);

test('the asset has the main viaduct: North–South, ramp down the N avenue, the avenue open beside it, pillars and embankment solid',()=>{
  assert.equal(A.viaducts.length,1);
  assert.equal(viaductProblem(V,A.cells.w,A.cells.h),undefined);
  assert.equal(V.ramp.up,'N');
  const foot=rampFoot(V,U),mouth=A.points.bocas.N;
  assert.ok(Math.abs(foot.x-mouth.x)<2*U&&mouth.y-foot.y>0&&mouth.y-foot.y<20*U,'the ramp lands on the N avenue, north of its mouth');
  // The avenue stays open beside the ramp (two cells west of it), so spawn N still walks straight to its mouth.
  for(let r=RR;r<RR+RH;r++)for(const c of [RC-2,RC-1])assert.equal(shared.clearDisc((c+.5)*U,row(r),RADIUS),true,`avenue cell (${c},${r}) beside the ramp`);
  const deck=shared.onDeck();
  for(const [c,r] of groundSolidCells(V)){
    assert.equal(shared.clearDisc((c+.5)*U,(r+.5)*U,0),false,`ground cell (${c},${r}) solid`);
    assert.equal(deck.clearDisc((c+.5)*U,(r+.5)*U,RADIUS),true,`deck cell (${c},${r}) open`);
  }
  // Off the deck and the ramp, the deck floor has nowhere to stand.
  assert.equal(deck.clearDisc((DC-1.5)*U,row(DR+5),0),false);
  assert.equal(deck.clearDisc((DC+DW+.5)*U,row(DR+5),0),false);
  // The east–west street along the north edge (rows 10–13) runs under the deck, between its pillars.
  for(const r of [10,11,12,13])for(let c=DC;c<DC+DW;c++)assert.equal(shared.clearDisc((c+.5)*U,row(r),RADIUS),true,`street cell (${c},${r}) under the deck`);
  // The asset round-trips with its viaduct block.
  const again=decodeCityAsset(encodeCityAsset(cityAssetToData(A)));
  assert.ok(again.ok&&JSON.stringify(again.asset.viaducts)===JSON.stringify(A.viaducts));
});

test('the floor switches on the ramp only, past RAMP_SWITCH_CELLS from its foot; the surface rises along it',()=>{
  const foot=rampFoot(V,U),vs=A.viaducts;
  assert.equal(floorAfter(vs,U,MID,foot.y-.5*U,0),0,'on the walkable foot: still the ground');
  assert.equal(floorAfter(vs,U,MID,foot.y-(RAMP_SWITCH_CELLS+.1)*U,0),1,'past the switch line: the deck');
  assert.equal(floorAfter(vs,U,MID,row(DR+5),1),1,'over the deck: kept');
  assert.equal(floorAfter(vs,U,MID,row(DR+5),0),0,'under the deck: kept');
  assert.equal(floorAfter(vs,U,(DC-3)*U,row(DR+5),1),0,'off the viaduct: the ground');
  assert.equal(surfaceHeight(vs,U,MID,row(DR+5),1),V.height);
  assert.equal(surfaceHeight(vs,U,MID,row(DR+5),0),0);
  const mid=surfaceHeight(vs,U,MID,(RR+RH/2)*U,1);
  assert.ok(Math.abs(mid-V.height/2)<1e-9,`halfway up the ramp: half the height (${mid})`);
});

test('the run starts on the deck (andar 1) at the Uno, all six spawn slots on the deck floor',()=>{
  const start=cityRunStart(shared);
  assert.equal(start.andar,1);
  assert.deepEqual({x:start.x,y:start.y},{x:A.points.inicio.x,y:A.points.inicio.y});
  const deck=shared.onDeck();
  for(let s=0;s<6;s++)assert.ok(walkable({x:start.x+(s%3-1)*.7,y:start.y+Math.floor(s/3)*.7},deck),`slot ${s}`);
});

test('a hero walks down the ramp to the ground (floor 0 past the switch line), then back up to the deck',()=>{
  const t=shared.fork(),start=cityRunStart(t);
  const p=player('p',start,{andar:1});
  const switchY=rampFoot(V,U).y-RAMP_SWITCH_CELLS*U;
  let flips=0,last=floorOf(p);
  for(let i=0;i<2000&&p.y<row(RR+RH);i++){
    step(p,t,0,1);
    if(floorOf(p)!==last){flips++;last=floorOf(p);assert.ok(Math.abs(p.y-switchY)<.3,`switched at the line (${p.y} vs ${switchY})`);}
    assert.equal(floorOf(p),p.y<switchY?1:0,`floor at y=${p.y}`);
  }
  assert.ok(p.y>=row(RR+RH),'reached the foot');
  assert.equal(flips,1);assert.equal(p.andar,undefined);
  for(let i=0;i<2000&&p.y>row(DR+DH-3);i++)step(p,t,0,-1);
  assert.ok(p.y<=row(DR+DH-3),'walked back up the ramp onto the deck');
  assert.equal(p.andar,1);
  // The deck's edge holds: walking east stops at it, never down onto the street.
  for(let i=0;i<200;i++)step(p,t,1,0);
  assert.ok(p.x<=(DC+DW)*U-RADIUS+1e-6&&p.andar===1,'stopped at the deck edge, still on it');
});

test('the phone predicts the same floor as the room: reconcile carries andar down the ramp',()=>{
  const t=shared.fork(),start=cityRunStart(t);
  const p=player('p',start,{andar:1});
  const inputs=Array.from({length:600},(_,k)=>({seq:k+1,x:0,y:1,attack:false}));
  for(const i of inputs)movePlayer(p,i,t,0);
  const predicted=reconcile({x:start.x,y:start.y,andar:1},inputs,t,{tick:0});
  assert.deepEqual(predicted,{x:p.x,y:p.y,...(p.andar===1?{andar:1}:{})});
});

test('a ground hero under the deck is blocked by the pillars and the ramp embankment, never by the deck itself',()=>{
  const t=shared.fork(),[pc,pr]=V.pillars[V.pillars.length-1];
  const p=player('p',{x:(pc+.5)*U,y:row(pr+2)});
  assert.ok(walkable(p,t),'starts on the street under the deck');
  for(let i=0;i<400;i++)step(p,t,0,-1);
  assert.ok(Math.abs(p.y-((pr+1)*U+RADIUS))<.05,`stopped against the pillar of row ${pr}: y=${p.y}`);
  assert.equal(p.andar,undefined);
  const q=player('q',{x:MID,y:row(DR+DH-1)});
  for(let i=0;i<400;i++)step(q,t,0,1);
  assert.ok(q.y<RR*U,'the ramp embankment stops it from the deck side');
  assert.equal(q.andar,undefined);
});

/** A world with the city AI and the projectiles and telegraphs, round 3 in its wave. */
function aiWorld(){
  const terrain=shared.fork(),planner=cityPlanner(terrain);
  const world=new SimWorld({terrain,seed:7});
  world.round.index=3;world.round.phase='wave';world.round.phaseEndsTick=1e9;
  world.register(createEnemyAi({steer:citySteer(planner,{terrain}),heroSpeed:2})).register(createProjectileSystem()).register(telegraphSystem);
  return {terrain,world};
}

test('a hero on the deck right over a body on the street is never touched by it',()=>{
  const {world}=aiWorld();
  const at={x:MID,y:row(DR+2)};
  const hero=player('h',at,{andar:1});
  world.players.set('h',hero);
  const e=createEnemy(world,'bebado',{x:at.x+.1,y:at.y});
  assert.equal(floorOf(e),0);
  for(let t=0;t<ticks(2);t++)world.step();
  assert.equal(hero.hp,100,'no contact across floors');
  assert.equal(floorOf(e),0);
});

test('a body on the street crosses under the deck between the pillars',()=>{
  const {world}=aiWorld();
  // The street along the north edge (rows 10–13) runs under the deck.
  const y=row(11),hero=player('h',{x:(DC+DW+4)*U,y});
  world.players.set('h',hero);
  const e=createEnemy(world,'bebado',{x:(DC-5)*U,y});
  let under=false;
  for(let t=0;t<ticks(20)&&hero.hp===100;t++){world.step();if(e.x>DC*U&&e.x<(DC+DW)*U){under=true;assert.equal(floorOf(e),0);}}
  assert.ok(under,'it walked under the deck');
  assert.ok(hero.hp<100,'and reached the hero on the other side');
});

test('a body hunting a hero on the deck walks to the ramp, climbs it and hits the hero up there',()=>{
  const {world}=aiWorld();
  const hero=player('h',{x:MID,y:row(DR+DH-6)},{andar:1});
  world.players.set('h',hero);
  const foot=rampFoot(V,U);
  const e=createEnemy(world,'bebado',{x:foot.x-U,y:foot.y+2*U});
  let climbed=false;
  for(let t=0;t<ticks(60)&&hero.hp===100;t++){world.step();if(floorOf(e)===1)climbed=true;}
  assert.ok(climbed,'it went up the ramp');
  assert.ok(hero.hp<100,`it hit the hero on the deck (enemy at ${e.x.toFixed(1)},${e.y.toFixed(1)} floor ${floorOf(e)})`);
  // And back down: the hero goes to the street, the body follows it down the ramp.
  hero.hp=100;delete hero.andar;hero.x=foot.x;hero.y=foot.y+3*U;
  for(let t=0;t<ticks(60)&&floorOf(e)===1;t++)world.step();
  assert.equal(floorOf(e),0,'it came down the ramp after the hero');
});

test('a ground shot never hits a hero on the deck; a deck hero\'s hit never lands on the street',()=>{
  const {world}=aiWorld();
  const at={x:MID,y:row(DR+2)};
  const hero=player('h',at,{andar:1});
  world.players.set('h',hero);
  const shooter=createEnemy(world,'bebado',{x:at.x-3,y:at.y});
  world.projectiles.set('ps',{id:'ps',owner:shooter.id,source:'tiro',x:at.x-1,y:at.y,vx:6,vy:0,radius:.3,damage:10,pierce:0,untilTick:world.tick+40,hostile:true,hit:[]});
  // A telegraph of the street body under the hero.
  addTelegraph(world as never,{shape:'circle',x:at.x,y:at.y,radius:2,damage:10,owner:shooter.id},1);
  shooter.x=at.x-6; // out of contact reach
  for(let t=0;t<ticks(1.5);t++)world.step();
  assert.equal(hero.hp,100,'the shot and the stomp were on the street');
  // The hero's own shot from the deck flies over a body on the street.
  const below=createEnemy(world,'bebado',{x:at.x+2,y:at.y});const hp=below.hp;
  const shot=spawnProjectile(world as never,{owner:'h',source:'chinelo',x:at.x,y:at.y,vx:6,vy:0,radius:.3,damage:10,pierce:0,untilTick:world.tick+20,hostile:false});
  assert.equal(shot?.andar,1,'a deck hero\'s shot flies on the deck');
  for(let t=0;t<10;t++)world.step();
  assert.equal(below.hp,hp,'it flew over the body on the street');
  assert.equal(world.damageEnemy(below.id,5,'h'),false,'no damage across floors through the core either');
  assert.equal(below.hp,hp);
});

test('onFloor: the deck view only for floor 1, and the enemy view keeps its blockers on the deck',()=>{
  const t=shared.fork();
  assert.equal(onFloor(t,0),t);assert.equal(onFloor(t,undefined),t);
  const deck=onFloor(t,1);
  assert.notEqual(deck,t);assert.equal(deck.onDeck(),deck);
  const at={x:MID,y:row(DR+5)};
  t.setBlocker('teste',{x:at.x,y:at.y,r:.5});
  assert.equal(walkable(at,deck),true,'heroes walk through blockers on the deck too');
  assert.equal(walkable(at,onFloor(t.forEnemies(),1)),false,'enemies do not');
  assert.equal(deck.forEnemies(),onFloor(t.forEnemies(),1));
  t.setBlocker('teste',undefined);
  assert.equal(shared.blockers().length,0);
  const portal=floorPortal(V,U,1);
  assert.equal(floorAfter(A.viaducts,U,portal.x,portal.y,0),1,'the way-up portal is past the switch line');
  const down=floorPortal(V,U,0);
  assert.equal(floorAfter(A.viaducts,U,down.x,down.y,1),0,'the way-down portal is on the ground');
  assert.equal(walkable(down,t),true);
});

test('viaductProblem refuses a ramp away from the deck, a short ramp, a pillar off the deck',()=>{
  const ok:CityViaduct={id:'v',deck:[2,2,4,10],ramp:{rect:[2,12,4,6],up:'N'},pillars:[[2,4]],height:3};
  assert.equal(viaductProblem(ok,40,40),undefined);
  assert.match(viaductProblem({...ok,ramp:{rect:[2,13,4,6],up:'N'}},40,40)!,/end of the deck/);
  assert.match(viaductProblem({...ok,ramp:{rect:[2,12,4,2],up:'N'}},40,40)!,/at least/);
  assert.match(viaductProblem({...ok,pillars:[[9,4]]},40,40)!,/under the deck/);
  assert.match(viaductProblem({...ok,deck:[38,2,4,10]},40,40)!,/inside the grid/);
});


test('a body crossing the switch line half off the ramp\'s side keeps its floor until it fits the deck (never stuck)',()=>{
  const t=shared.fork(),foot=rampFoot(V,U);
  // On the ground beside the ramp's foot, its disc over the ramp's west edge, walking north past the switch line.
  const p=player('p',{x:RC*U+.1,y:foot.y-.3});
  assert.ok(walkable(p,t)&&p.andar===undefined);
  for(let i=0;i<60;i++)step(p,t,0,-1);
  assert.equal(p.andar,undefined,'still on the ground: half of it is off the ramp');
  assert.ok(walkable(p,onFloor(t,floorOf(p))),'and it stands clear on its floor');
  // A step east, fully onto the ramp: now it is on the deck's floor, and can walk up.
  for(let i=0;i<20;i++)step(p,t,1,0);
  for(let i=0;i<10;i++)step(p,t,0,-1);
  assert.equal(p.andar,1,'on the ramp, past the line: the deck');
  const y=p.y;for(let i=0;i<40;i++)step(p,t,0,-1);
  assert.ok(p.y<y-1,'walks up the ramp');
});

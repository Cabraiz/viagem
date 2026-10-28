/**
 * NEW-20261025-ORQ-uno-caminho-caixas-vender, item 1 (the user, 25/10, print: a junk pile with a shopping cart and a
 * wooden fence in the middle of the street: "esses entulhos e essa barreira só atrapalham na parte de mover o Uno"):
 * both are squares of the map's tralha (sim/towers/tralha.ts, drawn as the junk wall), laid on the line car → spawn,
 * down the avenues. On the REAL Cidade Nevada, with the tralha of real matches (Simulation, chaveiro, ninhos):
 *  1. every square leans on a wall and leaves the car room to drive past (carStillPasses);
 *  2. the Uno pushed by the ChaveiroSystem itself (its collision with the mask and the squares) from where it starts
 *     reaches the plaza, the 4 mouths and every spawn its body reaches on the bare map, as it does with no tralha.
 * D-031: results only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CityTerrain,cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {FlowField,UNREACHABLE,cityAsField,type FlowGrid,type Point} from '../../src/maps/index.ts';
import {BASE_STATS,CAR_RADIUS,type EnemyState,type SimPlayer} from '../../src/contract/index.ts';
import {pieceCells} from '../../src/rules/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {cityFlowGrid} from '../../src/sim/city/grid.ts';
import {placeWall} from '../../src/sim/stonewards/wall.ts';
import {createChaveiro} from '../../src/sim/chaveiro/system.ts';
import {seatedPlayers} from '../../src/sim/wallet.ts';
import {blockDiscs,pieceRectOf,type PieceState} from '../../src/sim/towers/free-build.ts';
import {TRALHA_OWNER,againstWall,carStillPasses} from '../../src/sim/towers/tralha.ts';
import {Simulation} from '../../multiplayer/simulation.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,PTS=city.asset.points,CAR=placeWall(city);
const OPEN=cityFlowGrid(new CityTerrain(city.asset,city.signature));
const ENTRANCES={N:PTS.spawnN,S:PTS.spawnS,L:PTS.spawnL,O:PTS.spawnO};
type Disc={x:number;y:number;r:number};

/** The map's tralha of a real match (laid on its first step). */
function tralhaOf(seed:number):PieceState[]{
  const s=new Simulation(seed,{world:'cidade',terrain:cityAsField(city),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  s.add('p0','P0','cidadao-comum');s.resetRun();s.step(1000);
  return ((s.run.stonewards.state as unknown as {defenses?:{pieces?:PieceState[]}}).defenses?.pieces??[]).filter(p=>p.owner===TRALHA_OWNER);
}
/** A piece's blocker discs (barricada-tocar-no-mapa: 3 along its long side). */
const discsOf=(p:PieceState):Disc[]=>{const [w,h]=pieceCells(p.kind,p.rot??0);return blockDiscs(p.kind,p.cell,w,h);};

/** A flow grid of the car's centre: a cell is open when the body (+ a little room) fits there, off every disc. */
const CELL=.75,ROOM=.25;
function carGrid(discs:readonly Disc[]):FlowGrid{
  const w=Math.ceil(city.asset.size.w/CELL),h=Math.ceil(city.asset.size.h/CELL),open=new Uint8Array(w*h),R=CAR_RADIUS+ROOM;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const cx=(x+.5)*CELL,cy=(y+.5)*CELL;
    open[x+y*w]=city.clearDisc(cx,cy,R)&&discs.every(d=>(cx-d.x)**2+(cy-d.y)**2>=(d.r+R)**2)?1:0;
  }
  return {width:w,height:h,cellSize:CELL,walkable:(x,y)=>x>=0&&y>=0&&x<w&&y<h&&open[x+y*w]===1};
}
/** The goals: the plaza, the mouths, the spawns; each moved to the nearest cell the car fits on (within 6 u). */
function goals(grid:FlowGrid):[string,Point][]{
  const raw:[string,Point][]=[['praça',PTS.praca],...Object.entries(PTS.bocas).map(([k,v])=>[`boca ${k}`,v] as [string,Point]),
    ...Object.entries(ENTRANCES).map(([k,v])=>[`spawn ${k}`,v] as [string,Point])];
  const out:[string,Point][]=[];
  for(const [name,p] of raw){
    let best:Point|undefined,bd=Infinity;
    for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++){
      const x=Math.floor(p.x/CELL)+dx,y=Math.floor(p.y/CELL)+dy,d=dx*dx+dy*dy;
      if(grid.walkable(x,y)&&d<bd){bd=d;best={x:(x+.5)*CELL,y:(y+.5)*CELL};}
    }
    if(best)out.push([name,best]);
  }
  return out;
}

/** Two heroes push the car (the ChaveiroSystem, blocked by `discs`) down `field` to `goal`; true when it gets within 2.5 u. */
function drive(discs:readonly Disc[],field:FlowField,goal:Point,maxTicks:number):{ok:boolean;at:Point}{
  const players=new Map<string,SimPlayer>(),sticks=new Map<string,Point>();
  const world=new SimWorld({terrain:city,seed:7,players,order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
  const blocks=discs.map(d=>({x:d.x,y:d.y,radius:d.r}));
  const sys=createChaveiro({wallet:{seated:()=>seatedPlayers(players)},seed:7,grid:OPEN,entrances:ENTRANCES,car:CAR,onOutcome:()=>{},
    input:id=>sticks.get(id),blocks:()=>blocks});
  for(const id of ['a','b'])players.set(id,{id,classId:'x',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
    stats:{...BASE_STATS,maxHp:100},weaponReady:{},x:CAR.x,y:CAR.y,ack:0,score:0} as unknown as SimPlayer);
  const dir={x:0,y:0},c=sys.state.car;
  for(let t=0;t<maxTicks;t++){
    if(Math.hypot(c.x-goal.x,c.y-goal.y)<2.5)return {ok:true,at:{x:c.x,y:c.y}};
    field.directionAt(c.x,c.y,dir);
    if(!dir.x&&!dir.y){dir.x=goal.x-c.x;dir.y=goal.y-c.y;const l=Math.hypot(dir.x,dir.y);dir.x/=l;dir.y/=l;}
    // The heroes lean on the body behind the push (as sim-carro's pushers), their sticks along the field.
    [...players.values()].forEach((p,i)=>{const side=(i-.5)*.15;p.x=c.x-dir.x*(CAR_RADIUS+.3)-dir.y*side;p.y=c.y-dir.y*(CAR_RADIUS+.3)+dir.x*side;sticks.set(p.id,{x:dir.x,y:dir.y});});
    world.step();world.enemyIndex.rebuild(world.enemies.values());sys.step(world);world.flush();
  }
  return {ok:Math.hypot(c.x-goal.x,c.y-goal.y)<2.5,at:{x:c.x,y:c.y}};
}

const SEEDS=[1,2,3,4];
const laid=new Map(SEEDS.map(s=>[s,tralhaOf(s)]));

test('the map\'s tralha leans on the walls and leaves the Uno room to drive past, every square of every match',()=>{
  for(const [seed,pieces] of laid){
    assert.ok(pieces.length>=8,`seed ${seed}: ${pieces.length} squares`);
    pieces.forEach((p,i)=>{
      assert.ok(againstWall(city,pieceRectOf(p)),`seed ${seed}: ${p.id} in the middle of the street`);
      const others=pieces.filter((_,j)=>j!==i).flatMap(discsOf);
      assert.ok(carStillPasses(city,others,discsOf(p)),`seed ${seed}: ${p.id} shuts the street to the Uno`);
    });
  }
});

test('the Uno, pushed from where it starts, reaches the plaza, the mouths and the spawns as on the bare map',()=>{
  const bare=carGrid([]),targets=goals(bare);
  const from=(g:FlowGrid,p:Point)=>new FlowField(g,[p]);
  const reachableBare=targets.filter(([,p])=>from(bare,p).cellCost(Math.floor(CAR.x/CELL),Math.floor(CAR.y/CELL))!==UNREACHABLE);
  assert.ok(reachableBare.length>=7,`the bare map: ${reachableBare.map(([n])=>n).join(', ')}`);
  for(const seed of SEEDS.slice(0,2)){
    const discs=laid.get(seed)!.flatMap(discsOf),grid=carGrid(discs);
    for(const [name,goal] of reachableBare){
      const field=from(grid,goal);
      assert.notEqual(field.cellCost(Math.floor(CAR.x/CELL),Math.floor(CAR.y/CELL)),UNREACHABLE,`seed ${seed}: the tralha cuts the Uno off ${name}`);
      const run=drive(discs,field,goal,20*400);
      assert.ok(run.ok,`seed ${seed}: the Uno pushed toward ${name} stuck at (${run.at.x.toFixed(1)},${run.at.y.toFixed(1)})`);
    }
  }
});

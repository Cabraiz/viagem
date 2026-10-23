/**
 * NEW-20261021-ORQ-barricada-construir, part 1 (the rules, no gesture yet), on a small map:
 *  1. reachMap: with a gap in a line of shut cells the body still reaches the car; the gap closed (grid version moves),
 *     it is cut off.
 *  2. The enemy-ai's `bashes` gate wired to it: a body pressed against a built barricade never bashes it while there is
 *     a gap; with the gap closed it does.
 *  3. The car near a barricada: the alert (alertUntil = 6 s), called off when the car leaves, the square destroyed when
 *     the car is still near at the end (its blocker gone, a 'structure' event at hp 0).
 * D-031: results only (state, events), no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,ticks,type EnemyState,type SimEvent,type SimPlayer} from '../../src/contract/index.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';
import {walkable} from '../../src/maps/world.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {SpatialHash} from '../../src/sim/spatial.ts';
import {RUN_ORDER} from '../../src/sim/systems/players.ts';
import {createEnemyAi} from '../../src/sim/enemies/ai.ts';
import {FREE_CELL,reachMap,unoAlertStep,type PieceState} from '../../src/sim/towers/free-build.ts';
import {UNO_ALERT_CELLS,UNO_ALERT_SECONDS} from '../../src/rules/index.ts';
import type {SimContext} from '../../src/sim/context.ts';
import type {StonewardsState} from '../../src/sim/stonewards/state.ts';

/** A 12×12 grid of 1 u cells, a wall down column 6 with a gap at row 6 (open while `gap`). */
function smallGrid(){
  let gap=true,version=0;
  const grid={width:12,height:12,cellSize:1,get version(){return version;},
    walkable:(cx:number,cy:number)=>cx!==6||(gap&&cy===6)};
  return {grid,close(){gap=false;version++;},open(){gap=true;version++;}};
}

test('reachMap: with a gap the far side reaches the car; the gap closed, it is cut off; reopened, it reaches again', ()=>{
  const g=smallGrid(),reach=reachMap(g.grid),car={x:2.5,y:6.5},far={x:9.5,y:2.5},near={x:3.5,y:9.5};
  assert.equal(reach(far,car),true);
  assert.equal(reach(near,car),true);
  g.close();
  assert.equal(reach(far,car),false,'cut off');
  assert.equal(reach(near,car),true,'the car\'s own side');
  // A body pressed on the wall (its centre in a shut cell) counts from the open cell next to it.
  assert.equal(reach({x:6.4,y:3.5},car),true);
  g.open();
  assert.equal(reach(far,car),true);
});

test('bashes gate: a body pressed against a built barricade never bashes it while there is a way; closed off, it does', ()=>{
  // Open ground on the default terrain for the body, the barricade and a hero 6 u away.
  let p:{x:number;y:number}|undefined;
  for(let r=0;!p&&r<60;r+=2)for(let a=0;a<16&&!p;a++){
    const q={x:Math.cos(a/16*2*Math.PI)*r,y:Math.sin(a/16*2*Math.PI)*r};
    if([0,.9,6].every(dx=>walkable({x:q.x+dx,y:q.y},defaultTerrain)))p=q;
  }
  assert.ok(p,'ground');
  const g=smallGrid(),reach=reachMap(g.grid),car={x:2.5,y:6.5};
  const run=(closed:boolean)=>{
    if(closed)g.close();else g.open();
    const world=new SimWorld({terrain:defaultTerrain,seed:1,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash<EnemyState>()});
    const hero={id:'h',classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
      stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p!.x+6,y:p!.y,ack:0,score:0} as SimPlayer;
    world.players.set('h',hero);
    // The body stands where the grid's far side is (9.5, 2.5 in grid terms); the structure touches it.
    const e:EnemyState={id:'e',kind:'bebado',x:p!.x,y:p!.y,hp:10,maxHp:10,speed:1,damage:5,radius:.4,xp:1,spawnTick:0,readyTick:0};
    world.enemies.set('e',e);
    const hits:string[]=[];
    const ai=createEnemyAi({heroSpeed:10,structures:()=>[{id:'barricada-1',x:e.x+.9,y:e.y,radius:.5,blocking:true}],
      bashes:(_e,id)=>id!=='barricada-1'||!reach({x:9.5,y:2.5},car),hitStructure:(_ctx,id)=>{hits.push(id);}});
    for(let k=0;k<ticks(3);k++){world.step();world.enemyIndex.rebuild(world.enemies.values());ai.step(world);world.flush();e.x=p!.x;e.y=p!.y;}
    return hits.length;
  };
  assert.equal(run(false),0,'a gap: nobody bashes');
  assert.ok(run(true)>0,'closed: they bash');
});

function alertRig(){
  // barricada-2x: the square covers cells 10..11 × 10..11, centred at 11.
  const piece:PieceState={id:'pc-1',kind:'barricada',cell:{c:10,r:10},owner:'ana',x:11*FREE_CELL,y:11*FREE_CELL,hp:200,maxHp:200,startTick:0,readyTick:0};
  const state={defenses:{list:[],pieces:[piece]}} as unknown as StonewardsState;
  const events:SimEvent[]=[];
  const ctx={tick:0,emit:(e:SimEvent)=>{events.push(e);}} as unknown as SimContext&{tick:number};
  return {piece,state,events,ctx};
}

test('car near a barricada: alert for 6 s, called off when the car leaves, destroyed when it stays', ()=>{
  const {piece,state,events,ctx}=alertRig(),radius=1;
  const edge=(12)*FREE_CELL;// the 2×2 square's right edge
  const near={x:edge+radius+(UNO_ALERT_CELLS-.5)*FREE_CELL,y:piece.y,radius},far={x:edge+radius+(UNO_ALERT_CELLS+.5)*FREE_CELL,y:piece.y,radius};
  assert.deepEqual(unoAlertStep(ctx,undefined,state,far),[]);
  assert.equal(piece.alertUntil,undefined,'out of range: no alert');
  unoAlertStep(ctx,undefined,state,near);
  assert.equal(piece.alertUntil,ticks(UNO_ALERT_SECONDS));
  ctx.tick=ticks(UNO_ALERT_SECONDS)-1;
  assert.deepEqual(unoAlertStep(ctx,undefined,state,near),[],'not yet');
  // The team pushes the car away: called off; back near, a fresh 6 s.
  unoAlertStep(ctx,undefined,state,far);
  assert.equal(piece.alertUntil,undefined);
  unoAlertStep(ctx,undefined,state,near);
  assert.equal(piece.alertUntil,ctx.tick+ticks(UNO_ALERT_SECONDS));
  ctx.tick=piece.alertUntil!;
  assert.deepEqual(unoAlertStep(ctx,undefined,state,near),['pc-1']);
  assert.equal(state.defenses!.pieces!.length,0);
  assert.deepEqual(events.filter(e=>e.type==='structure'),[{type:'structure',id:'pc-1',hp:0,maxHp:200}]);
  // A muro never alerts.
  const m=alertRig();m.piece.kind='muro';
  unoAlertStep(m.ctx,undefined,m.state,near);
  assert.equal(m.piece.alertUntil,undefined);
});

test('construirEm: one barricada order per cell, through the build call', async ()=>{
  const {construirEm}=await import('../../src/client/hud/fortify/model.ts');
  const sent:string[]=[];
  const ids=construirEm({buildAt:(piece,c,r)=>{sent.push(`${piece}:${c}:${r}`);return sent.length;}},[{c:3,r:4},{c:4,r:4}]);
  assert.deepEqual(sent,['barricada:3:4','barricada:4:4']);
  assert.deepEqual(ids,[1,2]);
});

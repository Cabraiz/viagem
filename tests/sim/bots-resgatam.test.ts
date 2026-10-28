/**
 * bots-resgatam (P0, auditoria-bots-sim items 1, 4, 6, 7): in 6p 11 of 12 eliminations had a bot ≤ 6 u away. The calm
 * (prepare) path had no rescue, a dodge or the unstick cut the revive.
 *  1. decide(): a friend fallen 3 u off goes before a crate in the calm, a telegraph that fires after the revive ends
 *     does not move the rescuer, and standing still at the revive for 3 s never triggers the unstick.
 *  2. carLure: more than CAR_SWARM critters on the car pick the healthiest standing bot, which fights 5 u off it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {walkable} from '../../src/maps/world.ts';
import {CAR_SWARM,decide,newMemory,carLure} from '../../src/sim/bot-brain.ts';
import {ticks} from '../../src/contract/types.ts';
import type {RunView} from '../../src/contract/view.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,P=city.asset.points,wall=P.praca;
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
/** The first walkable spot `d` u or more from the plaza toward spawn S. */
const outward=(d:number)=>{
  for(let k=0;k<=400;k++){const t=k/400,s={x:wall.x+(P.spawnS.x-wall.x)*t,y:wall.y+(P.spawnS.y-wall.y)*t};if(dist(s,wall)>=d&&walkable(s,city))return s;}
  throw new Error(`no spot ${d} u out`);
};
const AT=outward(10),FALLEN=outward(13),CRATE=outward(7);

function view(opts:{tick:number;at:{x:number;y:number};phase:'wave'|'intermission';telegraphs?:RunView['telegraphs'];pickups?:RunView['pickups'];progress?:number}):RunView{
  const me={id:'bot-1',name:'bot-1',bot:true,hp:100,maxHp:100,x:opts.at.x,y:opts.at.y,online:true,weapons:[{id:'faca',level:1}],passives:[]};
  const ana={id:'ana',name:'Ana',hp:0,maxHp:100,x:FALLEN.x,y:FALLEN.y,online:true,weapons:[],passives:[],downed:{progress:opts.progress??0,bleedOutTick:opts.tick+ticks(28)}};
  return {tick:opts.tick,team:{xp:0,level:3,nextXp:50},round:{index:2,total:10,phase:opts.phase,phaseEndsTick:opts.tick+ticks(40),remaining:5},
    enemies:[],pickups:opts.pickups??[],projectiles:[],telegraphs:opts.telegraphs??[],structures:[{id:'s1',kind:'muralha',x:wall.x,y:wall.y,hp:600,maxHp:600}],
    players:[me,ana],offers:[],events:[],camp:{units:0,grana:0}} as unknown as RunView;
}

test('decide: in the calm, a friend fallen 3 u off goes before the crate next to the bot',()=>{
  const at=AT,tick=2400;
  const pickups=[{id:'bau-1',kind:'chest',value:1,x:CRATE.x,y:CRATE.y}] as unknown as RunView['pickups'];
  const d=decide({view:view({tick,at,phase:'intermission',pickups}),selfId:'bot-1',at,index:1,terrain:city,memory:newMemory(1),combat:'manual'});
  assert.equal(d.mode,'rescue');
  const l=dist(FALLEN,at),toward=(d.direction.x*(FALLEN.x-at.x)+d.direction.y*(FALLEN.y-at.y))/l;
  assert.ok(toward>.3,`it walks to her (${toward.toFixed(2)})`);
});

test('decide: at the revive the bot holds 3 s — no unstick, and a telegraph firing after the revive ends does not move it',()=>{
  const at={x:FALLEN.x+.4,y:FALLEN.y},memory=newMemory(1);
  const late=[{id:'t1',shape:'circle',x:at.x,y:at.y,radius:2,fireTick:2400+ticks(6)}] as unknown as RunView['telegraphs'];
  for(let tick=2400;tick<2400+ticks(3);tick++){
    const d=decide({view:view({tick,at,phase:'wave',telegraphs:late,progress:(tick-2400)/ticks(3)}),selfId:'bot-1',at,index:1,terrain:city,memory,combat:'manual'});
    assert.equal(d.mode,'rescue',`tick ${tick}: ${d.mode}`);
    assert.ok(Math.hypot(d.direction.x,d.direction.y)<1e-6,`tick ${tick}: it stands (${d.direction.x.toFixed(2)},${d.direction.y.toFixed(2)})`);
  }
  // One landing now still moves it.
  const now=[{id:'t2',shape:'circle',x:at.x,y:at.y,radius:2,fireTick:2400+ticks(.5)}] as unknown as RunView['telegraphs'];
  assert.equal(decide({view:view({tick:2400,at,phase:'wave',telegraphs:now}),selfId:'bot-1',at,index:1,terrain:city,memory:newMemory(1),combat:'manual'}).mode,'dodge');
});

test('carLure: a swarm on the car sends the healthiest standing bot to fight 5 u off it; under the swarm, nobody',()=>{
  const car={x:0,y:0};
  const bot=(id:string,hp:number,x:number)=>({id,bot:true,online:true,hp,maxHp:100,x,y:0});
  const swarm=(n:number)=>Array.from({length:n},(_,i)=>({id:`e${i}`,hp:10,x:Math.cos(i)*2,y:Math.sin(i)*2}));
  const v=(n:number)=>({objective:{car},enemies:swarm(n),players:[bot('bot-1',90,3),bot('bot-2',60,-3)]} as unknown as RunView);
  const p=carLure(v(CAR_SWARM+1),'bot-1',{x:3,y:0},['bot-1','bot-2'],true);
  assert.ok(p&&Math.abs(dist(p,car)-5)<1e-6&&p.x>0,`5 u off the car, on its side (${JSON.stringify(p)})`);
  assert.equal(carLure(v(CAR_SWARM+1),'bot-2',{x:-3,y:0},['bot-1','bot-2'],true),undefined,'the less healthy one stays');
  assert.equal(carLure(v(CAR_SWARM),'bot-1',{x:3,y:0},['bot-1','bot-2'],true),undefined,'not a swarm yet');
  assert.equal(carLure(v(CAR_SWARM+1),'bot-1',{x:3,y:0},['bot-1','bot-2'],false),undefined,'only in mode ninhos');
});

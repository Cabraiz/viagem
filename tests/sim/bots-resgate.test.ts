/**
 * varredura-celular P1-2 (manual combat, rounds): the hero fell in round 1 and watched the whole match, "salvou 0" for
 * everyone. A fallen friend farther than RESCUE_REACH (14 u) from every bot was never picked up: it bled out (30 s) in
 * both combats, and the manual one sends people farther (crates, weapons on the ground). Now the nearest standing bot
 * goes when the walk fits the bleed-out (RESCUE_FAR, RESCUE_SPARE), and the pull home no longer holds a rescuer back.
 *  1. decide(): a bot at the plaza walks to a friend fallen 18 u down the street; not when another bot is nearer, nor
 *     when the bleed-out will not wait for the walk.
 *  2. The real city run, manual combat: a person who falls 18 u from the plaza in round 2 is revived before bleeding out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {walkable} from '../../src/maps/world.ts';
import {RESCUE_REACH,decide,newMemory,rescueFits} from '../../src/sim/bot-brain.ts';
import {SIM_HZ,ticks} from '../../src/contract/types.ts';
import type {RunView} from '../../src/contract/view.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain,P=city.asset.points,wall=P.praca;
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
/** The first spot `d` u or more from the plaza on its line to spawn S (the street out of mouth S). */
const outward=(d:number)=>{
  for(let k=0;k<=400;k++){const t=k/400,s={x:wall.x+(P.spawnS.x-wall.x)*t,y:wall.y+(P.spawnS.y-wall.y)*t};if(dist(s,wall)>=d&&walkable(s,city))return s;}
  throw new Error(`no spot ${d} u out`);
};
const FALLEN=outward(18);

function think(opts:{at:{x:number;y:number};other?:{x:number;y:number};bleedTicks?:number}){
  const tick=2400,me={id:'bot-1',name:'bot-1',bot:true,hp:100,maxHp:100,x:opts.at.x,y:opts.at.y,online:true,weapons:[],passives:[]};
  const ana={id:'ana',name:'Ana',hp:0,maxHp:100,x:FALLEN.x,y:FALLEN.y,online:true,weapons:[],passives:[],downed:{progress:0,bleedOutTick:tick+(opts.bleedTicks??ticks(28))}};
  const players=[me,ana,...(opts.other?[{id:'bot-2',name:'bot-2',bot:true,hp:100,maxHp:100,x:opts.other.x,y:opts.other.y,online:true,weapons:[],passives:[]}]:[])];
  return decide({
    view:{tick,team:{xp:0,level:3,nextXp:50},round:{index:2,total:10,phase:'wave',phaseEndsTick:4000,remaining:5},
      enemies:[],pickups:[],projectiles:[],telegraphs:[],structures:[{id:'s1',kind:'muralha',x:wall.x,y:wall.y,hp:600,maxHp:600}],
      players,offers:[],events:[],camp:{units:0,grana:0}} as unknown as RunView,
    selfId:'bot-1',at:opts.at,index:1,terrain:city,memory:newMemory(1),combat:'manual'});
}
/** How much of the bot's step goes toward the fallen friend (1: straight at her). */
const toward=(d:ReturnType<typeof think>,at:{x:number;y:number})=>{const l=dist(FALLEN,at);return (d.direction.x*(FALLEN.x-at.x)+d.direction.y*(FALLEN.y-at.y))/l;};

test('decide: a friend fallen past RESCUE_REACH gets the nearest bot, if the bleed-out waits for the walk',()=>{
  const at={x:wall.x,y:wall.y+.5};
  assert.ok(walkable(at,city)&&dist(FALLEN,at)>RESCUE_REACH,'the fallen friend is past the old reach');
  const go=think({at});
  assert.equal(go.mode,'rescue');
  assert.ok(toward(go,at)>.3,`the bot walks to her (${toward(go,at).toFixed(2)})`);
  // Another bot nearer to her goes instead; a bleed-out shorter than the walk is not chased.
  assert.notEqual(think({at,other:outward(12)}).mode,'rescue','the nearer bot goes, not this one');
  assert.notEqual(think({at,bleedTicks:ticks(4)}).mode,'rescue','4 s left: no time to walk there');
  assert.equal(rescueFits(at,FALLEN,ticks(28),city),true);
  assert.equal(rescueFits(at,FALLEN,ticks(4),city),false);
});

test('the real city run, manual combat: a person fallen 18 u from the plaza in round 2 is revived before bleeding out',()=>{
  const sim=new Simulation(1,{world:'cidade',terrain:city,combat:'manual'}),bots=new RoomBots();
  sim.botState=()=>bots.state();
  sim.add('ana','Ana','cidadao-comum');
  for(let i=0;i<3;i++){sim.addBot(`bot-${i+1}`,`bot-${i+1}`,'feirante');bots.add(`bot-${i+1}`,i);}
  sim.resetRun();
  let down=-1,result='';
  for(let t=0;t<ticks(400)&&!result;t++){
    const a=sim.players.get('ana')!;
    // She waits at the spot, unhurt, until round 2's wave; then she is down there (the default 30 s bleed-out).
    // On the street (the run starts on the viaduct's deck since mapa-175-com-viaduto: she is put down there, floor 0).
    if(down<0){a.x=FALLEN.x;a.y=FALLEN.y;delete a.andar;a.hp=a.stats.maxHp;}
    bots.think(sim);const events=sim.step();
    if(down<0&&sim.world.round.index>=2&&sim.world.round.phase==='wave'){a.hp=0;a.downed={sinceTick:sim.tick,bleedOutTick:sim.tick+ticks(30),progress:0};down=sim.tick;}
    for(const e of events)if((e.type==='revived'||e.type==='eliminated')&&e.player==='ana')result=`${e.type} after ${((sim.tick-down)/SIM_HZ).toFixed(1)} s`;
  }
  console.log(`[bots-resgate] fallen ${dist(FALLEN,wall).toFixed(1)} u from the plaza: ${result}`);
  assert.match(result,/^revived/,result);
});

/**
 * Card BUG-20261027-ORQ-bots-tique-vai-e-volta (user, 25/10: "tô notando o tique deles muito rápido"): the room bots
 * turned back on their heading (more than 135°) 0.47 times per bot per second on Cidade Nevada (ninhos, manual), 3 in 4
 * of those 200 ms after the last one: two pulls balancing on an edge swapped the stick every think.
 *  1. the measure: the same run (seed 1, three bots and a person, 120 s) turns back well under that;
 *  2. TURN_HOLD / TURN_CALM: a turn back right after a heading began, or right after the last turn back, stands (or,
 *     kiting with a critter within DANGER, goes on); a critter within PERIL_R turns it back at once;
 *  3. CALM_SLACK: a bot out of its calm (mode 'ninhos') is calm again only with no critter within botR + CALM_SLACK;
 *  4. clearPath: of a turn open both ways, the side nearer the heading walked with.
 * On the REAL Cidade Nevada (the plaza), D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {CALMA} from '../../src/rules/index.ts';
import {NEST_PACE} from '../../src/sim/ninhos/ninhos.ts';
import {CALM_SLACK,DANGER,PERIL_R,TURN_CALM,TURN_HOLD,calmRound,clearPath,decide,newMemory,type BrainInput} from '../../src/sim/bot-brain.ts';
import type {RunView} from '../../src/contract/index.ts';
import type {TerrainField} from '../../src/maps/index.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;

/** Seed 1, three room bots and a person, 120 s: turn-backs (more than 135°) and those 200 ms or less after the bot's last. */
function tique(pace?:Partial<typeof NEST_PACE>){
  const save={...NEST_PACE};Object.assign(NEST_PACE,pace);
  try{
    const sim=new Simulation(1,{world:'cidade',terrain:city,objective:'chaveiro',combat:'manual',mode:'ninhos'});
    const room=new RoomBots();
    sim.add('p1','Pessoa','clt');
    for(let i=0;i<3;i++){sim.addBot('b'+i,'Bot'+i,['clt','maromba','viciado'][i]);room.add('b'+i,i);}
    sim.botState=()=>room.state();sim.resetRun();room.reset();
    const last=new Map<string,{x:number;y:number}>(),lastBack=new Map<string,number>();
    let back=0,quick=0,tick=0;
    const set=sim.setBotInput.bind(sim);
    sim.setBotInput=(id,d,...rest)=>{
      const l=last.get(id),n=Math.hypot(d.x,d.y);
      if(n>.01){
        if(l&&(l.x*d.x+l.y*d.y)/n<Math.cos(135*Math.PI/180)){
          back++;
          const b=lastBack.get(id);if(b!==undefined&&tick-b<=4)quick++;
          lastBack.set(id,tick);
        }
        last.set(id,{x:d.x/n,y:d.y/n});
      }
      return set(id,d,...rest);
    };
    const seconds=120;
    for(;tick<seconds*20;tick++){room.think(sim);sim.step();}
    return {rate:back/3/seconds,back,quick};
  }finally{Object.assign(NEST_PACE,save);}
}

// Measured with the pace of the time (Minerva 120 s, the first wave past the 120 s): the bots walking, no fight.
test('the user\'s tique: three room bots in the nests turn back under 0.25 times a second each (0.47 before)',()=>{
  const {rate}=tique({minerva:120,first:[30,60],firstLate:[60,0],explore:120});
  assert.ok(rate<.25,`half-turns per bot per second: ${rate.toFixed(2)}`);
});

// Card missao-proteger-uno-tempo: the first wave now comes at 35-45 s, so the 120 s hold a fight. Kiting turns back on
// purpose (0.28 a second, 99 turns), but the tique, the swap every think (3 in 4 within 200 ms before), stays out: 2 in 99.
test('in the first wave (the NEST_PACE default) the turn-backs are kiting, not the 200 ms swap',()=>{
  const {back,quick}=tique();
  assert.ok(back>0,'the first wave reaches the bots inside the 120 s');
  assert.ok(quick/back<.1,`turn-backs within 200 ms of the last: ${quick} of ${back}`);
});

/** A bare wave view: one bot at the origin, a critter at `critter`. */
function view(tick:number,critter?:{x:number;y:number}):RunView{
  return {tick,round:{index:1,total:3,phase:'wave',phaseEndsTick:tick+20*60,remaining:1},
    players:[{id:'b',name:'b',classId:'clt',hp:10,maxHp:10,bot:true,online:true,weapons:[]}],
    enemies:critter?[{id:'e',kind:'bebado',x:critter.x,y:critter.y,hp:5,maxHp:5}]:[],
    pickups:[],projectiles:[],telegraphs:[],structures:[],offers:[]} as unknown as RunView;
}
const input=(v:RunView,memory=newMemory(0)):BrainInput=>({view:v,selfId:'b',at:{x:0,y:0},index:1,memory});

test('TURN_HOLD and TURN_CALM: a turn back on a young heading stands; a critter within PERIL_R turns it back at once',()=>{
  assert.ok(TURN_HOLD>=8&&TURN_CALM>TURN_HOLD,'400 ms, and the calm longer');
  const memory=newMemory(0);
  memory.heading={x:1,y:0};memory.headingTick=100;
  // A critter DANGER+3 to the west, out of reach: the brain wants west, the held heading is east.
  const far={x:-(DANGER+3),y:0};
  const wanted=decide(input(view(1000,far),{...newMemory(0)}));
  assert.ok(wanted.direction.x<0,`the brain alone goes west: ${JSON.stringify(wanted.direction)}`);
  const held=decide(input(view(104,far),memory));
  assert.deepEqual(held.direction,{x:0,y:0},'4 ticks into the heading: it stands instead of turning back');
  // Past TURN_HOLD (and no turn back before) it turns.
  const later=newMemory(0);later.heading={x:1,y:0};later.headingTick=100;
  assert.ok(decide(input(view(100+TURN_HOLD,far),later)).direction.x<0,'past TURN_HOLD it turns back');
  // Turned back TURN_CALM ago or less: it stands again.
  const calm=newMemory(0);calm.heading={x:1,y:0};calm.headingTick=0;calm.turnBackTick=1000;
  assert.deepEqual(decide(input(view(1000+TURN_CALM-4,far),calm)).direction,{x:0,y:0},'within TURN_CALM of the last turn back');
  // In peril (a critter within PERIL_R) nothing holds it.
  const peril=newMemory(0);peril.heading={x:-1,y:0};peril.headingTick=100;
  const out=decide(input(view(104,{x:-PERIL_R/2,y:0}),peril));
  assert.ok(out.direction.x>0,`a critter on top: away at once ${JSON.stringify(out.direction)}`);
});

test('CALM_SLACK: out of its calm, a bot is calm again only with no critter within botR + CALM_SLACK',()=>{
  const at={x:0,y:0},v=view(1000,{x:CALMA.botR+CALM_SLACK/2,y:0});
  assert.equal(calmRound(v,at).round!.phase,'prepare','calm before: the critter is past botR');
  assert.equal(calmRound(v,at,true).round!.phase,'prepare');
  assert.equal(calmRound(v,at,false).round!.phase,'wave','was in its wave: the critter is within the slack');
  assert.equal(calmRound(view(1000,{x:CALMA.botR+CALM_SLACK+.1,y:0}),at,false).round!.phase,'prepare');
});

test('clearPath: of a turn open both ways, the side nearer the heading walked with (else the left, as before)',()=>{
  // A city mask with a wall straight east (x 0.5..1.5, |y| < .3): the 0.5 rad turns both clear it.
  const terrain={clearDisc:(x:number,y:number)=>!(x>.5&&x<1.5&&Math.abs(y)<.3),base:{x:0,y:0},spawn:{x:0,y:0}} as unknown as TerrainField;
  const want={x:1,y:0};
  const left=clearPath({x:0,y:0},want,terrain),right=clearPath({x:0,y:0},want,terrain,{x:0,y:-1});
  assert.ok(left.y>0,`default: the left turn ${JSON.stringify(left)}`);
  assert.ok(right.y<0,`heading south: the right turn ${JSON.stringify(right)}`);
});

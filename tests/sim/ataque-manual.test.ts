// D-051 step 1 (NEW-20261014-ORQ-ataque-manual-wild-rift): the manual attack behind RunSystemsOptions.combat 'manual'.
// Default off: the first tests pin that a run without it is byte-identical to main before this card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {DIRECTIONS} from '../../src/protocol/input-track.ts';
import {Rng} from '../../src/contract/rng.ts';
import {stateHash} from '../../src/sim/core.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
// A deterministic run script: the whole roster (ROSTER_ONLY_WITH_ART off), like the other replay tests.
setRosterOnlyWithArt(false);

const CLASSES=['cidadao-comum','viciado-em-bet','clt-cansado','motogirl','vizinha-fofoqueira','mendigo'];

/**
 * A scripted Simulation run with every input path of main: legacy steps (attack true, skills, tap targets), 10 Hz
 * batches with the skill flag and targets, skill taps and an offline window. The digest of every tick's stateHash
 * and of every event.
 */
function offRun(seed:number,ticks:number,combat?:'auto'){
  const s=new Simulation(seed,combat?{combat}:{}),r=new Rng(seed^0x9e3779b9);
  const ids=CLASSES.map((c,i)=>{s.add(`p${i}`,`P${i}`,c);return `p${i}`;});
  s.resetRun();
  const hashes:string[]=[],events:string[]=[];let tap=0;
  for(let t=1;t<=ticks;t++){
    if(t===250)s.setOnline('p2',false);
    if(t===400)s.setOnline('p2',true);
    const live=s.enemies.filter(e=>e.hp>0);
    for(const id of ids){
      if(id==='p0'||id==='p1'){
        if(t%2)continue;
        const d=DIRECTIONS[r.int(0,DIRECTIONS.length-1)],stop=r.chance(.2),target=live.length&&r.chance(.3)?r.pick(live).id:undefined;
        s.input(id,{seq:t,steps:[[t,stop?0:d.x,stop?0:d.y,r.chance(.05)?1:0,...(target?[target]:[])]]},t*50);
      }else s.input(id,{seq:t,x:r.range(-1,1),y:r.range(-1,1),attack:true,skill:r.chance(.03),target:live.length&&r.chance(.3)?r.pick(live).id:undefined},t*50);
    }
    if(t%90===0)s.tap('p1',++tap);
    s.step(t*50);
    hashes.push(s.stateHash());
    for(const e of s.events)events.push(JSON.stringify(e));
  }
  return {hash:stateHash(hashes),events:stateHash(events),kills:s.statsOf('p0').kills+s.statsOf('p1').kills};
}

/** A room on the island: Ana walks in circles (10 Hz batches) with two room bots, `ticks` combat ticks. */
function offRoom(seed:number,ticks:number,combat?:'auto'){
  const messages:any[]=[],a={send:(m:string|Uint8Array)=>{if(typeof m==='string')messages.push(JSON.parse(m));},close:()=>{}} as Peer;
  let n=0;
  const room=new Room(1000,seed,{world:'ilha',newId:()=>`pessoa-${++n}`,...(combat?{combat}:{})});
  let t=1000;
  const say=(m:object)=>room.receive(a,JSON.stringify(m),t),round=()=>room.run.snapshot().round;
  room.connect(a,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'viciado-em-bet'});
  for(let i=0;i<2;i++){t+=OWNER_GAP_MS;say({t:'bot-add',round:round()});}
  t+=OWNER_GAP_MS;say({t:'ready',round:round(),ready:true});
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const hashes:string[]=[];let seq=0;
  for(let i=0;i<ticks&&room.run.snapshot().phase==='combat';i++){
    t+=50;seq++;
    if(i%2===0){const d=DIRECTIONS[Math.floor(i/40)%DIRECTIONS.length];say({t:'input',round:round(),seq,steps:[[seq,d.x,d.y,0]]});}
    if(i%20===0)say({t:'ack',seq:0});
    room.advance(t);
    hashes.push(room.sim.stateHash());
  }
  return stateHash(hashes);
}

test('combat off: a scripted Simulation run is byte-identical to main before D-051 (and combat auto is the same run)',()=>{
  // Recorded on main a2e951f (before D-051) with this very script.
  const off=offRun(0x51a7,900);
  assert.deepEqual(off,{hash:'6c79a9f3',events:'3b5a0511',kills:7});
  assert.deepEqual(offRun(0x51a7,900,'auto'),off);
});

test('combat off: a room with bots is byte-identical to main before D-051 (and combat auto is the same run)',()=>{
  // Recorded on main 82893df (before D-051; the D-050 level-up pause moved it from a2e951f's eb80946b) with this very script.
  const off=offRoom(0x2b1d,1200);
  assert.equal(off,'3424b518');
  assert.equal(offRoom(0x2b1d,1200,'auto'),off);
});

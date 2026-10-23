/**
 * BUG heroi-vai-e-volta: a change that reaches the room after it guessed past it (jitter, a phone whose step clock fell
 * behind) is redone on the room (InputTrack.rewind), so the phone's prediction is not pulled back along the old
 * direction; bounded so a forged client still gains nothing (REWIND_MAX_STEPS).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {reconcile,simulate,STEP} from '../../src/maps/prediction.ts';
import {heroSpeed,type Point} from '../../src/maps/world.ts';
import {REWIND_MAX_STEPS} from '../../src/protocol/input-track.ts';
import type {PlayerInput} from '../../src/contract/index.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

const WALK=heroSpeed();
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

/** The room walks east on the client's clock until `ticks`; the client really turned north at step `turn`. */
function lateTurn(ticks:number,turn:number){
  const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();
  const start={x:p.x,y:p.y};
  assert.equal(s.input('p',{seq:1,steps:[[1,1,0,0]]},0),true);
  for(let t=1;t<=ticks;t++)s.step(t*50);
  return {s,p,start};
}
/** The client's own path: east until `turn`, north from it, `steps` steps in all. */
function clientPath(s:Simulation,start:Point,turn:number,steps:number){
  let at={...start};const inputs:PlayerInput[]=[];
  for(let seq=1;seq<=steps;seq++){const i:PlayerInput={seq,x:seq<turn?1:0,y:seq<turn?0:1,attack:false,skill:false};inputs.push(i);at=simulate(at,i,s.terrain,0);}
  return {at,inputs};
}

test('a turn that comes late (within REWIND_MAX_STEPS) is redone: the room ends where the phone is, nothing to correct',()=>{
  const {s,p,start}=lateTurn(20,0);
  const applied=p.ack,turn=applied-REWIND_MAX_STEPS+2;
  assert.ok(turn>1);
  // The turn left the phone at `turn` but reached the room only now (a 200 ms spike): it already walked east past it.
  assert.equal(s.input('p',{seq:applied,steps:[[turn,0,1,0]]},20*50),true);
  const phone=clientPath(s,start,turn,applied);
  assert.ok(dist(p,phone.at)<1e-9,`room ${p.x},${p.y} vs phone ${phone.at.x},${phone.at.y}`);
  // The owner's frame replays to the phone's own prediction: zero correction.
  const own=s.confirmed('p')??{x:p.x,y:p.y,ack:p.ack};
  const pending=phone.inputs.filter(i=>i.seq>own.ack);
  assert.ok(dist(reconcile(own,pending,s.terrain,{tick:s.tick}),phone.at)<1e-9);
  // And it goes on north from there.
  const y=p.y;for(let t=21;t<=24;t++)s.step(t*50);assert.ok(p.y>y);
});

test('older than REWIND_MAX_STEPS: the old rule (the new state from the next step on), no jump',()=>{
  const {s,p}=lateTurn(30,0);
  const applied=p.ack,turn=applied-REWIND_MAX_STEPS-3,before={x:p.x,y:p.y};
  assert.equal(s.input('p',{seq:applied,steps:[[turn,0,1,0]]},30*50),true);
  assert.deepEqual({x:p.x,y:p.y},before,'not rewound');
  for(let t=31;t<=34;t++)s.step(t*50);
  assert.ok(p.y>before.y&&Math.abs(p.x-before.x)<1e-9,'north from here');
});

test('not rewound when something else moved the player meanwhile (a push, a dash): the guess does not reproduce',()=>{
  const {s,p}=lateTurn(20,0);
  p.x+=.37;const before={x:p.x,y:p.y};
  assert.equal(s.input('p',{seq:p.ack,steps:[[p.ack-2,0,1,0]]},20*50),true);
  assert.deepEqual({x:p.x,y:p.y},before);
});

test('forged batches: one message moves a player at most 2 × REWIND_MAX_STEPS steps, one tick at most one step',()=>{
  for(let seed=1;seed<=30;seed++){
    let r=seed;const rnd=()=>{r=(r*1103515245+12345)%2147483648;return r/2147483648;};
    const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();
    let now=0,seq=1,lastFrom=0;
    for(let t=0;t<300;t++){
      for(let k=Math.floor(rnd()*3);k>0;k--){
        // A cheater reporting a stale seq (to keep the room guessing) and rewriting the guessed tail every message.
        seq=Math.max(seq,Math.max(1,p.ack-Math.floor(rnd()*REWIND_MAX_STEPS)));
        const from=Math.max(lastFrom+1,seq-Math.floor(rnd()*3));
        if(from>seq)continue;
        const a=rnd()*7,before={x:p.x,y:p.y};
        if(s.input('p',{seq,steps:[[from,Math.round(Math.cos(a)*1e4)/1e4,Math.round(Math.sin(a)*1e4)/1e4,0]]},now))lastFrom=from;
        assert.ok(dist(p,before)<=2*REWIND_MAX_STEPS*WALK*STEP+1e-9,`seed ${seed}, tick ${t}: ${dist(p,before).toFixed(3)} u in one message`);
      }
      const before={x:p.x,y:p.y};now+=50;s.step(now);
      assert.ok(dist(p,before)<=WALK*STEP+1e-9,`seed ${seed}, tick ${t}: ${dist(p,before).toFixed(3)} u in one tick`);
    }
  }
});

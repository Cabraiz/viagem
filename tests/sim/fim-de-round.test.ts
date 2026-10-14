// NEW-ORQ-fim-de-round-no-infinito: in the endless world a round ends at its last kill, not by the clock, even with the
// team waiting by the base (the last call: LAST_CALL_SECONDS, LAST_CALL_NEAR in director.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,Simulation} from '../../multiplayer/simulation.ts';
import {ticks} from '../../src/contract/types.ts';
import {CATCH_UP_SPEED,LAST_CALL_NEAR,LAST_CALL_PACE,LAST_CALL_SECONDS,lastCallBoost} from '../../src/sim/director.ts';
import {ENEMIES} from '../../src/sim/enemies/catalog.ts';
import {SPEED,clearSegment} from '../../src/maps/world.ts';
import {ROUNDS} from '../../src/rules/waves.ts';

interface RoundEnd {round:number;waveTicks:number;timedOut:boolean;fled:number;spawned:number;calledAt?:number;endsAtCall?:number}
/** Six heroes that never move (by the base, where they spawn) and take the default offers at once. */
function standStill(seed:number,rounds:number){
  const sim=new Simulation(seed,{world:DEFAULT_WORLD});
  const ids=Array.from({length:6},(_,i)=>`p${i}`);ids.forEach(id=>sim.add(id,id,'cidadao-comum'));sim.resetRun();
  const director=(sim as unknown as {systems:{director:{state:{timedOut:boolean;retreated:number;spawned:number;called?:boolean}}}}).systems.director;
  const ends:RoundEnd[]=[];let waveAt=0,calledAt:number|undefined,endsAtCall:number|undefined;
  const hurried:number[]=[];
  for(let t=0;t<ticks(4*80)&&ends.length<rounds;t++){
    const before=director.state.called;
    for(const e of sim.step()){
      if(e.type==='round'&&e.phase==='wave'){waveAt=sim.tick;calledAt=undefined;endsAtCall=undefined;}
      if(e.type==='round'&&e.phase==='end'){const s=director.state;ends.push({round:e.index,waveTicks:sim.tick-waveAt,timedOut:s.timedOut,fled:s.retreated,spawned:s.spawned,calledAt,endsAtCall});}
    }
    if(!before&&director.state.called){calledAt=sim.tick;endsAtCall=sim.world.round.phaseEndsTick;}
    for(const id of ids){const head=sim.offers(id)[0];if(head)sim.choose(id,head.id,head.defaultIndex);}
  }
  return {ends,hurried,sim};
}

// (Before: every round timed out, 13-49 bichos of rounds 1-2 fled. A siege group chewing the wall 6 u from the heroes
// may still outlast round 2's clock, which is the game: the HUD counts it and the wall notice shows where it is.)
test('endless world, team waiting by the base: round 1 ends at the last kill and nobody flees in rounds 1-2',()=>{
  for(const seed of [1,2]){
    const {ends}=standStill(seed,2);
    assert.equal(ends.length,2,`seed ${seed}: two rounds`);
    for(const end of ends){
      if(end.round===1)assert.equal(end.timedOut,false,`seed ${seed} round 1: ended by the clock (${JSON.stringify(end)})`);
      assert.equal(end.fled,0,`seed ${seed} round ${end.round}: ${end.fled} fled`);
      assert.ok(end.waveTicks<=ticks(ROUNDS[end.round-1].maxDuration+LAST_CALL_SECONDS),`seed ${seed} round ${end.round}: ${end.waveTicks/20} s`);
    }
  }
});

test('the last call starts once every group is out and gives the round at least LAST_CALL_SECONDS more',()=>{
  const {ends}=standStill(3,1);
  const [first]=ends;
  assert.ok(first.calledAt!==undefined,'the last call started');
  assert.ok(first.endsAtCall!>=first.calledAt!+ticks(LAST_CALL_SECONDS),'deadline pushed');
  assert.ok(LAST_CALL_NEAR>=6,'the last stretch in is at the bicho\'s own pace (≥ 6 u: over 4 s for a bêbado)');
});

test('the last call is deterministic: the same seed ends its rounds on the same ticks',()=>{
  const a=standStill(2,1).ends,b=standStill(2,1).ends;
  assert.deepEqual(a,b);
});

test('code review: on someone\'s screen a called bicho never outruns a hero (pace + boost ≤ 0.9 × SPEED, every kind and the elite)',()=>{
  for(const [kind,def] of Object.entries(ENEMIES)){
    if(kind==='chefe')continue;
    for(const pace of [def.speed,def.speed*1.2]){
      // (A pombo is already faster than that on its own: it gets no boost at all.)
      assert.ok(pace+lastCallBoost(pace,false)<=Math.max(pace,LAST_CALL_PACE*SPEED)+1e-9,`${kind} at ${pace} u/s`);
      assert.ok(lastCallBoost(pace,false)>=0);
    }
  }
  // Off every screen the old catch-up stays (nobody can see it).
  assert.equal(lastCallBoost(1.4,true),CATCH_UP_SPEED);
  assert.ok(LAST_CALL_PACE*SPEED<SPEED);
});

test('code review: a hero running in a straight line on open ground after the call is not caught by the bichos behind',()=>{
  let checked=0;
  for(const seed of [4,5,6,7]){
    const sim=new Simulation(seed,{world:DEFAULT_WORLD});
    sim.add('p0','p0','cidadao-comum');sim.resetRun();
    const director=(sim as unknown as {systems:{director:{state:{called?:boolean}}}}).systems.director;
    const hero=sim.players.get('p0')!;
    let t=0;
    for(;t<ticks(80)&&!director.state.called;t++){hero.invulnerableUntil=sim.tick+40;sim.step();for(const o of sim.offers('p0'))sim.choose('p0',o.id,o.defaultIndex);}
    if(!director.state.called)continue;
    // A direction with 25 u of open ground ahead.
    const dir=[0,1,2,3,4,5,6,7].map(k=>({x:Math.cos(k*Math.PI/4),y:Math.sin(k*Math.PI/4)})).find(u=>clearSegment(hero,{x:hero.x+u.x*25,y:hero.y+u.y*25},sim.terrain));
    if(!dir)continue;
    const behind=[...sim.world.enemies.values()].filter(e=>{const dx=e.x-hero.x,dy=e.y-hero.y,d=Math.hypot(dx,dy);return d>LAST_CALL_NEAR&&(dx*dir.x+dy*dir.y)/d<-.5;}).map(e=>({e,d0:Math.hypot(e.x-hero.x,e.y-hero.y)}));
    const start={x:hero.x,y:hero.y};let seq=0;
    for(let k=0;k<ticks(6);k++){hero.invulnerableUntil=sim.tick+40;sim.input('p0',{seq:++seq,x:dir.x,y:dir.y,attack:false});sim.step();for(const o of sim.offers('p0'))sim.choose('p0',o.id,o.defaultIndex);}
    const ran=Math.hypot(hero.x-start.x,hero.y-start.y);
    if(ran<SPEED*6*.9)continue;
    for(const {e,d0} of behind){if(!sim.world.enemies.has(e.id))continue;const d=Math.hypot(e.x-hero.x,e.y-hero.y);
      // Off every default-zoom screen (≥ 28.8 u away, D-046: the catch-up paces at the hero-47 px default) the old catch-up may close in; from there on the hero only gets away.
      assert.ok(d>=Math.min(d0,25)-.5,`seed ${seed}: ${e.id} (${e.kind}) closed from ${d0.toFixed(1)} to ${d.toFixed(1)} u while the hero ran ${ran.toFixed(1)} u`);checked++;}
  }
  assert.ok(checked>=5,`only ${checked} bichos behind were checked`);
});

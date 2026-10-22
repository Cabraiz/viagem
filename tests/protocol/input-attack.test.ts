// D-051 step 1: the attack button on the 10 Hz input (segment flag bit 1), held between segments, with an edge latch
// (attackPress) so a tap shorter than the 10 Hz slot still attacks once. Style of input-track.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECTIONS,InputBatcher,InputTrack,SEGMENT_AIM_SHIFT,SEGMENT_ATTACK,SEGMENT_SKILL,segmentOf,segmentWire} from '../../src/protocol/input-track.ts';
import type {PlayerInput,SimPlayer} from '../../src/contract/types.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {movePlayer} from '../../src/sim/systems/players.ts';
import {SPAWN} from '../../src/maps/world.ts';
import {defaultTerrain} from '../../src/maps/terrain/field.ts';

const body={x:0,y:0} as SimPlayer;
/** Every step the track hands out over `n` ticks (clock: 50 ms a tick from `t0`). */
function steps(t:InputTrack,n:number,t0:number){const out:(PlayerInput|undefined)[]=[];for(let i=1;i<=n;i++)out.push(t.next(body,t0+i*50));return out;}

test('segment flags: 0–131 accepted (bit 0 skill, bit 1 attack, bits 2+ the aim), anything else refused; the wire round-trips',()=>{
  assert.equal(SEGMENT_SKILL,1);assert.equal(SEGMENT_ATTACK,2);
  assert.deepEqual(segmentOf([5,1,0,0]),{from:5,x:1,y:0,skill:false});
  assert.deepEqual(segmentOf([5,1,0,1]),{from:5,x:1,y:0,skill:true});
  assert.deepEqual(segmentOf([5,1,0,2]),{from:5,x:1,y:0,skill:false,attack:true});
  assert.deepEqual(segmentOf([5,0,0,3,'e12']),{from:5,x:0,y:0,skill:true,target:'e12',attack:true});
  for(const flags of [132,-1,1.5,'2',true,null])assert.equal(segmentOf([5,1,0,flags]),undefined,String(flags));
  for(const w of [[5,1,0,0],[5,1,0,1],[5,1,0,2],[5,0,0,3,'e12']])assert.deepEqual(segmentWire(segmentOf(w)!),w);
  // No attack: the segment has no attack key at all (the track's state, in the replay hash, is as before).
  assert.equal('attack' in segmentOf([5,1,0,1])!,false);
});

test('batcher: pressing and releasing the attack are changes; the target rides the same segment; holding keeps it active',()=>{
  const b=new InputBatcher();b.reset(0);
  let r=b.step({x:0,y:0},false,'e7',true);
  assert.equal(r.active,true,'standing and holding: the room keeps stepping us');assert.equal(r.input.attack,true);
  assert.deepEqual(b.take(0)!.steps,[[1,0,0,SEGMENT_ATTACK,'e7']]);
  r=b.step({x:0,y:0},false,'e7',true);assert.equal(b.take(100),undefined,'held: no change, no message');
  assert.equal(b.active,true);
  b.step({x:0,y:0},false,undefined,false);assert.deepEqual(b.take(200)!.steps,[[3,0,0,0]]);
  assert.equal(b.active,false);
  // Old callers (no attack argument): flags as before.
  b.step({x:1,y:0},true);assert.deepEqual(b.take(300)!.steps,[[4,1,0,SEGMENT_SKILL]]);
});

test('track: the attack is held between segments, every step attacks until the release',()=>{
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:8,steps:[[1,0,0,SEGMENT_ATTACK],[8,0,0,0]]},0));
  const out=steps(t,12,1000);
  assert.deepEqual(out.slice(0,7).map(i=>i?.attack),[true,true,true,true,true,true,true],'standing and holding: stepped, attacking');
  assert.deepEqual(out.slice(7),[undefined,undefined,undefined,undefined,undefined],'released at step 8: standing, no steps');
  assert.deepEqual(out.slice(0,7).map(i=>i!.seq),[1,2,3,4,5,6,7]);
});

test('track: a tap shorter than the 10 Hz slot (its steps already past) still attacks once, on the next step',()=>{
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:3,steps:[[1,1,0,0]]},0));
  steps(t,10,0);
  const applied=t.applied;assert.ok(applied>3,'the room guessed past the report');
  // Pressed at 4, released at 5: both already applied by the room's guess.
  assert.ok(t.accept({seq:applied,steps:[[4,1,0,SEGMENT_ATTACK],[5,1,0,0]]},600));
  assert.equal(t.state().attackPress,true);
  const after=steps(t,6,600);
  assert.deepEqual(after.map(i=>i?.attack??false),[true,false,false,false,false,false]);
  assert.equal(t.state().attackPress,undefined,'the latch is spent');
});

test('track: the skill bit still works, both bits together press both; legacy steps never hold the attack',()=>{
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:3,steps:[[1,0,0,SEGMENT_SKILL|SEGMENT_ATTACK]]},0));
  const [first]=steps(t,1,1000);
  assert.equal(first!.skill,true);assert.equal(first!.attack,true);
  const legacy=new InputTrack();legacy.reset(0);
  assert.ok(legacy.accept({seq:1,x:0,y:0,attack:true}));
  assert.equal(legacy.next(body),undefined,'a legacy attack:true is no hold (it never meant anything)');
  assert.deepEqual(Object.keys(legacy.state()).sort(),['applied','batched','casts','held','knownAt','known','lastCast','lastFrom','queue','skillPress'].sort());
});

test('Simulation: the held attack reaches the players system as PlayerInput.attack through a real track',()=>{
  const s=new Simulation(3,{combat:'manual'}),p=s.add('p','P','viciado-em-bet');s.resetRun();
  const seen:boolean[]=[];
  const track=(s as unknown as {tracks:Map<string,InputTrack>}).tracks.get('p')!;
  const next=track.next.bind(track);
  track.next=(q,now)=>{const i=next(q,now);if(i)seen.push(i.attack);return i;};
  assert.ok(s.input('p',{seq:6,steps:[[1,0,0,SEGMENT_ATTACK],[4,0,0,0]]},0));
  for(let i=1;i<=8;i++)s.step(1000+i*50);
  assert.deepEqual(seen,[true,true,true]);
  assert.equal(p.ack,3,'standing while holding spends the client steps; the release stands still');
});

// NEW-20261021-ORQ-cone-ataque-melee: the mouse's aim while attacking (bits 2+ of the flags: bucket + 1).
test('aim: bits 2+ carry the bucket + 1 and round-trip; no aim, no key',()=>{
  assert.equal(SEGMENT_AIM_SHIFT,2);
  assert.deepEqual(segmentOf([5,0,0,SEGMENT_ATTACK|1<<SEGMENT_AIM_SHIFT]),{from:5,x:0,y:0,skill:false,attack:true,aim:0});
  assert.deepEqual(segmentOf([5,0,0,SEGMENT_ATTACK|32<<SEGMENT_AIM_SHIFT,'e3']),{from:5,x:0,y:0,skill:false,target:'e3',attack:true,aim:31});
  for(const w of [[5,1,0,2|8<<2],[5,0,0,3|32<<2,'e12']])assert.deepEqual(segmentWire(segmentOf(w)!),w);
  assert.equal('aim' in segmentOf([5,1,0,2])!,false);
});

test('batcher: the aim goes only while attacking, quantized; moving the mouse without the attack sends nothing',()=>{
  const b=new InputBatcher();b.reset(0);
  b.step({x:0,y:0},false,undefined,false,{x:0,y:5});
  assert.equal(b.take(0),undefined,'no attack: the mouse alone is no change');
  const r=b.step({x:0,y:0},false,undefined,true,{x:0,y:5});
  const up=DIRECTIONS.findIndex(d=>d.x===0&&d.y===1);
  assert.deepEqual(r.input.aim,{x:0,y:1});
  assert.deepEqual(b.take(100)!.steps,[[2,0,0,SEGMENT_ATTACK|(up+1)<<SEGMENT_AIM_SHIFT]]);
  b.step({x:0,y:0},false,undefined,true,{x:.05,y:5});
  assert.equal(b.take(200),undefined,'a tiny turn stays in the bucket (hysteresis)');
  b.step({x:0,y:0},false,undefined,true,{x:5,y:0});
  assert.deepEqual(b.take(300)!.steps,[[4,0,0,SEGMENT_ATTACK|1<<SEGMENT_AIM_SHIFT]]);
  const off=b.step({x:0,y:0},false,undefined,false,{x:5,y:0});
  assert.equal('aim' in off.input,false);
  assert.deepEqual(b.take(400)!.steps,[[5,0,0,0]]);
});

test('track: a late tap keeps its aim for the press even when the release segment came with it',()=>{
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:3,steps:[[1,1,0,0]]},0));
  steps(t,10,0);
  const applied=t.applied;
  assert.ok(t.accept({seq:applied,steps:[[4,1,0,SEGMENT_ATTACK|9<<SEGMENT_AIM_SHIFT],[5,1,0,0]]},600));
  const [first,second]=steps(t,2,600);
  assert.equal(first?.attack,true);assert.deepEqual(first?.aim,DIRECTIONS[8]);
  assert.equal(second?.aim,undefined);
  assert.equal(t.state().pressAim,undefined,'spent with the press');
});

test('room: the attack held in place while slipping (pombo poop) never slides the hero; walking still does (BUG-20261022-ORQ-botao-direito-anda)',()=>{
  // D-036: standing still never slides; since D-051 a held attack (right button, Space, Atacar) steps the room while
  // standing, and those steps slid a hero on poop ~0.4 u per tick (found while chasing the print sheet's right button).
  const t=new InputTrack();t.reset(0);
  assert.ok(t.accept({seq:8,steps:[[1,0,0,SEGMENT_ATTACK],[6,1,0,0]]},0));
  const hero={id:'h',x:SPAWN.x,y:SPAWN.y,hp:100,facing:{x:1,y:0},slipUntil:1e9,slip:{x:1,y:0}} as unknown as SimPlayer;
  const after=new Map<number,{x:number;y:number;attack:boolean}>();
  for(let tick=1;tick<=40;tick++){const input=t.next(hero,tick*50);if(input){movePlayer(hero,input,defaultTerrain,tick);after.set(input.seq,{x:hero.x,y:hero.y,attack:input.attack});}}
  for(let seq=1;seq<=5;seq++)assert.deepEqual(after.get(seq),{x:SPAWN.x,y:SPAWN.y,attack:true},`attack step ${seq}, standing: no slide`);
  assert.ok(after.get(8)!.x>SPAWN.x+.5,`the walk from step 6 slides along the poop (${after.get(8)!.x-SPAWN.x} u)`);
});

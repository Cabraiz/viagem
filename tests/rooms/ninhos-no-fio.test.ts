// D-051 on the wire (card NEW-20261014-ORQ-ninhos-sim, for E3's nest render): a ninhos city room sends the nests as
// structures (kind 'ninho', size, phase dormindo/ativo/destruido, seen once someone came near; a fallen one stays at hp 0)
// and the sleeping bodies near the players as enemies with `asleep` (never the nests' hit targets), at most
// ASLEEP_PER_VIEWER per client, the nearest ones. A rounds room sends none of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Simulation} from '../../multiplayer/simulation.ts';
import {DICT,FrameDecoder,FrameEncoder,WireIds} from '../../src/protocol/protocol4.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {ASLEEP_PER_VIEWER,INTEREST_RADIUS} from '../../src/contract/offscreen.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const loaded=await cityTerrainFrom(cityText,manifest.hash);
if(!loaded.ok)throw new Error(loaded.error);

function room(mode?:'ninhos'){
  const sim=new Simulation(11,{world:'cidade',terrain:loaded.terrain,cityStructures:true,objective:'chaveiro',...(mode?{mode}:{})});
  sim.addBot('bot-1','bot-1','cidadao-comum');
  sim.resetRun();
  for(let i=0;i<3;i++)sim.step();
  return sim;
}
const put=(sim:Simulation,x:number,y:number)=>{const p=sim.players.get('bot-1')!;p.x=x;p.y=y;};

test('ninhos room: the nests are structures (size, phase, hp), seen once someone comes near; a fallen one stays at hp 0',()=>{
  const sim=room('ninhos'),nests=sim.run.nests!.state.nests;
  assert.equal(nests.length,8);
  let wire=sim.frame().structures.filter(s=>s.kind==='ninho');
  assert.deepEqual(wire.map(s=>s.id),nests.map(n=>n.id));
  for(const s of wire){
    assert.ok(s.size==='P'||s.size==='M'||s.size==='G');
    assert.equal(s.phase,'dormindo');assert.ok(s.hp>0&&s.hp===s.maxHp);
  }
  const far=nests.reduce((a,b)=>Math.hypot(b.x-nests[0].x,b.y-nests[0].y)>Math.hypot(a.x-nests[0].x,a.y-nests[0].y)?b:a);
  put(sim,nests[0].x+3,nests[0].y);
  wire=sim.frame().structures.filter(s=>s.kind==='ninho');
  assert.equal(wire.find(s=>s.id===nests[0].id)!.seen,true);
  assert.equal(wire.find(s=>s.id===far.id)!.seen,undefined,'the far one is still in the fog');
  // Walking away keeps it seen (the team saw it).
  put(sim,far.x+200,far.y+200);
  assert.equal(sim.frame().structures.find(s=>s.id===nests[0].id)!.seen,true);
  // A hit nest is active (and seen); a fallen one stays, hp 0, 'destruido'.
  sim.run.nests!.hit(sim.world,far.id,1);
  assert.deepEqual((({phase,seen})=>({phase,seen}))(sim.frame().structures.find(s=>s.id===far.id)!),{phase:'ativo',seen:true});
  sim.run.nests!.hit(sim.world,nests[0].id,1e9);
  const frame=sim.frame(),down=frame.structures.find(s=>s.id===nests[0].id)!;
  assert.deepEqual({hp:down.hp,phase:down.phase},{hp:0,phase:'destruido'});
  // Through a client's encoder: every nest (structures go to everyone) with its size, phase and seen.
  const r=new FrameDecoder().decode(new FrameEncoder(new WireIds(),{viewer:'bot-1'}).encode(frame));
  assert.ok(r.ok);
  const pick=(s:{size?:string;phase?:string;seen?:true;hp:number})=>({size:s.size,phase:s.phase,seen:s.seen,hp:s.hp});
  assert.deepEqual(r.view.structures.filter(s=>s.kind==='ninho').map(pick),frame.structures.filter(s=>s.kind==='ninho').map(pick));
});

test('ninhos room: the sleepers near a player ride the enemies with asleep, never the nests\' hit targets; each client gets its nearest ASLEEP_PER_VIEWER',()=>{
  const sim=room('ninhos'),sleepers=sim.world.sleepers!;
  const n=sim.run.nests!.state.nests[0];
  put(sim,n.x,n.y);
  const frame=sim.frame(),asleep=frame.enemies.filter(e=>e.asleep);
  assert.ok(asleep.length>0,'bodies sleep around a nest');
  for(const e of asleep){
    assert.ok(sleepers.has(e.id)&&!sleepers.isTarget(e.id),e.id);
    assert.ok(!sim.world.enemies.has(e.id),'not an awake one');
  }
  assert.deepEqual(sim.sleeperIds,asleep.map(e=>e.id));
  // Through a client's encoder: the area, capped at the nearest ASLEEP_PER_VIEWER.
  const inArea=asleep.filter(e=>Math.hypot(e.x-n.x,e.y-n.y)<=INTEREST_RADIUS).length;
  const enc=new FrameEncoder(new WireIds(),{viewer:'bot-1'}),r=new FrameDecoder().decode(enc.encode(frame));
  assert.ok(r.ok);
  const got=r.view.enemies.filter(e=>e.asleep===true);
  assert.equal(got.length,Math.min(inArea,ASLEEP_PER_VIEWER));
  const small=new FrameEncoder(new WireIds(),{viewer:'bot-1',interest:{asleep:3}}),r3=new FrameDecoder().decode(small.encode(frame));
  assert.ok(r3.ok);
  const three=r3.view.enemies.filter(e=>e.asleep===true),near=asleep.map(e=>Math.hypot(e.x-n.x,e.y-n.y)).sort((a,b)=>a-b);
  assert.equal(three.length,Math.min(3,inArea));
  for(const e of three)assert.ok(Math.hypot(e.x-n.x,e.y-n.y)<=near[2]+1e-3,'the nearest three');
  // The single-player view caps on its own too.
  assert.ok(sim.view('bot-1').enemies.filter(e=>e.asleep).length<=ASLEEP_PER_VIEWER);
});

test('a rounds room sends no nest and no sleeper',()=>{
  const sim=room(),frame=sim.frame();
  assert.equal(frame.structures.filter(s=>s.kind==='ninho').length,0);
  assert.equal(frame.enemies.filter(e=>e.asleep).length,0);
  assert.deepEqual(sim.sleeperIds,[]);
});

test('the nest strings are dictionary bytes, appended once',()=>{
  const added=['ninho','dormindo','ativo','destruido','P','M','G'],at=DICT.indexOf('ninho');
  assert.deepEqual(DICT.slice(at,at+added.length),added);
  for(const x of added)assert.equal(DICT.indexOf(x),DICT.lastIndexOf(x),`${x} once`);
  assert.ok(DICT.length<255,'255 is the inline escape');
});

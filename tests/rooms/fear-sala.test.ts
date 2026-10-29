// Card NEW-20261023-ORQ-fear-escuridao-sozinho: the fear in a real room (the city, the nests, the manual combat): a
// hero left alone away from the Uno builds the dark on the wire (PlayerRunView.fear 0..1), full at 60 s, and never falls
// to it (card escuridao-justa, user 28/10); next to the Uno nothing builds. The old worlds (automatic combat) have no fear.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {CAR_ID} from '../../src/contract/index.ts';
import {FEAR_BASE_RADIUS,FEAR_TICKS} from '../../src/rules/index.ts';
import {FrameDecoder,FrameEncoder,WireIds} from '../../src/protocol/protocol4.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);

function room(combat?:'manual'){
  const sim=new Simulation(7,{world:'cidade',terrain:loaded.terrain,cityStructures:true,objective:'chaveiro',...(combat?{combat,mode:'ninhos' as const}:{})});
  sim.add('a','Ana','cidadao-comum');
  sim.step();
  return sim;
}
const car=(sim:Simulation)=>sim.run.chaveiro!.targets().find(t=>t.id===CAR_ID)!;
/** Keeps the hero on one spot, untouchable (no enemy takes them: only the dark is under test). */
function hold(sim:Simulation,x:number,y:number){const p=sim.players.get('a')!;p.x=x;p.y=y;p.invulnerableUntil=sim.tick+1e6;}

test('alone away from the Uno: the dark grows on the wire, full at 60 s, and the hero stays on their feet',()=>{
  const sim=room('manual'),c=car(sim),x=c.x+FEAR_BASE_RADIUS+3,y=c.y;
  const downs:unknown[]=[];
  let mid:number|undefined;
  for(let i=0;i<FEAR_TICKS*2;i++){
    hold(sim,x,y);sim.step();
    for(const e of sim.world.lastEvents)if(e.type==='downed'&&e.player==='a')downs.push(e);
    if(i===FEAR_TICKS/2)mid=sim.view('a').players.find(p=>p.id==='a')!.fear;
  }
  assert.ok(mid!==undefined&&Math.abs(mid-.5)<.01,`half the dark at 30 s (${mid})`);
  assert.equal(sim.view('a').players.find(p=>p.id==='a')!.fear,1,'the darkest, held');
  assert.equal(downs.length,0,'the dark does not kill');
  assert.equal(sim.players.get('a')!.downed,undefined);
});

test('next to the Uno nothing builds; the automatic-combat city has no fear',()=>{
  const sim=room('manual'),c=car(sim);
  for(let i=0;i<200;i++){hold(sim,c.x+FEAR_BASE_RADIUS-.5,c.y);sim.step();}
  assert.equal(sim.view('a').players.find(p=>p.id==='a')!.fear,undefined);
  const old=room(),o=car(old);
  for(let i=0;i<200;i++){hold(old,o.x+30,o.y);old.step();}
  assert.equal(old.players.get('a')!.fear,undefined);
});

test('the dark reaches the phone: the room protocol 4 frame carries the fear (not only the JSON view)',()=>{
  const sim=room('manual'),c=car(sim),x=c.x+FEAR_BASE_RADIUS+3,y=c.y;
  for(let i=0;i<FEAR_TICKS/4;i++){hold(sim,x,y);sim.step();}
  const r=new FrameDecoder().decode(new FrameEncoder(new WireIds(),{viewer:'a'}).encode(sim.frame()));
  assert.ok(r.ok);
  const fear=r.view.players.find(p=>p.id==='a')?.fear;
  assert.ok(fear!==undefined&&Math.abs(fear-.25)<.01,`a quarter of the dark on the wire (${fear})`);
});

// D-052, fortification anywhere (sim-fortificação): {t:'build',round,req,piece,c,r,rot?} in a real city Room. The piece
// goes on the wire with its cell (c, r, rot); malformed orders are dropped without an answer; the level-up pause says
// 'pausa'; the old site form still builds the root (on the site's cell).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';
import {buildPlanFor} from '../../src/maps/index.ts';
import {FREE_CELL,onGround} from '../../src/sim/towers/free-build.ts';
import {CAR_ID} from '../../src/contract/index.ts';

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
function lastStructures(frames:readonly Uint8Array[]){
  const feed=new FrameRunFeed();let last:any[]=[];
  for(const f of frames){const r=feed.decode(f) as {ok:boolean;view?:{structures:any[]}};if(r.ok&&r.view)last=r.view.structures;}
  return last;
}
const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY={id:'cidade-nevada',version:manifest.version,hash:manifest.hash} as const;

/** Ana alone in a city room (the chaveiro), in the first wave, with R$ 100 and the camp's material. */
async function cityWave(){
  const t0=Date.now(),room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true}),a=peer();
  room.connect(a,t0);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t0);
  say(room,a,{t:'setMap',map:'cidade-nevada'},t0+OWNER_GAP_MS);await room.ready();
  let t=t0+OWNER_GAP_MS+100;
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(let i=0;i<600&&(room.run.snapshot().phase!=='combat'||room.sim.world.round.phase!=='wave');i++)room.advance(t+=50);
  assert.equal(room.sim.world.round.phase,'wave');
  const ana=[...room.sim.players.values()].find(p=>!room.sim.bots.has(p.id))!;
  ana.invulnerableUntil=Number.MAX_SAFE_INTEGER;ana.grana=100;
  room.sim.run.stonewards.state.balance.units=120;
  // A free cell 5 cells off the car (clear of its body), Ana beside it.
  const car=lastStructures(a.frames).find(x=>x.kind===CAR_ID)??room.sim.run.stonewards.state.wall;
  const cc=Math.floor(car.x/FREE_CELL),cr=Math.floor(car.y/FREE_CELL);
  let cell:{c:number;r:number}|undefined;
  for(let i=-5;!cell&&i<=5;i++)for(const o of [{c:cc+i,r:cr-5},{c:cc+i,r:cr+5},{c:cc-5,r:cr+i},{c:cc+5,r:cr+i}])if(!cell&&onGround(room.sim.terrain as never,o,1,1))cell=o;
  assert.ok(cell);
  ana.x=(cell!.c+.5)*FREE_CELL+1.5;ana.y=(cell!.r+.5)*FREE_CELL;
  return {room,a,ana,cell:cell!,get t(){return t;},tick(n=1){for(let i=0;i<n;i++){if(i%20===0)say(room,a,{t:'ack',seq:0},t);room.advance(t+=50);}}};
}

test('a muro by cell: built in a wave, on the wire as kind muro with its c/r; malformed orders are dropped',async()=>{
  const s=await cityWave(),{room,a,cell}=s,round=room.run.snapshot().round;
  say(room,a,{t:'build',round,req:1,piece:'muro',c:cell.c,r:cell.r},s.t);
  const built=a.messages.findLast(m=>m.t==='built')!;
  assert.match(String(built.defense),/^s\d+$/,'the structure id as the frames carry it');
  assert.deepEqual(built,{t:'built',req:1,ok:true,kind:'muro',defense:built.defense});
  assert.equal(s.ana.grana,96,'R$ 4 from her wallet');
  s.tick(30);
  const muro=lastStructures(a.frames).find(x=>x.kind==='muro');
  assert.ok(muro,'the phone sees the muro');
  assert.equal(muro.id,built.defense,'the id in built is the one in the frames');
  assert.equal(muro.c,cell.c);assert.equal(muro.r,cell.r);assert.equal(muro.rot,undefined);
  assert.ok(Math.abs(muro.x-(cell.c+.5)*FREE_CELL)<.07&&Math.abs(muro.y-(cell.r+.5)*FREE_CELL)<.07);
  assert.equal(muro.hp,250);
  // Malformed: no answer at all.
  const before=a.messages.filter(m=>m.t==='built').length;
  for(const bad of [{piece:'gustavao',c:1,r:1},{piece:'vigias-armados',c:1,r:1},{piece:'muro',c:-1,r:1},{piece:'muro',c:1.5,r:1},
    {piece:'muro',c:1,r:5000},{piece:'muro',c:1,r:1,rot:2},{piece:'muro',c:'1',r:1},{piece:7,c:1,r:1}])say(room,a,{t:'build',round,req:9,...bad},s.t);
  assert.equal(a.messages.filter(m=>m.t==='built').length,before);
  // The same cell again: taken.
  say(room,a,{t:'build',round,req:2,piece:'barricada',c:cell.c,r:cell.r,rot:1},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:2,ok:false,reason:'ocupado'});
});

test('the root by cell and by site (the bots, the HUD of today); the level-up pause refuses every obra (pausa)',async()=>{
  const s=await cityWave(),{room,a,cell}=s,round=room.run.snapshot().round;
  say(room,a,{t:'build',round,req:1,piece:'vigia-do-predio',c:cell.c,r:cell.r},s.t);
  const first=a.messages.findLast(m=>m.t==='built')!;
  assert.deepEqual(first,{t:'built',req:1,ok:true,kind:'vigia-do-predio',defense:first.defense});
  const site=buildPlanFor(room.sim.terrain).sites[1];s.ana.x=site.x;s.ana.y=site.y;
  say(room,a,{t:'build',round,req:2,site:site.id},s.t);
  const second=a.messages.findLast(m=>m.t==='built')!;
  assert.deepEqual(second,{t:'built',req:2,ok:true,kind:'vigia-do-predio',defense:second.defense});
  assert.notEqual(second.defense,first.defense);
  s.tick(30);
  const towers=lastStructures(a.frames).filter(x=>x.kind==='vigia-do-predio');
  assert.equal(towers.length,2);
  assert.ok(towers.some(x=>x.c===cell.c&&x.r===cell.r));
  assert.ok(towers.some(x=>x.c===Math.floor(site.x/FREE_CELL)&&x.r===Math.floor(site.y/FREE_CELL)));
  // D-050: a team level-up in a wave pauses the run; no obra then.
  room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  s.tick();
  assert.equal(room.levelup.paused,true);
  say(room,a,{t:'build',round,req:3,piece:'muro',c:cell.c+1,r:cell.r},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:3,ok:false,reason:'pausa'});
  say(room,a,{t:'build',round,req:4,site:buildPlanFor(room.sim.terrain).sites[2].id},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:4,ok:false,reason:'pausa'});
});

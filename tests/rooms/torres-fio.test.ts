// NEW-20261013-ORQ-torres-fio: the tower defenses on the wire (kind, tier, branch, phase, aim), {t:'build'} and
// {t:'upgrade'} validated by the room and the sim, and the room bots building in a real Room.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'},now);};
/** The last structures a phone decoded from every frame it got. */
function lastStructures(frames:readonly Uint8Array[]){
  const feed=new FrameRunFeed();let last:any[]=[];
  for(const f of frames){const r=feed.decode(f) as {ok:boolean;view?:{structures:any[]}};if(r.ok&&r.view)last=r.view.structures;}
  return last;
}
/** A room in combat with Ana (and `bots` room bots), advanced to the first intermission, with material in the camp. */
function atIntermission(bots=0){
  const room=new Room(Date.now()),a=peer(),t0=Date.now();join(room,a,'Ana',t0);
  for(let i=0;i<bots;i++)say(room,a,{t:'bot-add',round:room.run.snapshot().round},t0+(i+1)*1100);
  let t=t0+bots*1100+1100;
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(let i=0;i<600&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  assert.equal(room.run.snapshot().phase,'combat');
  for(const p of room.sim.players.values())p.invulnerableUntil=Number.MAX_SAFE_INTEGER;
  for(let i=0;i<20_000&&room.sim.world.round.phase!=='prepare';i++){if(i%20===0)say(room,a,{t:'ack',seq:0},t);room.advance(t+=50);}
  assert.equal(room.sim.world.round.phase,'prepare','reached the first intermission');
  room.sim.run.stonewards.state.balance.coco=60;room.sim.run.stonewards.state.balance.pedra=60;
  return {room,a,get t(){return t;},tick:()=>{room.advance(t+=50);if(t%1000===0)say(room,a,{t:'ack',seq:0},t);}};
}

test('a person builds a root on a site and evolves it to branch A; the phone sees kind, tier, branch, phase and hp',()=>{
  const s=atIntermission(),{room,a}=s,round=room.run.snapshot().round;
  say(room,a,{t:'build',round,req:1,site:'obra-01'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:1,ok:true,kind:'vigia-do-predio'});
  // Malformed: dropped without an answer.
  for(const bad of [{site:'obra-1'},{site:'muralha'},{site:7},{req:0,site:'obra-02'}])say(room,a,{t:'build',round,req:2,...bad},s.t);
  assert.equal(a.messages.filter(m=>m.t==='built').length,1);
  // The same request again (a resent tap) applies once.
  say(room,a,{t:'build',round,req:1,site:'obra-01'},s.t);
  assert.equal(a.messages.findLast(m=>m.t==='built').ok,false);
  for(let i=0;i<4;i++)s.tick();
  let mine=lastStructures(a.frames).find(x=>x.kind==='vigia-do-predio');
  assert.ok(mine,'the phone sees the root');
  assert.equal(mine.tier,1);assert.equal(mine.branch,undefined);assert.match(mine.phase,/^obra-[123]$/);assert.ok(mine.maxHp>0);
  // Not ready yet: refused with a reason.
  say(room,a,{t:'upgrade',round,req:3,defense:mine.id,branch:'A'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:3,ok:false,reason:'building'});
  // The obra takes seconds the short first intermission may not have: it finishes now (the sim's timing is tested in sim).
  for(const d of room.sim.defenses())d.readyTick=room.sim.world.tick;
  for(let i=0;i<4;i++)s.tick();
  assert.equal(lastStructures(a.frames).find(x=>x.id===mine.id)?.phase,'pronta');
  say(room,a,{t:'upgrade',round,req:4,defense:mine.id,branch:'A'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:4,ok:true,kind:'vigias-armados'});
  for(let i=0;i<4;i++)s.tick();
  mine=lastStructures(a.frames).find(x=>x.id===mine.id);
  assert.equal(mine.kind,'vigias-armados');assert.equal(mine.tier,2);assert.equal(mine.branch,'A');
  // Bad upgrades: unknown label, bad branch shape (dropped), a wire id that is not a defense (the sim says no).
  say(room,a,{t:'upgrade',round,req:5,defense:'s999',branch:'A'},s.t);say(room,a,{t:'upgrade',round,req:6,defense:mine.id,branch:'Z'},s.t);
  assert.equal(a.messages.findLast(m=>m.t==='built').req,4);
});

test('outside an intermission a build is refused (phase); a spectator or an old round is never heard',()=>{
  const s=atIntermission(),{room,a}=s;
  for(let i=0;i<20_000&&room.sim.world.round.phase==='prepare';i++)s.tick();
  say(room,a,{t:'build',round:room.run.snapshot().round,req:9,site:'obra-03'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:9,ok:false,reason:'phase'});
  say(room,a,{t:'build',round:room.run.snapshot().round-1,req:10,site:'obra-03'},s.t);
  assert.equal(a.messages.findLast(m=>m.t==='built').req,9);
});

test('room bots build in a real room: defenses go up in the intermission and every phone sees them',()=>{
  const s=atIntermission(3),{room,a}=s;
  for(let i=0;i<20_000&&room.bots.built===0;i++)s.tick();
  assert.ok(room.bots.built>0,'a bot built');
  for(let i=0;i<10;i++)s.tick();
  const seen=lastStructures(a.frames).filter(x=>typeof x.tier==='number');
  assert.ok(seen.length>=1,'the phone sees the defense');
  assert.equal(seen.length,room.sim.defenses().length);
});

// ---------- trilho-no-snapshot (NEW-20261013-E4) ----------
test('an upgrade names its branch the way the HUD tree does (label A2, B2…, or the child id) and the room takes it',()=>{
  for(const branch of ['A2','vigias-armados','A']){
    const s=atIntermission(),{room,a}=s,round=room.run.snapshot().round;
    say(room,a,{t:'build',round,req:1,site:'obra-01'},s.t);
    for(const d of room.sim.defenses())d.readyTick=room.sim.world.tick;
    for(let i=0;i<4;i++)s.tick();
    const mine=lastStructures(a.frames).find(x=>x.kind==='vigia-do-predio');
    say(room,a,{t:'upgrade',round,req:2,defense:mine.id,branch},s.t);
    assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:2,ok:true,kind:'vigias-armados'},branch);
  }
  // Shapes no tree has are still dropped without an answer.
  const s=atIntermission(),{room,a}=s;
  for(const branch of ['D','A7','a2','<script>',7])say(room,a,{t:'upgrade',round:room.run.snapshot().round,req:3,defense:'s1',branch},s.t);
  assert.equal(a.messages.filter(m=>m.t==='built').length,0);
});

test('the Gustavão\'s rail is in the snapshot once laid (kind linha-ferrea, its spot and building phase), with a steady wire id',async()=>{
  const {readFileSync}=await import('node:fs');
  const {clientCatalog}=await import('../../src/protocol/map-catalog.ts');
  const {OWNER_GAP_MS}=await import('../../multiplayer/room.ts');
  const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
  const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
  const CITY={id:'cidade-nevada',version:manifest.version,hash:manifest.hash} as const;
  const t0=Date.now(),room=new Room(t0,7,{cityText,cityRef:CITY,cityPlayable:true}),a=peer();
  room.connect(a,t0);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)},t0);
  say(room,a,{t:'setMap',map:'cidade-nevada'},t0+OWNER_GAP_MS);await room.ready();
  let t=t0+OWNER_GAP_MS+100;
  say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(let i=0;i<600&&room.run.snapshot().phase!=='combat';i++)room.advance(t+=50);
  for(let i=0;i<20_000&&room.sim.world.round.phase!=='prepare';i++){if(i%20===0)say(room,a,{t:'ack',seq:0},t);room.advance(t+=50);}
  room.sim.run.stonewards.state.balance.coco=60;room.sim.run.stonewards.state.balance.pedra=60;
  assert.equal(lastStructures(a.frames).some(x=>x.kind==='linha-ferrea'),false,'no rail before it is laid');
  say(room,a,{t:'build',round:room.run.snapshot().round,req:1,site:'trilho'},t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:1,ok:true,kind:'linha-ferrea'});
  for(let i=0;i<4;i++)room.advance(t+=50);
  const rail=lastStructures(a.frames).find(x=>x.kind==='linha-ferrea'),plan=room.sim.run.stonewards.plan.rail!;
  assert.ok(rail,'the phone sees the rail');assert.match(rail.phase,/^obra-[123]$/);
  assert.ok(Math.abs(rail.x-plan.x)<.01&&Math.abs(rail.y-plan.y)<.01,'on the plan\'s rail spot');
  // Laid: pronta; the wire id survives the prunes (once a second).
  room.sim.run.stonewards.state.defenses!.rail!.readyTick=room.sim.world.tick;
  for(let i=0;i<60;i++){if(i%20===0)say(room,a,{t:'ack',seq:0},t);room.advance(t+=50);}
  const later=lastStructures(a.frames).find(x=>x.kind==='linha-ferrea');
  assert.equal(later.phase,'pronta');assert.equal(later.id,rail.id);
});

// NEW-20261013-ORQ-torres-fio: the tower defenses on the wire (kind, tier, branch, phase, aim), {t:'build'} and
// {t:'upgrade'} validated by the room and the sim, and the room bots building in a real Room.
// torres-ajustes: the sim's reach rule ('away' from afar; Ana steps next to the obra first) and {t:'repair'}.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';
import {buildPlanFor} from '../../src/maps/index.ts';

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
  room.sim.run.stonewards.state.balance.units=120;
  const ana=[...room.sim.players.values()].find(p=>!room.sim.bots.has(p.id))!;
  /** Ana steps next to a build site (the sim's reach rule, torres-ajustes); positions are the room's own. */
  const goTo=(siteId:string)=>{const site=buildPlanFor(room.sim.terrain).sites.find(x=>x.id===siteId)!;ana.x=site.x;ana.y=site.y;};
  // Acks every 20 ticks (t starts at Date.now(), so t % 1000 never hit 0: a long wait starved the phone of frames).
  let n=0;
  return {room,a,ana,goTo,get t(){return t;},tick:()=>{room.advance(t+=50);if(++n%20===0)say(room,a,{t:'ack',seq:0},t);}};
}

test('a person builds a root on a site and evolves it to branch A; the phone sees kind, tier, branch, phase and hp',()=>{
  const s=atIntermission(),{room,a}=s,round=room.run.snapshot().round;
  // From afar (wherever the first wave left her): the sim says 'away'; next to the site it builds.
  s.ana.x=s.ana.y=-500;
  say(room,a,{t:'build',round,req:20,site:'obra-01'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:20,ok:false,reason:'away'});
  s.goTo('obra-01');
  say(room,a,{t:'build',round,req:1,site:'obra-01'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:1,ok:true,kind:'vigia-do-predio'});
  // Malformed: dropped without an answer.
  for(const bad of [{site:'obra-1'},{site:'muralha'},{site:7},{req:0,site:'obra-02'}])say(room,a,{t:'build',round,req:2,...bad},s.t);
  assert.equal(a.messages.filter(m=>m.t==='built').length,2,'the far refusal and the build');
  // The same request again (a resent tap) applies once: even on another free site it is a duplicate, not a second root.
  say(room,a,{t:'build',round,req:1,site:'obra-05'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:1,ok:false,reason:'duplicate'});
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
  // torres-ajustes: {t:'repair'} on the same wire label: whole → 'full'; hurt → +25 % of maxHp, paid; malformed dropped.
  say(room,a,{t:'repair',round,req:7,defense:mine.id},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:7,ok:false,reason:'full'});
  const d=room.sim.defenses()[0],st=room.sim.run.stonewards,units=()=>st.state.balance.units;
  st.hit(room.sim.world,d.id,200);
  const hp=d.hp,u0=units();
  say(room,a,{t:'repair',round,req:8,defense:mine.id},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:8,ok:true,kind:'vigias-armados'});
  assert.equal(d.hp,hp+Math.ceil(d.maxHp*.25));assert.equal(u0-units(),5);
  say(room,a,{t:'repair',round,req:8,defense:mine.id},s.t);
  assert.equal(a.messages.findLast(m=>m.t==='built').ok,false,'a resent tap applies once');
  for(const bad of [{defense:7},{defense:'x'.repeat(13)},{req:0,defense:mine.id}])say(room,a,{t:'repair',round,req:9,...bad},s.t);
  assert.equal(a.messages.findLast(m=>m.t==='built').req,8);
  for(let i=0;i<4;i++)s.tick();
  assert.equal(lastStructures(a.frames).find(x=>x.id===mine.id)?.hp,d.hp,'the phone sees the repaired hp (no new field)');
});

test('outside an intermission a build is refused (phase); an old round is never heard',()=>{
  const s=atIntermission(),{room,a}=s;
  for(let i=0;i<20_000&&room.sim.world.round.phase==='prepare';i++)s.tick();
  s.goTo('obra-03');
  say(room,a,{t:'build',round:room.run.snapshot().round,req:9,site:'obra-03'},s.t);
  assert.deepEqual(a.messages.findLast(m=>m.t==='built'),{t:'built',req:9,ok:false,reason:'phase'});
  say(room,a,{t:'build',round:room.run.snapshot().round-1,req:10,site:'obra-03'},s.t);
  assert.equal(a.messages.findLast(m=>m.t==='built').req,9);
});

test('room bots build in a real room: defenses go up in the intermission and every phone sees them',()=>{
  const s=atIntermission(3),{room,a}=s;
  // torres-ajustes + bot-gasta-material: with Ana here a bot orders only in the last 5 s of the intermission.
  const left:number[]=[],w=room.sim.world,sim=room.sim;
  const build=sim.build.bind(sim),upgrade=sim.upgrade.bind(sim),repair=sim.repair.bind(sim);
  const note=(id:string)=>{if(sim.bots.has(id))left.push(w.round.phaseEndsTick-w.tick);};
  sim.build=(id,x,r)=>{note(id);return build(id,x,r);};sim.upgrade=(id,x,b,r)=>{note(id);return upgrade(id,x,b,r);};sim.repair=(id,x,r)=>{note(id);return repair(id,x,r);};
  for(let i=0;i<20_000&&room.bots.built===0;i++)s.tick();
  assert.ok(room.bots.built>0,'a bot built');
  assert.ok(left.length>0&&left.every(t=>t<=5*20),`bot orders with ${left.join(', ')} ticks left: all within the last 5 s`);
  for(let i=0;i<10;i++)s.tick();
  const seen=lastStructures(a.frames).filter(x=>typeof x.tier==='number');
  assert.ok(seen.length>=1,'the phone sees the defense');
  assert.equal(seen.length,room.sim.defenses().length);
});

test('bot-gasta-material + torres-ajustes: the room bots never evolve nor repair the defense Ana built',()=>{
  const s=atIntermission(3),{room}=s,sim=room.sim;
  s.goTo('obra-13');
  const mine=sim.build(s.ana.id,'obra-13');assert.ok(mine.ok);
  const id=(mine as {defense:string}).defense,d=sim.defenses().find(x=>x.id===id)!;
  d.readyTick=sim.world.tick;sim.run.stonewards.hit(sim.world,id,d.maxHp*.7);
  const touched:string[]=[];
  const upgrade=sim.upgrade.bind(sim),repair=sim.repair.bind(sim);
  sim.upgrade=(who,x,b,r)=>{if(x===id)touched.push(`${who} up`);return upgrade(who,x,b,r);};
  sim.repair=(who,x,r)=>{if(x===id)touched.push(`${who} repair`);return repair(who,x,r);};
  sim.run.stonewards.state.balance.units=400;
  // Through the next three intermissions (Ana stays out of the way, invulnerable).
  for(let i=0,n=0;i<60_000&&n<3;i++){const was=sim.world.round.phase;s.tick();if(was==='prepare'&&sim.world.round.phase==='wave')n++;}
  assert.deepEqual(touched,[],'no bot order on the defense Ana built');
  assert.equal(d.kind,'vigia-do-predio');assert.equal(d.owner,s.ana.id);
});

// ---------- trilho-no-snapshot (NEW-20261013-E4) ----------
test('an upgrade names its branch the way the HUD tree does (label A2, B2…, or the child id) and the room takes it',()=>{
  for(const branch of ['A2','vigias-armados','A']){
    const s=atIntermission(),{room,a}=s,round=room.run.snapshot().round;
    s.goTo('obra-01');
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
  room.sim.run.stonewards.state.balance.units=120;
  assert.equal(lastStructures(a.frames).some(x=>x.kind==='linha-ferrea'),false,'no rail before it is laid');
  // Ana steps next to the rail first (the sim's reach rule, torres-ajustes).
  const ana=[...room.sim.players.values()].find(p=>!room.sim.bots.has(p.id))!,spot=room.sim.run.stonewards.plan.rail!;ana.x=spot.x;ana.y=spot.y;
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

test('torres-fio review: a spectator is answered no (player); a ruin goes on the wire (hp 0, ruina) and a new root on its site is a new id',()=>{
  const s=atIntermission(),{room,a}=s,round=room.run.snapshot().round;
  // Bia arrives mid-run: she watches (spectator).
  const b=peer();join(room,b,'Bia',s.t);
  say(room,b,{t:'build',round,req:1,site:'obra-02'},s.t);
  assert.deepEqual(b.messages.findLast(m=>m.t==='built'),{t:'built',req:1,ok:false,reason:'player'});
  s.goTo('obra-01');
  say(room,a,{t:'build',round,req:1,site:'obra-01'},s.t);
  for(let i=0;i<4;i++)s.tick();
  const first=lastStructures(a.frames).find(x=>x.kind==='vigia-do-predio');
  const d=room.sim.defenses()[0];d.hp=0;d.ruined=true;
  for(let i=0;i<4;i++)s.tick();
  const ruin=lastStructures(a.frames).find(x=>x.id===first.id);
  assert.equal(ruin.phase,'ruina');assert.equal(ruin.hp,0);
  say(room,a,{t:'build',round,req:2,site:'obra-01'},s.t);
  assert.equal(a.messages.findLast(m=>m.t==='built').ok,true);
  for(let i=0;i<4;i++)s.tick();
  const now=lastStructures(a.frames).filter(x=>x.kind==='vigia-do-predio');
  assert.equal(now.length,1,'the ruin is gone');assert.notEqual(now[0].id,first.id,'a new defense, a new id');assert.notEqual(now[0].phase,'ruina');
});

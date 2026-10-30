// NEW-20261014-ORQ-levelup-pausa-time (D-050): a team level-up in a wave pauses the run for the picks. The room does not
// step the sim while paused (every deadline is an absolute tick, so nothing moves), sends RunState.pause in {t:'run'},
// waits for the humans online, gives bots their defaults after a reaction, never waits for (nor settles) an offline
// player, ends at the deadline with the defaults, and keeps PAUSE_GAP_TICKS of combat between two pauses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {BOT_PICK_MS,PAUSE_GAP_TICKS,PAUSE_MAX_MS,PAUSE_RUN_FIRST_MS,pauseMs} from '../../multiplayer/levelup-pause.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';

function peer(){
  const messages:any[]=[];
  return {messages,gone:false,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number)=>{if(!peers.has(room))peers.set(room,[]);peers.get(room)!.push(p);room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'},now);};
const welcome=(p:TestPeer)=>p.messages.find(m=>m.t==='welcome');
const lastRun=(p:TestPeer)=>p.messages.findLast(m=>m.t==='run')?.run;
function combat(room:Room,peers:TestPeer[],from=1100){
  let t=from;for(const p of peers)say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat'||room.sim.world.round.phase!=='wave';t+=50)step(room,t);
  return t;
}
/** Two people in a wave, a level-up granted: the next tick opens the pause. */
function paused(levels=1){
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  for(let l=0;l<levels;l++)room.sim.run.progression.grantLevelOffers(room.sim.world,2+l);
  step(room,t+=50);
  return {room,a,b,t,ida:welcome(a).id,idb:welcome(b).id};
}
/** A room tick with every peer pinging (a real client pings and acks; a silent one is closed after SILENT_MS). */
const peers=new WeakMap<Room,TestPeer[]>();
function step(room:Room,now:number){for(const p of peers.get(room)??[])if(!p.gone)say(room,p,{t:'ping',at:now},now);room.advance(now);}
const pick=(room:Room,p:TestPeer,id:string,now:number)=>{const o=room.sim.offers(id)[0];say(room,p,{t:'choose',round:room.run.snapshot().round,offer:o.id,index:0},now);};

test('a level-up in a wave pauses the run: the sim stands still, RunState.pause says who is waiting and for how long',()=>{
  let {room,a,t,ida,idb}=paused();
  assert.equal(room.levelup.paused,true);
  const tick=room.sim.tick,enemies=JSON.stringify([...room.sim.world.enemies.values()].map(e=>[e.x,e.y,e.hp]));
  for(let i=0;i<40;i++)step(room,t+=50);
  assert.equal(room.sim.tick,tick,'2 s later the tick has not moved');
  assert.equal(JSON.stringify([...room.sim.world.enemies.values()].map(e=>[e.x,e.y,e.hp])),enemies,'nothing moved');
  const run=lastRun(a);
  assert.deepEqual({...run.pause,leftMs:undefined},{leftMs:undefined,totalMs:pauseMs(1,true),level:room.sim.world.team.level,waiting:[ida,idb].sort(),
    // D-052: each player's "Pular" and "Rolar de novo" left (2 each at the start of a run).
    skips:{[ida]:2,[idb]:2},rerolls:{[ida]:2,[idb]:2}});
  assert.ok(run.pause.leftMs<=pauseMs(1,true)-1500&&run.pause.leftMs>pauseMs(1,true)-3500,`left ${run.pause.leftMs}`);
});

test('the pause ends when everybody picked; then PAUSE_GAP_TICKS of combat before another opens',()=>{
  let {room,a,b,t,ida,idb}=paused();
  pick(room,a,ida,t);step(room,t+=50);
  assert.deepEqual(lastRun(a).pause.waiting,[idb],'Ana picked: only Bia left');
  pick(room,b,idb,t);step(room,t+=50);
  assert.equal(room.levelup.paused,false);assert.equal(lastRun(a).pause,undefined,'the run message drops the pause');
  const tick=room.sim.tick;step(room,t+=50);assert.equal(room.sim.tick,tick+1,'the sim steps again');
  // Another level right away waits for the gap.
  room.sim.run.progression.grantLevelOffers(room.sim.world,3);
  for(let i=0;i<PAUSE_GAP_TICKS-5&&room.sim.world.round.phase==='wave';i++){step(room,t+=50);assert.equal(room.levelup.paused,false,`tick ${i}: inside the gap`);}
  assert.equal(room.sim.world.round.phase,'wave','the wave outlasts the gap (else this test checks nothing)');
  for(let i=0;i<10;i++)step(room,t+=50);assert.equal(room.levelup.paused,true,'after the gap the held level opens a pause');
});

test('the deadline: nobody picks, everyone online gets the default and the run goes on; several levels give a longer pause',()=>{
  let {room,a,t,ida,idb}=paused();
  for(let i=0;i<pauseMs(1,true)/50+2;i++)step(room,t+=50);
  assert.equal(room.levelup.paused,false);
  assert.equal(room.sim.offers(ida).length,0);assert.equal(room.sim.offers(idb).length,0);
  assert.ok(lastRun(a).pause===undefined);
  const three=paused(3);
  assert.equal(lastRun(three.a).pause.totalMs,Math.min(PAUSE_MAX_MS,pauseMs(3)));assert.equal(pauseMs(3),20_000);assert.equal(pauseMs(9),PAUSE_MAX_MS);
});

test('an offline player is not waited for and keeps its offer held; a room bot picks after its reaction',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  const ida=welcome(a).id,idb=welcome(b).id;
  b.gone=true;room.disconnect(b,t);
  assert.equal(room.sim.players.get(idb)!.online,false);
  room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  step(room,t+=50);
  assert.deepEqual(lastRun(a).pause.waiting,[ida],'only Ana, online');
  pick(room,a,ida,t);step(room,t+=50);
  assert.equal(room.levelup.paused,false,'Bia offline does not hold the team');
  assert.equal(room.sim.offers(idb).length,1,'and keeps her card for when she is back');
  // Bots only: the pause shows for the bots' reaction, then ends with their defaults.
  const solo=new Room(1000),c=peer();join(solo,c,'Caio',1000);
  let u=1100;say(solo,c,{t:'bot-add',round:solo.run.snapshot().round},u);u=combat(solo,[c],u+600);
  const idc=welcome(c).id,bot=[...solo.sim.bots][0];
  assert.ok(bot,'a room bot sits');
  solo.sim.run.progression.grantLevelOffers(solo.sim.world,2);
  pick(solo,c,idc,u);
  step(solo,u+=50);
  assert.equal(solo.levelup.paused,true,'Caio picked, the bot still reacting');
  for(let i=0;i<BOT_PICK_MS/50+2;i++)step(solo,u+=50);
  assert.equal(solo.levelup.paused,false);assert.equal(solo.sim.offers(bot).length,0,'the bot took its default');
});

test('the intermission keeps D-021: offers there do not pause (the game is not running)',()=>{
  const room=new Room(1000),a=peer();join(room,a,'Ana',1000);
  let t=combat(room,[a]);
  for(;room.sim.world.round.phase!=='prepare'&&room.run.snapshot().phase==='combat';t+=50){
    // keep picking whatever comes so no pause stays open in the wave
    const o=room.sim.offers(welcome(a).id)[0];if(o)pick(room,a,welcome(a).id,t);
    step(room,t);
  }
  assert.equal(room.sim.world.round.phase,'prepare','the first wave ends in an intermission');
  room.sim.run.progression.grantLevelOffers(room.sim.world,room.sim.world.team.level+1);
  step(room,t+=50);
  assert.equal(room.levelup.paused,false);
});

test('reconnecting mid-pause: the welcome already carries the pause (the phone stands at once)',()=>{
  let {room,b,t}=paused();
  const token=welcome(b).token;
  b.gone=true;room.disconnect(b,t);
  const back=peer();peers.get(room)!.push(back);room.connect(back,t+=50);say(room,back,{t:'join',protocol:ROOM_PROTOCOL,token},t);
  assert.equal(room.levelup.paused,true);
  const w=welcome(back);
  assert.ok(w.run.pause,'welcome.run.pause');assert.equal(w.run.pause.totalMs,pauseMs(1,true));
});

test('someone eliminated with a card never holds the pause; their offer is dropped',()=>{
  let {room,a,t,ida,idb}=paused();
  room.sim.players.get(idb)!.eliminated=true;
  pick(room,a,ida,t);step(room,t+=50);
  assert.equal(room.levelup.paused,false,'only Ana could pick, and she did');
  assert.equal(room.sim.offers(idb).length,0,'the eliminated player holds nothing');
});

test('carteira-e-pix: no PIX in the pause (\'pause\'); after it the room checks the round, the gap and a resent req',()=>{
  let {room,a,b,t,ida,idb}=paused();
  room.sim.players.get(ida)!.grana=30;
  const round=room.run.snapshot().round,pixed=(req:number)=>a.messages.findLast(m=>m.t==='pixed'&&m.req===req);
  say(room,a,{t:'pix',round,req:1,to:idb,amount:10},t);
  assert.deepEqual(pixed(1),{t:'pixed',req:1,ok:false,reason:'pause'});
  assert.equal(room.sim.granaOf(ida),30,'nothing moved in the pause');
  pick(room,a,ida,t);pick(room,b,idb,t);step(room,t+=50);
  assert.equal(room.levelup.paused,false);
  say(room,a,{t:'pix',round:round+1,req:2,to:idb,amount:10},t);
  assert.equal(pixed(2).reason,'phase','another round');
  say(room,a,{t:'pix',round,req:3,to:idb,amount:10},t);
  assert.deepEqual(pixed(3),{t:'pixed',req:3,ok:true,to:idb,amount:10,grana:20});
  assert.equal(room.sim.granaOf(idb),10);
  say(room,a,{t:'pix',round,req:4,to:idb,amount:5},t+100);
  assert.equal(pixed(4).reason,'rate','sooner than PIX_GAP_MS after the last one');
  say(room,a,{t:'pix',round,req:3,to:idb,amount:10},t+100);
  assert.equal(a.messages.filter(m=>m.t==='pixed'&&m.req===3).at(-1).reason,'duplicate','the same req again moves nothing');
  assert.equal(room.sim.granaOf(ida),20);
});

test('primeira-melhoria-sem-pressa: the run\'s first pause gives PAUSE_RUN_FIRST_MS, the next ones today\'s deadline; a new run starts over',()=>{
  assert.equal(pauseMs(1,true),PAUSE_RUN_FIRST_MS);assert.equal(PAUSE_RUN_FIRST_MS,15_000);
  assert.equal(pauseMs(1),12_000,'from the second pause on, as before');
  assert.equal(pauseMs(3,true),pauseMs(3),'several levels already get more than the first pause\'s floor');
  let {room,a,b,t,ida,idb}=paused();
  assert.equal(lastRun(a).pause.totalMs,PAUSE_RUN_FIRST_MS);
  pick(room,a,ida,t);pick(room,b,idb,t);step(room,t+=50);
  assert.equal(room.levelup.paused,false);
  room.sim.run.progression.grantLevelOffers(room.sim.world,3);
  for(let i=0;i<PAUSE_GAP_TICKS+5&&!room.levelup.paused;i++)step(room,t+=50);
  assert.equal(room.levelup.paused,true,'the second pause opened');
  assert.equal(lastRun(a).pause.totalMs,pauseMs(1));
  pick(room,a,ida,t);pick(room,b,idb,t);step(room,t+=50);
  room.levelup.reset();
  room.sim.run.progression.grantLevelOffers(room.sim.world,4);
  step(room,t+=50);
  assert.equal(lastRun(a).pause.totalMs,PAUSE_RUN_FIRST_MS,'a new run (reset): first pause again');
});

// NEW-20261011-ORQ-dono-sala-bots (D-025): the room's owner, kick with a 10-minute ban, and the room's own bots.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer,type RoomRoster} from '../multiplayer/room.ts';
import {ROOM_PROTOCOL,GRACE_MS,KICK_BAN_MS,OWNER_ONLY,OWNER_NOT_NOW,ROOM_FULL_BOTS,kickedMessage,Simulation} from '../src/game/net/shared.ts';
import {RunLifecycle} from '../src/game/net/run.ts';
import {RoomBots,botIdentity,BOT_NAMES,BOT_THINK_EVERY} from '../src/game/sim/room-bots.ts';
import {downPlayer} from '../src/game/sim/revive.ts';
import {classes} from '../src/classes.ts';
import {NICK_MAX} from '../src/game/lobby.ts';
import {waitingRoomView,confirmText,OWNER_HINT} from '../src/game/lobby.ts';
import {computeAwards} from '../src/game/hud/awards.ts';
import {emptyTally} from '../src/game/hud/model.ts';
import {manageLabel} from '../src/game/hud/result.ts';
import {FrameRunFeed} from '../src/game/net/run-feed.ts';
import type {RunState} from '../src/game/net/run.ts';
import type {PlayerRunView} from '../src/game/sim/view.ts';

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[],closes:{code:number;reason:string}[]=[];
  return {messages,frames,closes,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:(code:number,reason:string)=>{closes.push({code,reason});}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number,extra:object={})=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum',...extra},now);};
const welcome=(p:TestPeer)=>p.messages.findLast(m=>m.t==='welcome');
const round=(room:Room)=>room.run.snapshot().round;
const owner=(room:Room)=>room.run.snapshot().owner;
const bots=(room:Room)=>room.run.snapshot().members.filter(m=>m.bot).map(m=>m.id);
const addBot=(room:Room,p:TestPeer,now:number)=>say(room,p,{t:'bot-add',round:round(room)},now);
const notices=(p:TestPeer)=>p.messages.filter(m=>m.t==='notice').map(m=>m.message);
function combat(room:Room,peers:TestPeer[],from=1100){
  let t=from;for(const p of peers)say(room,p,{t:'ready',round:round(room),ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  return t;
}

test('the owner is whoever sat first; it travels in the run state to everyone',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  assert.equal(owner(room),welcome(a).id);
  assert.equal(b.messages.findLast(m=>m.t==='run').run.owner,welcome(a).id);
});

test('only the owner kicks and adds bots; the others hear why and nothing changes',()=>{
  const room=new Room(1000),a=peer(),b=peer(),c=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);join(room,c,'Caio',1000);
  say(room,b,{t:'kick',round:round(room),id:welcome(c).id},1100);
  addBot(room,b,1100);say(room,b,{t:'bot-remove',round:round(room)},1100);
  assert.equal(room.sim.players.size,3);assert.deepEqual(bots(room),[]);assert.deepEqual(c.closes,[]);
  assert.deepEqual(notices(b),[OWNER_ONLY,OWNER_ONLY,OWNER_ONLY]);
  // A stale command (last run's round) is dropped quietly, even from the owner.
  say(room,a,{t:'bot-add',round:round(room)+1},1100);assert.deepEqual(bots(room),[]);
  // The owner cannot kick itself.
  say(room,a,{t:'kick',round:round(room),id:welcome(a).id},1100);assert.equal(room.sim.players.size,3);
});

test('never in combat: kick and bots only in the lobby, the countdown and the result',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  let t=combat(room,[a,b]);
  say(room,a,{t:'kick',round:round(room),id:welcome(b).id},t);addBot(room,a,t);
  assert.equal(room.sim.players.size,2);assert.deepEqual(b.closes,[]);
  assert.deepEqual(notices(a),[OWNER_NOT_NOW,OWNER_NOT_NOW]);
  // At the result the owner may again.
  room.run.finish('defeat');room.advance(t+=50);assert.equal(room.run.snapshot().phase,'result');
  addBot(room,a,t);assert.equal(bots(room).length,1);
  say(room,a,{t:'bot-remove',round:round(room)},t);assert.deepEqual(bots(room),[]);
  // In the countdown too: a bot added then plays the coming run (ready, not a spectator).
  say(room,a,{t:'rematch',round:round(room)},t);say(room,b,{t:'rematch',round:round(room)},t);
  for(const p of [a,b])say(room,p,{t:'ready',round:round(room),ready:true},t);
  assert.equal(room.run.snapshot().phase,'countdown');
  addBot(room,a,t);
  const bot=room.run.snapshot().members.find(m=>m.bot)!;
  assert.equal(room.run.snapshot().phase,'countdown');assert.equal(bot.ready,true);assert.equal(bot.spectator,false);
});

test('the kicked one is told clearly, cannot come back for 10 minutes (token or fresh join with it), then can',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  const bia=welcome(b);
  say(room,a,{t:'kick',round:round(room),id:bia.id},2000);
  const kicked=b.messages.at(-1);
  assert.equal(kicked.t,'kicked');assert.equal(kicked.until,2000+KICK_BAN_MS);assert.equal(kicked.message,kickedMessage(2000+KICK_BAN_MS,2000));
  assert.match(kicked.message,/chefe da sala te tirou.*10 min/);
  assert.equal(b.closes[0].code,4003);assert.equal(room.sim.players.size,1);assert.equal(room.run.snapshot().members.length,1);
  // Back with the seat's token, or as a new player presenting it (what the page does), 9 minutes later: refused.
  const t9=2000+9*60_000;
  const again=peer();join(room,again,'Bia',t9,{token:bia.token});
  assert.equal(again.messages[0].t,'kicked');assert.match(again.messages[0].message,/1 min/);assert.equal(again.closes[0].code,4003);
  const fresh=peer();join(room,fresh,'Bia 2',t9,{kicked:bia.token});
  assert.equal(fresh.messages[0].t,'kicked');assert.equal(room.sim.players.size,1);
  // Ten minutes on: a new seat (the old one is gone for good).
  const later=peer();join(room,later,'Bia',2000+KICK_BAN_MS+1,{kicked:bia.token});
  assert.equal(welcome(later).t,'welcome');assert.notEqual(welcome(later).id,bia.id);assert.equal(room.sim.players.size,2);
});

test('the owner post moves to the oldest person when the owner leaves for good, never on a short drop',()=>{
  const room=new Room(1000),a=peer(),b=peer(),c=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1100);join(room,c,'Caio',1200);
  addBot(room,a,1300);
  // A short drop: still the owner, and it keeps the commands once back.
  room.disconnect(a,1400);room.advance(1450);assert.equal(owner(room),welcome(a).id);
  const back=peer();join(room,back,'Ana',1500,{token:welcome(a).token});assert.equal(owner(room),welcome(a).id);
  // Gone for good (left): Bia, the oldest person (bots never own).
  say(room,back,{t:'leave'},1600);assert.equal(owner(room),welcome(b).id);
  // The new owner can kick at once; seat expiry also passes the post.
  room.disconnect(b,1700);
  let t=1700;for(const end=1700+GRACE_MS+2000;t<end;t+=1000){say(room,c,{t:"ack",seq:0},t);room.advance(t);}
  assert.equal(owner(room),welcome(c).id);
  addBot(room,c,t);assert.equal(bots(room).length,2);
  // The last person leaving takes the bots with them: a room of bots alone plays for no one.
  say(room,c,{t:'leave'},t);assert.equal(room.sim.players.size,0);assert.equal(owner(room),undefined);
});

test('six with bots: the seventh person and a seventh bot are refused',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a,'Ana',1000);join(room,b,'Bia',1000);
  for(let i=0;i<4;i++)addBot(room,a,1100);
  assert.equal(room.sim.players.size,6);assert.equal(bots(room).length,4);
  addBot(room,a,1100);assert.equal(bots(room).length,4);assert.equal(notices(a).at(-1),ROOM_FULL_BOTS);
  const seventh=peer();join(room,seventh,'Caio',1200);
  assert.equal(seventh.closes[0].code,4003);assert.match(seventh.messages[0].message,/Sala cheia/);
  // A bot out makes room for a person.
  say(room,a,{t:'bot-remove',round:round(room),id:bots(room)[0]},1300);
  const in6=peer();join(room,in6,'Caio',1300);assert.equal(welcome(in6).t,'welcome');assert.equal(room.sim.players.size,6);
});

test('bots: funny names that fit, a class of the 36, marked as bot, ready, never holding the start alone',()=>{
  for(const name of BOT_NAMES){assert.ok(name.length<=NICK_MAX,name);assert.doesNotMatch(name,/\p{Extended_Pictographic}/u);}
  const ids=classes.map(c=>c.id),picked=new Set<string>();
  for(let n=0;n<40;n++){const b=botIdentity(1234,n,ids,new Set());assert.ok(ids.includes(b.classId));picked.add(b.classId);}
  assert.ok(picked.size>8,'classes spread');
  assert.deepEqual(botIdentity(77,2,ids,new Set()),botIdentity(77,2,ids,new Set()),'same seed, same bot');
  const first=botIdentity(77,0,ids,new Set());assert.notEqual(botIdentity(77,0,ids,new Set([first.name])).name,first.name,'no repeated name');
  const room=new Room(1000,555),a=peer();join(room,a,'Ana',1000);
  for(let i=0;i<5;i++)addBot(room,a,1000);
  const names=[...room.sim.players.values()].map(p=>p.name);
  assert.equal(new Set(names).size,6,'six different names');
  const members=room.run.snapshot().members;
  assert.deepEqual(members.map(m=>!!m.bot),[false,true,true,true,true,true]);
  assert.ok(members.filter(m=>m.bot).every(m=>m.ready&&m.online));
  // Bots are ready, the person is not: no countdown until the person says so.
  for(let t=1000;t<2000;t+=50)room.advance(t);
  assert.equal(room.run.snapshot().phase,'lobby');
  // A lifecycle with bots only never starts.
  const run=new RunLifecycle('x');run.join('b',{bot:true});run.step();assert.equal(run.snapshot().phase,'lobby');
});

test('bots send no message: the room receives only what the people send (free plan requests)',()=>{
  const room=new Room(1000),a=peer();join(room,a,'Ana',1000);
  for(let i=0;i<5;i++)addBot(room,a,1000);
  let t=combat(room,[a]);
  for(const end=t+20_000;t<end;t+=50){room.advance(t);if(t%5000===0)say(room,a,{t:'ack',seq:0},t);}
  const received=[...room.connections.values()].reduce((sum,c)=>sum+c.received,0);
  assert.equal(room.connections.size,1);assert.ok(received<=12,`only Ana's join, add-bots and ready: ${received}`);
  assert.ok(room.bots.thinks>0);
});

test('bots play: they walk, rescue a fallen friend nearby and gather in the intermission (deterministic by seed)',()=>{
  const play=()=>{
    const room=new Room(1000,4242,{durationTicks:20*60*20}),a=peer();join(room,a,'Ana',1000);
    for(let i=0;i<5;i++)addBot(room,a,1000);
    let t=combat(room,[a]);
    const ana=room.sim.players.get(welcome(a).id)!,start=new Map([...room.sim.players.values()].map(p=>[p.id,{x:p.x,y:p.y}]));
    // Ana stands still (no input at all) and falls right away: the bots come for her.
    let revivedBy:string|undefined;
    downPlayer(room.sim.world,ana);
    for(let i=0;i<20*30&&!revivedBy;i++){room.advance(t+=50);revivedBy=room.sim.world.lastEvents.find(e=>e.type==='revived'&&e.player===ana.id)?.by;}
    // Into the first intermission: what each bot gathered.
    for(let i=0;i<20*120&&!(room.sim.world.round.index>=2&&room.sim.world.round.phase==='prepare');i++){room.advance(t+=50);if(i%20===0)say(room,a,{t:'ack',seq:0},t);}
    for(let i=0;i<20*12;i++){room.advance(t+=50);if(i%20===0)say(room,a,{t:'ack',seq:0},t);}
    const gathered=room.sim.run.stonewards.state.gathered;
    const moved=[...room.sim.players.values()].filter(p=>room.sim.bots.has(p.id)&&Math.hypot(p.x-start.get(p.id)!.x,p.y-start.get(p.id)!.y)>1).length;
    return {revivedBy,gathered:{...gathered},hash:room.sim.stateHash(),moved,bots:room.bots.ids};
  };
  const one=play();
  assert.ok(one.revivedBy&&one.bots.includes(one.revivedBy),`a bot rescued Ana (${one.revivedBy})`);
  assert.equal(one.moved,5,'every bot walked');
  const byBots=Object.entries(one.gathered).filter(([id,v])=>one.bots.includes(id)&&v>0);
  assert.ok(byBots.length>=3,`bots gathered: ${JSON.stringify(one.gathered)}`);
});

test('room bots are deterministic: same seed, same seats, same run',()=>{
  const play=()=>{
    const sim=new Simulation(4242,{world:'infinito'}),rb=new RoomBots();
    sim.add('ana','Ana','cidadao-comum');
    for(let i=0;i<5;i++){const id=`bot-${i+1}`;sim.addBot(id,BOT_NAMES[i],classes[i*7].id);rb.add(id,i);}
    sim.resetRun();
    for(let i=0;i<20*90;i++){rb.think(sim);sim.step(i*50);}
    return {hash:sim.stateHash(),at:[...sim.players.values()].map(p=>[p.x,p.y])};
  };
  const one=play(),two=play();
  assert.equal(one.hash,two.hash);assert.deepEqual(one.at,two.at);
});

test('restart keeps the owner, the bots and the kicked seats',()=>{
  const writes:RoomRoster[]=[];
  const room=new Room(1000,99,{onRoster:r=>writes.push(structuredClone(r))}),a=peer(),b=peer(),c=peer();
  join(room,a,'Ana',1000);join(room,b,'Bia',1000);join(room,c,'Caio',1000);
  addBot(room,a,1100);addBot(room,a,1100);say(room,a,{t:'kick',round:round(room),id:welcome(c).id},1200);
  say(room,a,{t:'pref',shame:true},1200);
  const roster=writes.at(-1)!;
  assert.equal(roster.owner,welcome(a).id);assert.equal(roster.bots?.length,2);assert.equal(roster.bans?.length,1);assert.equal(roster.botsAdded,2);
  const restarted=new Room(1000,99);restarted.restore(roster,1300);
  assert.equal(owner(restarted),welcome(a).id);assert.deepEqual(bots(restarted),roster.bots!.map(b=>b.id));
  assert.equal(restarted.sim.players.size,4);
  const back=peer();join(restarted,back,'Caio',1400,{kicked:welcome(c).token});assert.equal(back.messages[0].t,'kicked');
  // The next bot gets a fresh id and name.
  const ana=peer();join(restarted,ana,'Ana',1400,{token:welcome(a).token});addBot(restarted,ana,1400);
  assert.equal(new Set(bots(restarted)).size,3);
  // Junk in the new fields is ignored.
  const junk=new Room(1000,99);junk.restore({...roster,owner:'nobody',bots:[{id:'x y',name:'a',classId:'nope',slot:0} as any],bans:[{hash:'zz',until:1e15}]},1300);
  assert.equal(owner(junk),roster.players[0].id);assert.deepEqual(bots(junk),[]);
});

test('RoomBots thinks on staggered ticks and stays out of the shame moment',()=>{
  const sim=new Simulation(7);sim.add('p','Ana','cidadao-comum');sim.addBot('bot-1','Robô do Gás','mendigo');sim.resetRun();
  assert.ok(sim.shameOptOut.has('bot-1'));
  const rb=new RoomBots();rb.add('bot-1',0);
  let thought=0;for(let i=0;i<BOT_THINK_EVERY*5;i++){const before=rb.thinks;rb.think(sim);thought+=rb.thinks-before;sim.step();}
  assert.equal(thought,5);
});

// ---------- Client side (pure parts) ----------

test('waiting room: the owner manages, people first then bots, the crown and robot are data, seats left',()=>{
  const run:RunState={round:1,phase:'lobby',elapsed:0,remaining:0,owner:'me',members:[
    {id:'b1',online:true,ready:true,spectator:false,bot:true},{id:'me',online:true,ready:false,spectator:false},{id:'zé',online:true,ready:false,spectator:false}]};
  const names=new Map([['b1',{name:'Bot Pamonha'}],['me',{name:'Eu'}],['zé',{name:'Zé'}]]);
  const owner=waitingRoomView(run,names,'me');
  assert.equal(owner.canManage,true);assert.equal(owner.seatsLeft,3);
  assert.deepEqual(owner.members.map(m=>[m.id,m.bot,m.owner]),[['me',false,true],['zé',false,false],['b1',true,false]]);
  assert.match(owner.headline,/^Faltam/,'the bot is ready; Zé and I are not');
  const guest=waitingRoomView(run,names,'zé');
  assert.equal(guest.canManage,false);assert.ok(guest.members.find(m=>m.id==='me')!.owner);
  // Countdown: still allowed; combat and result: the waiting room is hidden (the result has its own buttons).
  assert.equal(waitingRoomView({...run,phase:'countdown',remaining:40},names,'me').canManage,true);
  assert.equal(waitingRoomView({...run,phase:'combat'},names,'me').canManage,false);
  assert.equal(confirmText({name:'Zé',bot:false}),'Expulsar Zé?');assert.equal(confirmText({name:'Bot Pamonha',bot:true}),'Tirar Bot Pamonha?');
  assert.equal(manageLabel({name:'Zé'},false),'Expulsar');assert.equal(manageLabel({name:'Bot Fujão',bot:true},true),'Tirar Bot Fujão?');
  assert.ok(OWNER_HINT.length<60);
});

test('people-only prizes never go to a bot; plain counts still can',()=>{
  const p=(id:string,bot:boolean,stats:Partial<PlayerRunView['stats']>&object,weapons=5):PlayerRunView=>({id,name:id,classId:'cidadao-comum',hp:10,maxHp:10,online:true,spectator:false,
    weapons:Array.from({length:weapons},(_,i)=>({id:`w${i}`,level:1})),passives:[],stats:{damage:0,kills:0,revives:0,pickups:0,downs:0,heals:0,chests:0,magnets:0,evolves:0,...stats},...(bot?{bot:true}:{})});
  const result={victory:true,durationTicks:100,round:10,totalRounds:10,seed:'1',
    players:[p('ana',false,{damage:10,kills:1},1),p('bot-1',true,{damage:5000,kills:300,revives:4},6),p('bot-2',true,{damage:4000,kills:200},6)]};
  const awards=computeAwards(result,emptyTally());
  const of=(id:string)=>awards.filter(a=>a.playerId===id).map(a=>a.id);
  for(const id of ['bot-1','bot-2'])for(const person of ['build-sem-sentido','turista','marombeiro','evolucao'])assert.ok(!of(id).includes(person),`${id} took ${person}`);
  assert.ok(of('bot-1').includes('rei-do-resgate')||of('bot-1').includes('carregou'),'a bot still wins a count');
  assert.ok(of('ana').includes('turista')||of('ana').length>0);
});

test('the feed marks the room bots on the players it hands out',()=>{
  const feed=new FrameRunFeed();
  assert.deepEqual(feed.peek().players,[]);
  feed.setBots(['bot-1']);
  (feed as any).last={tick:1,team:{xp:0,level:1,nextXp:1},enemies:[],pickups:[],projectiles:[],telegraphs:[],structures:[],nodes:[],
    players:[{id:'ana',name:'Ana'},{id:'bot-1',name:'Bot'}]};
  assert.deepEqual(feed.peek().players.map(p=>[p.id,!!p.bot]),[['ana',false],['bot-1',true]]);
});

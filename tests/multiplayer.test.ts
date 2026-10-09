import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,STEP,reconcile,simulate,delta,type Input} from '../src/game/net/shared.ts';
import {Room,type Peer} from '../multiplayer/room.ts';
import {walkable,SPEED} from '../src/game/world.ts';
import {createEnemy} from '../src/game/sim/enemies/catalog.ts';

function peer(){const messages:any[]=[],closes:any[]=[];return {messages,closes,send:(s:string)=>messages.push(JSON.parse(s)),close:(code:number,reason:string)=>closes.push({code,reason})};}
const join=(r:Room,p:Peer,n='Amigo',now=1000)=>{r.connect(p,now);r.receive(p,JSON.stringify({t:'join',protocol:3,name:n,classId:'cidadao-comum'}),now);};
test('six slots, seventh refused, and rooms isolated',()=>{
  const r=new Room(1000),peers=Array.from({length:7},()=>peer());peers.forEach((p,i)=>join(r,p,`Amigo ${i}`));
  assert.equal(r.sim.players.size,6);assert.equal(peers[6].closes[0].code,4003);
  const other=new Room(1000),p=peer();join(other,p);assert.equal(other.sim.players.size,1);assert.equal(r.sim.players.size,6);
});
test('reconnect preserves identity, health, score, enemies and refuses stolen display name',()=>{
  const r=new Room(1000),a=peer();join(r,a);const w=a.messages.find(m=>m.t==='welcome');
  const original=r.sim.players.get(w.id)!;original.hp=64;original.score=10;
  const enemy=createEnemy(r.sim.world,'gosma',{x:original.x+8,y:original.y});enemy.hp=2;
  r.disconnect(a,1500);const b=peer();r.connect(b,1600);r.receive(b,JSON.stringify({t:'join',protocol:3,token:w.token}),1600);
  assert.equal(b.messages[0].id,w.id);assert.equal(r.sim.players.size,1);assert.equal(original.hp,64);assert.equal(original.score,10);
  assert.equal(r.sim.world.enemies.get(enemy.id)?.hp,2);
  const duplicate=peer();r.connect(duplicate,1600);r.receive(duplicate,JSON.stringify({t:'join',protocol:3,token:w.token}),1600);assert.equal(duplicate.closes[0].code,4003);
  const fake=peer();r.connect(fake,1600);r.receive(fake,JSON.stringify({t:'join',protocol:3,token:'invalid',name:'Amigo'}),1600);assert.equal(fake.closes[0].code,4003);
});
test('expired token cannot reclaim a slot or create a duplicate',()=>{
  const r=new Room(1000),p=peer();join(r,p);const token=p.messages[0].token;r.disconnect(p,1100);
  const back=peer();r.connect(back,32100);r.receive(back,JSON.stringify({t:'join',protocol:3,token}),32100);assert.equal(back.closes[0].code,4003);assert.equal(r.sim.players.size,0);
});
test('movement ignores position/hp/damage fields and is capped per server tick',()=>{
  const s=new Simulation();const p=s.add('p','Tester','cidadao-comum');s.resetRun();const start={...p},maxHp=p.hp;
  assert.equal(s.input('p',{seq:1,x:Infinity,y:0,attack:false}),false);
  assert.equal(s.input('p',{seq:1,x:1000,y:1000,attack:false}),false);
  assert.equal(s.input('p',{seq:1,x:0,y:0,attack:false,target:{id:'forged'}}),false);
  for(let seq=1;seq<=30;seq++)s.input('p',{seq,x:1,y:1,attack:false,hp:99999,position:{x:50,y:50},damage:100000});
  s.step();assert.ok(Math.hypot(p.x-start.x,p.y-start.y)<=SPEED*STEP+.000001);assert.ok(Math.hypot(p.x-start.x,p.y-start.y)>0);
  assert.equal(p.hp,maxHp);assert.equal(p.ack,1);
  assert.equal(s.input('p',{seq:1,x:1,y:0,attack:false}),false);
  for(let i=0;i<400;i++){s.input('p',{seq:Math.max(p.ack+1,i+31),x:1,y:1,attack:false});s.step();assert.ok(walkable(p));}
});
test('prediction replay produces same state after delayed acknowledgement',()=>{
  const s=new Simulation();const p=s.add('p','Tester','cidadao-comum');s.resetRun();
  const inputs:Input[]=Array.from({length:12},(_,i)=>({seq:i+1,x:i<6?1:0,y:i<6?0:1,attack:false}));
  const predicted=inputs.reduce((p,i)=>simulate(p,i),{x:p.x,y:p.y});
  for(const i of inputs.slice(0,5)){s.input('p',i);s.step();}
  const replay=reconcile(p,inputs.filter(i=>i.seq>p.ack));assert.deepEqual(replay,predicted);
});
test('every kill rewards each active player once and never spectators',()=>{
  const s=new Simulation(),p=s.add('p','Tester','cidadao-comum'),q=s.add('q','Ally','mendigo'),watcher=s.add('w','Watcher','cidadao-comum');
  watcher.spectator=true;s.resetRun();
  const enemy=createEnemy(s.world,'gosma',{x:p.x+8,y:p.y});
  assert.equal(s.world.damageEnemy(enemy.id,1e6,p.id),true);s.step();
  assert.equal(p.score,10);assert.equal(q.score,10);assert.equal(watcher.score,0);
  assert.equal(s.world.damageEnemy(enemy.id,1e6,p.id),false);s.step();
  assert.equal(p.score,10);assert.equal(q.score,10);
});
test('delta can reconstruct full state and removes departed players',()=>{
  const s=new Simulation();s.add('a','A','cidadao-comum');s.add('b','B','mendigo');s.resetRun();const before=s.snapshot();s.remove('b');s.input('a',{seq:1,x:1,y:0,attack:false});s.step();const after=s.snapshot(),patch=delta(before,after);
  const players=new Map(before.players.map(p=>[p[0],p]));for(const p of patch.players)players.set(p[0],p);for(const id of patch.removed)players.delete(id);
  assert.deepEqual([...players.values()],after.players);assert.ok(JSON.stringify(patch).length<JSON.stringify(after).length+100);
});
test('message flooding and oversized payloads close connection',()=>{
  const r=new Room(1000),a=peer();join(r,a);for(let i=0;i<50;i++)r.receive(a,'{"t":"ping","at":1}',1000);assert.equal(a.closes[0].code,4008);
  const b=peer();join(r,b,'B',1000);r.receive(b,'a'.repeat(1025),1000);assert.equal(b.closes[0].code,1009);
});


test('older clients are rejected before joining a procedural room',()=>{
  const room=new Room(1000,42),old=peer();room.connect(old,1000);
  room.receive(old,JSON.stringify({t:'join',protocol:1,name:'Old',classId:'cidadao-comum'}),1000);
  assert.equal(room.sim.players.size,0);assert.equal(old.closes[0].code,4003);
  assert.match(old.messages[0].message,/Atualize/);
});

const command=(room:Room,p:Peer,message:object,now=1100)=>room.receive(p,JSON.stringify(message),now);
const idOf=(p:ReturnType<typeof peer>)=>p.messages.find(m=>m.t==='welcome').id as string;
const results=(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='result');
function startRun(room:Room,peers:ReturnType<typeof peer>[]){
  for(const p of peers)command(room,p,{t:'ready',round:room.run.snapshot().round,ready:true});
  for(let i=0;i<60;i++)room.advance(1200+i*50);
  assert.equal(room.run.snapshot().phase,'combat');
}
/** Knocks every active player down through the simulation, as enemy hits would. */
function downAll(room:Room){
  for(const p of room.sim.players.values())if(!p.spectator){p.invulnerableUntil=0;room.sim.world.damagePlayer(p.id,1e6,'test');}
}
test('room gates input by phase and round; duplicate rematch resets only once',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');
  const p=room.sim.players.get(idOf(a))!,original={x:p.x,y:p.y};
  command(room,a,{t:'input',round:1,seq:1,x:1,y:0,attack:true});room.advance(1150);
  assert.equal(room.sim.tick,0);assert.deepEqual({x:p.x,y:p.y},original);
  startRun(room,[a,b]);const spawn={x:p.x,y:p.y};
  command(room,a,{t:'input',round:999,seq:1,x:1,y:0,attack:true},4300);room.advance(4350);assert.equal(p.ack,0);
  command(room,a,{t:'input',round:1,seq:1,x:1,y:0,attack:true},4400);room.advance(4450);assert.equal(p.ack,1);
  assert.notDeepEqual({x:p.x,y:p.y},spawn);
  p.score=30;downAll(room);room.advance(4500);
  const result=room.run.snapshot();assert.equal(result.outcome,'defeat');assert.ok(result.resultId);
  room.advance(4550);assert.equal(room.run.snapshot().resultId,result.resultId);
  command(room,b,{t:'rematch',round:1},4600);command(room,b,{t:'rematch',round:1},4600);
  assert.equal(room.run.snapshot().round,2);assert.equal(room.run.snapshot().phase,'lobby');
  assert.equal(p.score,0);assert.equal(p.hp,p.stats.maxHp);assert.equal(p.ack,0);assert.equal(room.sim.tick,0);
  assert.equal(p.downed,undefined);assert.equal(room.sim.outcome,undefined);
  assert.equal(room.sim.world.enemies.size,0);assert.equal(p.attackTick,0);
  command(room,a,{t:'ready',round:1,ready:true},4700);assert.ok(room.run.snapshot().members.every(m=>!m.ready));
});
test('late arrival is spectator; original member reconnects without restarting combat',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const token=a.messages.find(m=>m.t==='welcome').token;
  room.disconnect(a,4300);room.advance(4350);assert.equal(room.run.snapshot().phase,'combat');
  const late=peer();join(room,late,'Late',4400);const spectator=room.sim.players.get(idOf(late))!;
  assert.equal(spectator.spectator,true);const pos={x:spectator.x,y:spectator.y};
  command(room,late,{t:'input',round:1,seq:1,x:1,y:0,attack:true},4450);room.advance(4500);
  assert.deepEqual({x:spectator.x,y:spectator.y},pos);assert.equal(spectator.ack,0);
  const elapsed=room.run.snapshot().elapsed,back=peer();room.connect(back,4550);
  command(room,back,{t:'join',protocol:3,token},4550);
  assert.equal(idOf(back),idOf(a));assert.equal(room.sim.players.get(idOf(a))!.spectator,false);
  assert.equal(room.run.snapshot().elapsed,elapsed);assert.equal(room.sim.players.size,3);
  // Spectators cannot keep an otherwise defeated team alive.
  downAll(room);room.advance(4600);
  assert.equal(room.sim.outcome,'defeat');assert.equal(room.run.snapshot().outcome,'defeat');assert.equal(spectator.score,0);
});
test('disconnect cancels countdown and explicitly leaving the room needs no host',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');
  command(room,a,{t:'ready',round:1,ready:true});command(room,b,{t:'ready',round:1,ready:true});
  room.advance(1200);room.disconnect(a,1250);assert.equal(room.run.snapshot().phase,'lobby');
  // Expired participant frees its slot; the remaining ready player can start.
  command(room,b,{t:'ping'},32000);room.advance(32000);
  assert.equal(room.run.snapshot().phase,'countdown');assert.equal(room.sim.players.size,1);
});
test('boss kill sends one result message to every player and stays stable',()=>{
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  room.advance(4200);assert.equal(results(a).length,0);
  const p=room.sim.players.get(idOf(a))!,boss=createEnemy(room.sim.world,'chefe',{x:p.x+12,y:p.y});
  // Outcomes count only inside a simulation tick, so the kill happens within the next world step.
  const world=room.sim.world,step=world.step.bind(world);
  world.step=()=>{world.damageEnemy(boss.id,1e6,p.id);return step();};
  for(let i=0;i<10;i++)room.advance(4250+i*50);
  const state=room.run.snapshot();assert.equal(state.phase,'result');assert.equal(state.outcome,'victory');
  for(const viewer of [a,b]){
    assert.deepEqual(results(viewer),[{t:'result',outcome:'victory',resultId:state.resultId,round:1}]);
    // The full snapshot announcing the result reaches the client before the result message.
    const at=viewer.messages.findIndex(m=>m.t==='result'),before=viewer.messages.slice(0,at).filter(m=>m.t==='state'&&m.full).at(-1);
    assert.equal(before?.run?.phase,'result');
  }
});
test('victory or defeat on the last tick beats the timeout; otherwise the timeout is announced once',()=>{
  const duration=8;
  const race=new Room(1000,undefined,{durationTicks:duration}),a=peer();join(race,a);startRun(race,[a]);
  for(let i=0;i<duration-1;i++)race.advance(4200+i*50);
  assert.equal(race.run.snapshot().phase,'combat');assert.equal(race.run.snapshot().remaining,1);
  downAll(race);race.advance(5000);
  assert.equal(race.run.snapshot().outcome,'defeat');assert.deepEqual(results(a).map(m=>m.outcome),['defeat']);
  const idle=new Room(1000,undefined,{durationTicks:duration}),b=peer();join(idle,b);startRun(idle,[b]);
  for(let i=0;i<duration+5;i++)idle.advance(4200+i*50);
  assert.equal(idle.run.snapshot().outcome,'timeout');assert.deepEqual(results(b).map(m=>m.outcome),['timeout']);
});

/** Starts a two-player run and queues two level offers for each player through the run's progression. */
function offerRoom(){
  const room=new Room(1000),a=peer(),b=peer();join(room,a);join(room,b,'B');startRun(room,[a,b]);
  const progression=room.sim.run.progression;
  progression.grantLevelOffers(room.sim.world,2);progression.grantLevelOffers(room.sim.world,3);
  let calls=0;const choose=room.sim.choose.bind(room.sim);
  room.sim.choose=(id,offer,index)=>{calls++;return choose(id,offer,index);};
  room.advance(4200);room.advance(4250);
  return {room,a,b,calls:()=>calls,offers:(p:ReturnType<typeof peer>)=>p.messages.filter(m=>m.t==='offers')};
}
test('pending offers are pushed once per change on broadcast ticks',()=>{
  const {room,a,b,offers}=offerRoom(),id=idOf(a);
  assert.equal(offers(a).length,1);assert.equal(offers(b).length,1);
  assert.deepEqual(offers(a)[0].offers.map((o:any)=>o.id),[`lvl-2-${id}`,`lvl-3-${id}`]);
  assert.ok(offers(a)[0].offers.every((o:any)=>o.playerId===id));
  for(let i=0;i<6;i++)room.advance(4300+i*50);
  assert.equal(offers(a).length,1);
});
test('choose applies only the oldest real offer once; forged, repeated and out-of-order picks are refused',()=>{
  const {room,a,b,calls,offers}=offerRoom(),id=idOf(a),p=room.sim.players.get(id)!;
  const build=()=>JSON.stringify(p.build),initial=build();
  // Another player's offer, a later offer and an unknown level reach the simulation and are refused there.
  for(const offer of [`lvl-2-${idOf(b)}`,`lvl-3-${id}`,`lvl-9-${id}`]){
    command(room,a,{t:'choose',round:1,offer,index:0},4300);
    assert.equal(offers(a).at(-1).offers.length,2);assert.equal(build(),initial);
  }
  assert.equal(calls(),3);
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0},4300);
  assert.equal(calls(),4);assert.deepEqual(offers(a).at(-1).offers.map((o:any)=>o.id),[`lvl-3-${id}`]);
  assert.notEqual(build(),initial);const afterPick=build();
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0},4300);
  assert.equal(calls(),5);assert.equal(offers(a).at(-1).offers.length,1);assert.equal(build(),afterPick);
  assert.equal(room.sim.offers(idOf(b)).length,2);
});
test('choose drops malformed ids, bad indexes and stale rounds before the simulation',()=>{
  const {room,a,calls}=offerRoom(),id=idOf(a),head=`lvl-2-${id}`;
  const bad:object[]=[
    {t:'choose',round:2,offer:head,index:0},{t:'choose',offer:head,index:0},
    {t:'choose',round:1,offer:head,index:4},{t:'choose',round:1,offer:head,index:-1},{t:'choose',round:1,offer:head,index:1.5},{t:'choose',round:1,offer:head,index:'0'},
    {t:'choose',round:1,offer:'boss-1',index:0},{t:'choose',round:1,offer:`lvl-2-${'x'.repeat(41)}`,index:0},{t:'choose',round:1,offer:`lvl-2-${id}~`,index:0},
    {t:'choose',round:1,offer:{id:head},index:0},{t:'choose',round:1,offer:`lvl-2-${id}\n`,index:0},
  ];
  for(const message of bad)command(room,a,message,4300);
  assert.equal(calls(),0);assert.equal(room.sim.offers(id).length,2);
});
test('choose outside combat is refused (lobby and result)',()=>{
  const room=new Room(1000),a=peer();join(room,a);const id=idOf(a);
  let calls=0;const choose=room.sim.choose.bind(room.sim);room.sim.choose=(pid,offer,index)=>{calls++;return choose(pid,offer,index);};
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0});assert.equal(calls,0);
  startRun(room,[a]);room.sim.run.progression.grantLevelOffers(room.sim.world,2);
  downAll(room);room.advance(4200);assert.equal(room.run.snapshot().phase,'result');
  command(room,a,{t:'choose',round:1,offer:`lvl-2-${id}`,index:0},4300);assert.equal(calls,0);
});
test('each new horde round is announced with one full snapshot',()=>{
  const room=new Room(1000),a=peer();join(room,a);startRun(room,[a]);
  const fulls=()=>a.messages.filter(m=>m.t==='state'&&m.full).length,startFulls=fulls();
  let tick=0;const at=()=>4200+tick*50;
  // Pings keep the connection fresh while the opening runs.
  const advance=()=>{command(room,a,{t:'ping',at:0},at());room.advance(at());tick++;};
  while(room.sim.world.round.index===0&&tick<400){advance();if(room.sim.world.round.index===0)assert.equal(fulls(),startFulls);}
  assert.equal(room.sim.world.round.index,1);assert.equal(fulls(),startFulls+1);
  assert.equal(a.messages.filter(m=>m.t==='state'&&m.full).at(-1).tick,room.sim.tick);
  for(let i=0;i<10;i++)advance();
  assert.equal(room.run.snapshot().phase,'combat');assert.equal(a.closes.length,0);assert.equal(fulls(),startFulls+1);
});

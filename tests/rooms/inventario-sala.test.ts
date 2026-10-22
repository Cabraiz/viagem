// D-051 inventory commands through the room (NEW-20261014-ORQ-armas-caixas-inventario): {t:'equip'|'use'|'drop',slot}
// and {t:'take',pickup} (the pickup's wire id), answered {t:'inv',cmd,ok,reason?}; refused with the automatic weapons.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {FrameDecoder} from '../../src/protocol/protocol4.ts';
import {dropItem} from '../../src/sim/inventory.ts';

function peer(){
  const messages:any[]=[],frames:Uint8Array[]=[];
  return {messages,frames,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}};
}
const say=(room:Room,p:Peer,m:object,now:number)=>room.receive(p,JSON.stringify(m),now);
function manualRoom(combat:'manual'|'auto'='manual',lab=false){
  const room=new Room(1000,7,{world:'ilha',...(combat==='manual'?{combat}:{}),...(lab?{lab:true}:{})}),a=peer();
  room.connect(a,1000);say(room,a,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'},1000);
  let t=1100;say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  room.advance(t+=50);
  const id=a.messages.find(m=>m.t==='welcome').id;
  return {room,a,id,t,round:()=>room.run.snapshot().round,me:()=>room.sim.players.get(id)!};
}
const answers=(a:ReturnType<typeof peer>)=>a.messages.filter(m=>m.t==='inv');

test('equip, use and drop answer {t:inv}; the frames carry the hand',()=>{
  let {room,a,t,round,me}=manualRoom();
  const world=(room.sim as any).world;
  dropItem(world,me(),{id:'pistola',level:2});dropItem(world,me(),{id:'coxinha',level:1});
  room.advance(t+=50);
  assert.deepEqual(me().build.weapons.map(i=>i.id),['faca','pistola','coxinha']);
  say(room,a,{t:'equip',round:round(),slot:1},t);
  assert.deepEqual(answers(a).at(-1),{t:'inv',cmd:'equip',ok:true});assert.equal(me().build.hand,1);
  say(room,a,{t:'use',round:round(),slot:2},t);
  assert.deepEqual(answers(a).at(-1),{t:'inv',cmd:'use',ok:false,reason:'unusable'},'full hp');
  say(room,a,{t:'drop',round:round(),slot:0},t);
  assert.deepEqual(answers(a).at(-1),{t:'inv',cmd:'drop',ok:true});
  assert.deepEqual(me().build.weapons.map(i=>i.id),['pistola','coxinha']);assert.equal(me().build.hand,0,'the hand follows its weapon');
  // Malformed slots never reach the sim (no answer).
  const n=answers(a).length;
  for(const slot of [-1,6,1.5,'0'])say(room,a,{t:'equip',round:round(),slot},t);
  assert.equal(answers(a).length,n);
  // The frames carry the inventory and the hand.
  room.advance(t+=50);
  const dec=new FrameDecoder();let view;
  for(const f of a.frames){const r=dec.decode(f);if(r.ok)view=r.view;}
  const mine=view!.players.find(p=>p.weapons.some(w=>w.id==='pistola'))!;
  assert.equal(mine.hand,0);
});

test('take resolves the wire id of an item on the ground; too far is refused with a reason',()=>{
  let {room,a,t,round,me}=manualRoom();
  const world=(room.sim as any).world;
  const far=dropItem(world,{x:me().x+5,y:me().y},{id:'rifle',level:3});
  room.advance(t+=50);
  const dec=new FrameDecoder();let view;
  for(const f of a.frames){const r=dec.decode(f);if(r.ok)view=r.view;}
  const wire=view!.pickups.find(k=>k.kind==='item'&&k.resource==='rifle')!.id;
  assert.notEqual(wire,far.id,'the client only knows the wire id');
  say(room,a,{t:'take',round:round(),pickup:wire},t);
  assert.deepEqual(answers(a).at(-1),{t:'inv',cmd:'take',ok:false,reason:'far'});
  me().x=far.x;me().y=far.y+1;
  say(room,a,{t:'take',round:round(),pickup:wire},t);
  assert.deepEqual(answers(a).at(-1),{t:'inv',cmd:'take',ok:true});
  assert.ok(me().build.weapons.some(i=>i.id==='rifle'&&i.level===3));
});

test('the automatic weapons have no inventory: the commands are refused',()=>{
  const {room,a,t,round}=manualRoom('auto');
  say(room,a,{t:'equip',round:round(),slot:0},t);
  assert.deepEqual(answers(a).at(-1),{t:'inv',cmd:'equip',ok:false,reason:'player'});
});

test('melee-alcance-2x: the lab {give} puts a weapon in the hand (lab rooms only; never a passive or an unknown id)',()=>{
  const prod=manualRoom();
  say(prod.room,prod.a,{t:'lab',give:'pistola'},prod.t);
  assert.deepEqual(prod.me().build.weapons.map(i=>i.id),['faca'],'a real room ignores it');
  const {room,a,t,me}=manualRoom('manual',true);
  for(const give of ['pente','nada',7])say(room,a,{t:'lab',give},t);
  assert.deepEqual(me().build.weapons.map(i=>i.id),['faca']);
  say(room,a,{t:'lab',give:'pistola'},t);
  assert.deepEqual(me().build.weapons.map(i=>i.id),['faca','pistola']);assert.equal(me().build.hand,1);
});

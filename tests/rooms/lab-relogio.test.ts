// Card NEW-20261029-ORQ-missao-proteger-uno-tempo: the GIF's lab {t:'lab',clock:N} (dev rooms only) cuts the chaveiro's
// wait to N s, never longer, so his arrival is filmed without the 5:00. The wait is faked on the room's chaveiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';

function peer(){
  const messages:any[]=[];
  return {messages,gone:false,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
function combat(room:Room,p:ReturnType<typeof peer>){
  room.connect(p,1000);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'},1000);
  let t=1100;say(room,p,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat'||room.sim.world.round.phase!=='wave';t+=50){say(room,p,{t:'ping',at:t},t);room.advance(t);}
  return t;
}

test('lab {clock:N} cuts the chaveiro wait to N s (20 ticks a second), never adds, only in a lab room',()=>{
  for(const lab of [true,false]){
    const room=new Room(1000,undefined,lab?{lab:true}:{}),a=peer(),t=combat(room,a);
    const state={wait:6000};(room.sim.run as {chaveiro?:unknown}).chaveiro={state};
    say(room,a,{t:'lab',clock:2},t);
    assert.equal(state.wait,lab?40:6000,lab?'a lab room cuts it':'never outside a lab room');
    say(room,a,{t:'lab',clock:100},t);
    assert.equal(state.wait,lab?40:6000,'a longer clock never adds time');
    say(room,a,{t:'lab',clock:-1},t);say(room,a,{t:'lab',clock:'x'},t);
    assert.equal(state.wait,lab?40:6000,'junk is ignored');
  }
});

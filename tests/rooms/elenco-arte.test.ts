// arte-do-roster-no-render: the room names the run's drawn enemies ({t:'elenco',ids}) so a phone fetches their art
// before they show up; JSON control, no protocol bump.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL,ELENCO_MAX,parseElenco} from '../../src/protocol/room.ts';
import {INIMIGOS_LIBERADOS,MINI_COUNT,ROSTER,ROSTER_ONLY_LIBERADOS,ROTATION_SIZE} from '../../src/rules/index.ts';

function peer(){
  const messages:any[]=[];
  return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};
}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,message:object,now:number)=>room.receive(p,JSON.stringify(message),now);
const join=(room:Room,p:TestPeer,name:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'},now);};
const elencos=(p:TestPeer)=>p.messages.filter(m=>m.t==='elenco');

test('parseElenco: strings only, no repeats, capped; anything else is not an elenco',()=>{
  assert.deepEqual(parseElenco({t:'elenco',ids:['grauzeiro','rato-de-boteco','grauzeiro',3,'',null,'x'.repeat(65)]}),['grauzeiro','rato-de-boteco']);
  assert.equal(parseElenco({t:'elenco',ids:Array.from({length:50},(_,i)=>`id-${i}`)})?.length,ELENCO_MAX);
  assert.deepEqual(parseElenco({t:'elenco',ids:[]}),[]);
  assert.equal(parseElenco({t:'elenco'}),undefined);assert.equal(parseElenco({t:'emote',ids:['a']}),undefined);assert.equal(parseElenco(null),undefined);
});

test('the room sends the drawn rotation once when the run draws it, and to a joiner right after its welcome',()=>{
  const room=new Room(1000),a=peer();join(room,a,'Ana',1000);
  assert.equal(elencos(a).length,0,'no run yet: nothing to name');
  let t=1100;say(room,a,{t:'ready',round:room.run.snapshot().round,ready:true},t);
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  for(let i=0;i<10;i++,t+=50)room.advance(t);
  const sent=elencos(a);
  assert.equal(sent.length,1,'once per rotation, not per tick');
  const ids:string[]=sent[0].ids,known=new Set(ROSTER.map(r=>r.id));
  // Só 3 inimigos (ROSTER_ONLY_LIBERADOS): the liberated ones and the drawn minis; the hidden roster: a full rotation.
  // The saci (role 'chefe') is the ninhos chefão, not a rounds kind (card saci-chefe-2x).
  const common=INIMIGOS_LIBERADOS.filter(id=>ROSTER.find(r=>r.id===id)?.role!=='chefe');
  if(ROSTER_ONLY_LIBERADOS)assert.ok(common.every(id=>ids.includes(id))&&ids.length<=INIMIGOS_LIBERADOS.length+MINI_COUNT,`${ids.join()}`);
  else assert.ok(ids.length>=ROTATION_SIZE.min&&ids.length<=ROTATION_SIZE.max+2,`${ids.length} ids`);
  assert.ok(ids.every(id=>known.has(id)),'roster ids');
  assert.deepEqual(ids,room.sim.rotationIds());
  assert.deepEqual(parseElenco(sent[0]),ids,'the client reads it whole');
  // A phone joining mid-run hears it right after its welcome (and its first frame).
  const b=peer();join(room,b,'Bia',t);
  const at=b.messages.findIndex(m=>m.t==='welcome'),got=b.messages.findIndex(m=>m.t==='elenco');
  assert.ok(at>=0&&got>at,'after the welcome');assert.deepEqual(b.messages[got].ids,ids);
  for(let i=0;i<5;i++,t+=50)room.advance(t);
  assert.equal(elencos(b).length,1,'no repeat for the joiner');assert.equal(elencos(a).length,1);
});

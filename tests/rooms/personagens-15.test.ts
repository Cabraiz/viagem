// D-053 (17/10/2026, card movimento128-8-direcoes): for now only the 15 heroes with the complete R06 movement art can
// be picked in the menu or drawn for a room bot; the other 20 stay in the code and data, hidden. A room or a client
// asking for a hidden class plays the first playable one, never an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {PLAYABLE_CLASS_IDS,classes,filterClasses,playableClassId,playableClasses,roles} from '../../src/rules/classes.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

const R06=['caca-promocao','clt-cansado','coach','concurseira','faxineira','feirante','maromba','mendigo','passageira','pedreiro',
  'roqueira','streamer','universitario','viciado-em-bet','vizinha-fofoqueira'];

function peer(){const messages:any[]=[];return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,m:object,now:number)=>room.receive(p,JSON.stringify(m),now);
const join=(room:Room,p:TestPeer,name:string,classId:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId},now);return p.messages.findLast(m=>m.t==='welcome').id as string;};

test('the menu\'s list is the 15 with R06 art, in the roster\'s order; the 20 others stay in the data',()=>{
  assert.deepEqual([...PLAYABLE_CLASS_IDS].sort(),[...R06].sort());
  assert.deepEqual(playableClasses.map(c=>c.id),classes.map(c=>c.id).filter(id=>R06.includes(id)));
  assert.equal(classes.length,35,'nobody was deleted');
  assert.deepEqual(filterClasses('','Todas').map(c=>c.id),playableClasses.map(c=>c.id),'the menu\'s search sees the 15 only');
  for(const role of roles)for(const c of filterClasses('',role))assert.ok(R06.includes(c.id),`${role}: ${c.id}`);
  assert.equal(playableClassId('aposentado'),playableClasses[0].id);assert.equal(playableClassId('coach'),'coach');
  assert.equal(playableClassId(42),playableClasses[0].id);
});

test('a room seats a hidden or unknown class as the first playable one, a playable one as it is; its bots never draw outside the 15',()=>{
  const seen=new Set<string>();
  for(let seed=1;seed<=12;seed++){
    const room=new Room(1000,seed),a=peer(),b=peer();
    const ana=join(room,a,'Ana','aposentado',1000),bia=join(room,b,'Bia','coach',1000);
    assert.equal(room.sim.players.get(ana)!.classId,playableClasses[0].id,'a hidden class plays the first playable one');
    assert.equal(room.sim.players.get(bia)!.classId,'coach');
    let t=1100;
    for(let k=0;k<4;k++){say(room,a,{t:'bot-add',round:room.run.snapshot().round},t);t+=OWNER_GAP_MS+1;}
    const bots=room.run.snapshot().members.filter(m=>m.bot);
    assert.equal(bots.length,4,`seed ${seed}: 4 bots seated`);
    for(const m of bots){const c=room.sim.players.get(m.id)!.classId;assert.ok(R06.includes(c),`seed ${seed}: bot ${c}`);seen.add(c);}
  }
  assert.ok(seen.size>=8,`the draw still varies over the 15 (${seen.size} seen)`);
});

// D-053 (17/10/2026, card movimento128-8-direcoes): for now only the 15 heroes with the complete R06 movement art can
// be picked in the menu or drawn for a room bot; the other 20 stay in the code and data, hidden. A room or a client
// asking for a hidden class plays the first playable one, never an error. Two of the 15 (roqueira, caca-promocao) left
// the game with NEW-20261023-ORQ-remover-7-personagens: 13 remain, and a client asking for a removed one plays the viciado.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {BOT_CLASS_IDS,PLAYABLE_CLASS_IDS,classes,filterClasses,playableClassId,playableClasses,roles} from '../../src/rules/classes.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

const R06=['clt-cansado','coach','concurseira','faxineira','feirante','maromba','mendigo','passageira','pedreiro',
  'streamer','universitario','viciado-em-bet','vizinha-fofoqueira'];
/** gato-no-menu (23/10): the gato, playable with its own movement art (16 poses), never a bot for now. */
const GATO='gato-nada-pra-comer';
/** liberar-vendedor-aposentado (user, 24/10): playable with their 4-direction sheets, never bots until their 8-direction art. */
const VITRINE4=['vendedor-praia','aposentado'];
const PLAYABLE=[...R06,GATO,...VITRINE4];

function peer(){const messages:any[]=[];return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,m:object,now:number)=>room.receive(p,JSON.stringify(m),now);
const join=(room:Room,p:TestPeer,name:string,classId:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId},now);return p.messages.findLast(m=>m.t==='welcome').id as string;};

test('the menu's list is the 13 with R06 art, the gato, the vendedor and the aposentado, in the roster's order; the 13 others stay in the data',()=>{
  assert.deepEqual([...PLAYABLE_CLASS_IDS].sort(),[...PLAYABLE].sort());
  assert.deepEqual(playableClasses.map(c=>c.id),classes.map(c=>c.id).filter(id=>PLAYABLE.includes(id)));
  assert.equal(classes.length,29,'only the 7 of legado/ were deleted');
  assert.deepEqual(filterClasses('','Todas').map(c=>c.id),playableClasses.map(c=>c.id),'the menu's search sees the 16 only');
  for(const role of roles)for(const c of filterClasses('',role))assert.ok(PLAYABLE.includes(c.id),`${role}: ${c.id}`);
  assert.deepEqual([...BOT_CLASS_IDS].sort(),[...R06].sort(),'the gato, the vendedor and the aposentado are never bots');
  assert.equal(playableClassId('cidadao-comum'),playableClasses[0].id);assert.equal(playableClassId('aposentado'),'aposentado');assert.equal(playableClassId('coach'),'coach');
  assert.equal(playableClassId(42),playableClasses[0].id);
});

test('a room seats a person\'s hidden or locked class as the viciado, a released one as it is; its bots never draw outside the 13',()=>{
  const seen=new Set<string>();
  for(let seed=1;seed<=12;seed++){
    const room=new Room(1000,seed),a=peer(),b=peer();
    const ana=join(room,a,'Ana','cidadao-comum',1000),bia=join(room,b,'Bia','clt-cansado',1000);
    assert.equal(room.sim.players.get(ana)!.classId,'viciado-em-bet','a hidden class plays the viciado (cadeado-so-clt-viciado)');
    assert.equal(room.sim.players.get(bia)!.classId,'clt-cansado');
    let t=1100;
    for(let k=0;k<4;k++){say(room,a,{t:'bot-add',round:room.run.snapshot().round},t);t+=OWNER_GAP_MS+1;}
    const bots=room.run.snapshot().members.filter(m=>m.bot);
    assert.equal(bots.length,4,`seed ${seed}: 4 bots seated`);
    for(const m of bots){const c=room.sim.players.get(m.id)!.classId;assert.ok(R06.includes(c),`seed ${seed}: bot ${c}`);seen.add(c);}
  }
  assert.ok(seen.size>=8,`the draw still varies over the 13 (${seen.size} seen)`);
});

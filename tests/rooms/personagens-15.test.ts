// D-053 (17/10/2026, card movimento128-8-direcoes): only some heroes could be picked in the menu or drawn for a room bot;
// the others stay in the code and data, hidden. A room or a client asking for a hidden class plays the first playable
// one, never an error. herois-legados-escondidos (the user, 29/10): only the 6 active heroes stay playable; every other
// class is a hidden legacy. The Mendigo hero was deleted (the user, 30/10): an old client or save asking for 'mendigo'
// plays the viciado too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {BOT_CLASS_IDS,LEGACY_CLASS_IDS,PLAYABLE_CLASS_IDS,classes,filterClasses,playableClassId,playableClasses,roles} from '../../src/rules/classes.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

/** The 6 active heroes, in the menu's order. */
const PLAYABLE=['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','aposentado'];
/** The ones a room bot may get: the 5 but the gato (gato-no-menu); the vendedor and the aposentado since bots-vendedor-aposentado. */
const BOTS=['viciado-em-bet','clt-cansado','maromba','vendedor-praia','aposentado'];

function peer(){const messages:any[]=[];return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};}
type TestPeer=ReturnType<typeof peer>;
const say=(room:Room,p:Peer,m:object,now:number)=>room.receive(p,JSON.stringify(m),now);
const join=(room:Room,p:TestPeer,name:string,classId:string,now:number)=>{room.connect(p,now);say(room,p,{t:'join',protocol:ROOM_PROTOCOL,name,classId},now);return p.messages.findLast(m=>m.t==='welcome').id as string;};

test('the menu\'s list is the 6 active heroes, in the roster\'s order; the 22 legacy ones stay in the data, the Mendigo hero is gone',()=>{
  assert.deepEqual([...PLAYABLE_CLASS_IDS],PLAYABLE);
  assert.deepEqual(playableClasses.map(c=>c.id),classes.map(c=>c.id).filter(id=>PLAYABLE.includes(id)));
  assert.equal(classes.length,28,'only the Mendigo hero was deleted: the other legacy heroes stay in the catalog');
  assert.deepEqual([...LEGACY_CLASS_IDS].sort(),classes.map(c=>c.id).filter(id=>!PLAYABLE.includes(id)).sort());
  assert.ok(!classes.some(c=>c.id==='mendigo')&&!LEGACY_CLASS_IDS.includes('mendigo'),'the Mendigo hero is deleted (the mendigo on screen is an enemy)');
  assert.deepEqual(filterClasses('','Todas').map(c=>c.id),playableClasses.map(c=>c.id),'the menu\'s search sees the 6 only');
  for(const role of roles)for(const c of filterClasses('',role))assert.ok(PLAYABLE.includes(c.id),`${role}: ${c.id}`);
  assert.deepEqual([...BOT_CLASS_IDS],BOTS,'the gato is never a bot; the other 5 are');
  for(const id of BOT_CLASS_IDS)assert.ok(PLAYABLE.includes(id),`bot ${id} is playable`);
  assert.equal(playableClassId('aposentado'),'aposentado');
  for(const id of [...LEGACY_CLASS_IDS,'mendigo','tia-festa',42,undefined])assert.equal(playableClassId(id),'viciado-em-bet',String(id));
});

test('a room seats a person\'s legacy class as the viciado, an active one as it is; its bots never draw outside the 6',()=>{
  const seen=new Set<string>();
  for(let seed=1;seed<=24;seed++){
    const room=new Room(1000,seed),a=peer(),b=peer();
    const ana=join(room,a,'Ana','mendigo',1000),bia=join(room,b,'Bia','clt-cansado',1000);
    assert.equal(room.sim.players.get(ana)!.classId,'viciado-em-bet','the deleted Mendigo hero (an old client) plays the viciado');
    assert.equal(room.sim.players.get(bia)!.classId,'clt-cansado');
    let t=1100;
    for(let k=0;k<4;k++){say(room,a,{t:'bot-add',round:room.run.snapshot().round},t);t+=OWNER_GAP_MS+1;}
    const bots=room.run.snapshot().members.filter(m=>m.bot);
    assert.equal(bots.length,4,`seed ${seed}: 4 bots seated`);
    for(const m of bots){const c=room.sim.players.get(m.id)!.classId;assert.ok(BOTS.includes(c),`seed ${seed}: bot ${c}`);seen.add(c);assert.ok(!/mendigo/i.test(m.name),`seed ${seed}: bot name ${m.name}`);}
  }
  assert.deepEqual([...seen].sort(),[...BOTS].sort(),'the draw covers the 5');
});

test('an old room saved with legacy heroes (people and bots) comes back on playable ones, no error',()=>{
  const hash=(n:number)=>String(n).repeat(64).slice(0,64);
  const roster={v:2,players:[{id:'p1',tokenHash:hash(1),name:'Ana',classId:'mendigo',until:1e15},{id:'p2',tokenHash:hash(2),name:'Bia',classId:'coach',until:1e15}],
    bots:[{id:'bot-1',name:'Pedreiro',classId:'pedreiro',slot:0},{id:'bot-2',name:'Mendigo',classId:'mendigo',slot:1}],botsAdded:2,owner:'p1'} as any;
  const room=new Room(1000,7);
  assert.doesNotThrow(()=>room.restore(roster,1000));
  const seated=[...room.sim.players.values()].map(p=>[p.id,p.classId]);
  assert.deepEqual(seated,[['p1','viciado-em-bet'],['p2','viciado-em-bet'],['bot-1','viciado-em-bet'],['bot-2','viciado-em-bet']]);
});

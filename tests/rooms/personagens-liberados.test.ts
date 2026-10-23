// cadeado-so-clt-viciado (the user, 22/10): a person may only play the CLT or the viciado (and the gato since gato-no-menu); the other playable heroes
// show locked in the menu and cannot be confirmed; a room converts a locked class sent by a person (a console, an old
// tab) to the viciado; room bots still draw from every playable class.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {PLAYABLE_CLASS_IDS} from '../../src/rules/classes.ts';
import {PERSONAGENS_LIBERADOS,PERSONAGEM_PADRAO,heroiPadrao,isLiberado,liberadoId} from '../../src/rules/index.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

function peer(){const messages:any[]=[];return {messages,send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));},close:()=>{}};}
type TestPeer=ReturnType<typeof peer>;
const join=(room:Room,p:TestPeer,name:string,classId:string,now:number)=>{room.connect(p,now);room.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name,classId}),now);return p.messages.findLast(m=>m.t==='welcome').id as string;};

test('one list: the viciado, the CLT and the gato, all playable; the viciado is the default; anything else falls to him',()=>{
  assert.deepEqual([...PERSONAGENS_LIBERADOS],['viciado-em-bet','clt-cansado','gato-nada-pra-comer']);
  for(const id of PERSONAGENS_LIBERADOS)assert.ok(PLAYABLE_CLASS_IDS.includes(id),`${id} has the movement art`);
  assert.equal(PERSONAGEM_PADRAO,'viciado-em-bet');assert.equal(heroiPadrao().id,'viciado-em-bet');
  assert.equal(isLiberado('clt-cansado'),true);assert.equal(isLiberado('coach'),false);assert.equal(isLiberado(42),false);
  assert.equal(liberadoId('clt-cansado'),'clt-cansado');assert.equal(liberadoId('gato-nada-pra-comer'),'gato-nada-pra-comer');
  for(const id of ['coach','pedreiro','aposentado','tia-festa',undefined,42])assert.equal(liberadoId(id),'viciado-em-bet',String(id));
  assert.ok(PLAYABLE_CLASS_IDS.filter(id=>!isLiberado(id)).length>=10,'the rest of the playable heroes are locked');
});

test('a room seats a person who sends a locked class as the viciado; its bots still draw locked heroes',()=>{
  const botClasses=new Set<string>();
  for(let seed=1;seed<=10;seed++){
    const room=new Room(1000,seed),a=peer(),b=peer(),c=peer();
    const ana=join(room,a,'Ana','pedreiro',1000),bia=join(room,b,'Bia','clt-cansado',1000),cid=join(room,c,'Cid','viciado-em-bet',1000);
    assert.equal(room.sim.players.get(ana)!.classId,'viciado-em-bet','a locked class from a console plays the viciado');
    assert.equal(room.sim.players.get(bia)!.classId,'clt-cansado');assert.equal(room.sim.players.get(cid)!.classId,'viciado-em-bet');
    let t=1100;
    for(let k=0;k<3;k++){room.receive(a,JSON.stringify({t:'bot-add',round:room.run.snapshot().round}),t);t+=OWNER_GAP_MS+1;}
    for(const m of room.run.snapshot().members.filter(m=>m.bot))botClasses.add(room.sim.players.get(m.id)!.classId);
  }
  assert.ok([...botClasses].some(id=>!isLiberado(id)),`bots play locked heroes too (${[...botClasses].join(', ')})`);
  assert.ok(botClasses.size>=6,`the bots' draw still varies (${botClasses.size})`);
});

test('the menu opens on the viciado, a saved locked hero falls back to him, and a locked hero never gets confirmed',()=>{
  const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
  assert.match(main,/let selected = heroiPadrao\(\);/,'opens on the default hero, not classes[0]');
  assert.match(main,/if\(isLiberado\(saved\.classId\)\) selected = getClass\(saved\.classId\)/,'only a released saved hero is restored');
  assert.match(main,/function chooseHero\(\) \{\n  if\(!isLiberado\(selected\.id\)\) return;/,'SELECIONAR never locks in a locked hero');
  assert.match(main,/addEventListener\('click',\(\)=>\{\n  if\(!isLiberado\(selected\.id\)\) return;/,'the confirm button (click, Enter through it) refuses a locked hero');
  assert.match(main,/button\.disabled=locked;/,'the button is disabled on a locked hero');
  assert.match(main,/'EM BREVE'/);
  assert.match(main,/data-bloqueado/,'locked tiles are marked in the row');
  assert.ok(main.includes('const classes = [...playableClasses.filter(hero=>isLiberado(hero.id)),...playableClasses.filter(hero=>!isLiberado(hero.id))];'),
    'the released heroes open the row (the menu scripts click the first tile)');
  assert.match(main,/icon\('cadeado'/,'with the lock icon');
});

// NEW-20261009-UX-lobby-mobile: the invite link ?sala= opens the room, the code shows in groups and reads back with or
// without dashes (or as the whole pasted link).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatRoomCode,inviteCode,isRoomCode,readRoomCode,shareLink} from '../../src/client/invite.ts';
import {keyboardUp} from '../../src/client/lobby.ts';

test('formatRoomCode: 4-3-3 groups for a full code, anything else as typed',()=>{
  assert.equal(formatRoomCode('3103A23B68'),'3103-A23-B68');
  assert.equal(formatRoomCode('3103a23b68'),'3103-A23-B68');
  for(const odd of ['','ABC','3103A23B6'])assert.equal(formatRoomCode(odd),odd.toUpperCase());
});
test('readRoomCode: pasted with or without dashes, spaces or the whole link gives the code',()=>{
  for(const t of ['3103A23B68','3103-A23-B68',' 3103 a23 b68 ','3103.A23.B68','3103–A23–B68'])assert.equal(readRoomCode(t),'3103A23B68',t);
  assert.equal(readRoomCode('https://viagem.cyou/?sala=3103A23B68#personagem'),'3103A23B68');
  assert.equal(readRoomCode('Bora pra sala? https://viagem.cyou/?room=3103-A23-B68#personagem'),'3103A23B68');
  assert.equal(isRoomCode(readRoomCode('3103-A23')),false);
});
test('inviteCode: ?sala= (or the older ?room=) only when it is a valid code',()=>{
  assert.equal(inviteCode('?sala=3103A23B68'),'3103A23B68');
  assert.equal(inviteCode('?sala=3103-a23-b68&dev=1&g=abc123'),'3103A23B68');
  assert.equal(inviteCode('?room=ABCDEF0123'),'ABCDEF0123','links sent before ?sala= still open the room');
  assert.equal(inviteCode('?sala=3103A23B68&room=ABCDEF0123'),'3103A23B68');
  for(const s of ['','?sala=','?sala=XYZ','?sala=3103A23B6','?foto=menu','?sala=GGGGGGGGGG'])assert.equal(inviteCode(s),undefined,s);
});
test('the link "Chamar a turma" shares opens the same room (shareLink → inviteCode round trip)',()=>{
  const link=shareLink('https://viagem.cyou/','3103A23B68','&dev=1&g=abc123'),url=new URL(link);
  assert.equal(url.searchParams.get('sala'),'3103A23B68');assert.equal(url.hash,'#personagem');
  assert.equal(inviteCode(url.search),'3103A23B68');
});
test('main.ts: a ?sala= link fills and enters the room (saved hero at once, a new one from the confirmation)',()=>{
  const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
  assert.match(main,/let invite=inviteCode\(location\.search\);/);
  assert.match(main,/openCoop\(\{room,autoJoin:true\}\)/,'the invite opens the lobby with the code and joins by itself');
  assert.match(main,/else if\(invite&&nickname\.trim\(\)/,'a saved hero goes straight in (after a pending resume)');
  assert.match(main,/invite\?openInvite\(\):openCoop\(\)/,'a new player enters from the confirmation button');
  const lobby=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');
  assert.match(lobby,/codeInput\.value=formatRoomCode\(readRoomCode\(options\.room\?\?''\)\)/,'the lobby shows the invited code');
  assert.match(lobby,/if\(options\.autoJoin&&endpoint&&codeInput\.value\)void enter\(false\)/,'and enters it');
  assert.match(lobby,/let code=readRoomCode\(codeInput\.value\)/,'a grouped code is read back without the dashes');
  assert.doesNotMatch(lobby,/30 minutos|mesmo ataque básico/,'the old footer is gone');
});
test('keyboardUp: the visual viewport short or much shorter than the page',()=>{
  assert.equal(keyboardUp(390,390),false);assert.equal(keyboardUp(844,844),false);
  assert.equal(keyboardUp(180,390),true,'landscape with the keyboard');
  assert.equal(keyboardUp(500,844),true,'portrait with the keyboard');
  assert.equal(keyboardUp(800,844),false,'the URL bar only');
});

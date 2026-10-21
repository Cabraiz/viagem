// NEW-20261009-N5-resultado-nomes-longos: a name longer than the rooms take is cut at a whole word with "…", never
// mid-word without a mark ("Concurseira Eterna d").
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fitName,NAME_MAX} from '../../src/client/ui/nick.ts';

test('fitName: the last whole word that fits, with an ellipsis',()=>{
  assert.equal(fitName('Concurseira Eterna da Silva'),'Concurseira Eterna…');
  assert.equal(fitName('Concurseira Eterna da'),'Concurseira Eterna…');
  assert.equal(fitName('Maria Aparecida dos Santos'),'Maria Aparecida dos…');
});
test('fitName: short names untouched, spaces tidied',()=>{
  for(const n of ['Ana','Capivara Veloz','Concurseira','12345678901234567890'])assert.equal(fitName(n),n);
  assert.equal(fitName('  Tia   do  Pavê '),'Tia do Pavê');
});
test('fitName: a first word too long is cut inside it, always marked, never past the room limit',()=>{
  assert.equal(fitName('Pedrodealcantarafrancisco'),'Pedrodealcantarafra…');
  assert.equal(fitName('Ana Pedrodealcantarafrancisco'),'Ana Pedrodealcantar…','a word cut that would leave only "Ana…" cuts inside instead');
  assert.equal(fitName('Concurseira, Eterna da Silva'),'Concurseira, Eterna…');
  assert.equal(fitName('Tio do Pavê - O Lendário'),'Tio do Pavê - O…');
  for(const n of ['Concurseira Eterna da Silva','a'.repeat(80),'😀'.repeat(15),'Bia '+'x'.repeat(30)]){
    const fit=fitName(n);assert.ok(fit.length<=NAME_MAX,`${fit} (${fit.length})`);assert.ok(fit.endsWith('…'));
    assert.doesNotMatch(fit,/[\uD800-\uDBFF]…$/,'no half emoji');
  }
});
test('lobby and menu cut names with fitName (no slice mid-word left)',()=>{
  const lobby=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');
  const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
  assert.doesNotMatch(lobby,/slice\(0,NICK_MAX\)/);assert.doesNotMatch(main,/name\.slice\(0,20\)/);
  assert.match(lobby,/nickInput\.value=fitName\(name\)/);assert.match(lobby,/const nick=fitName\(nickInput\.value\)/);
  assert.match(main,/nickname=nameInput\.value=fitName\(nickname\)/,'the menu saves the cut name');
  assert.match(main,/<input id="nickname" maxlength="60"/,'a pasted long name reaches fitName instead of the browser cutting it');
});

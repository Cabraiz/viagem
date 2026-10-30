// UX-resultado-revanche: the collective rematch's button words, the defeat's "O que derrubou a turma" line and the
// shared picture's content (the canvas itself is checked in the browser shots).
import test from 'node:test';
import assert from 'node:assert/strict';
import {defeatLine,rematchLabel} from '../../src/client/hud/result.ts';
import {shareCard,shareHeight,SHARE_W,extraPrizes,SHARE_FOOTER} from '../../src/client/hud/share-result.ts';
import {readFileSync} from 'node:fs';
import {emptyCauses,recordFall} from '../../src/client/hud/cause.ts';

test('rematch button: an older room keeps its words; the vote counts people online; the majority shows its clock',()=>{
  assert.equal(rematchLabel(undefined,'a',false),'Revanche');
  assert.equal(rematchLabel(undefined,'a',true),'Esperando a galera…');
  const voters=['a','b','c','d','e','f'];
  assert.equal(rematchLabel({votes:['b','c','d'],voters},'a',false),'Revanche (3/6)');
  assert.equal(rematchLabel({votes:['a','b','c'],voters},'a',false),'Topei! (3/6)','the room says I voted');
  assert.equal(rematchLabel({votes:['b'],voters},'a',true),'Topei! (1/6)','tapped, the room has not answered yet');
  assert.equal(rematchLabel({votes:['a','b','c','d'],voters,leftTicks:130},'a',false),'Começa em 7 s (4/6)');
  assert.equal(rematchLabel({votes:['b','c','d','e'],voters,leftTicks:130},'a',false),'Revanche (4/6)','not voted: the button still asks');
  assert.equal(rematchLabel({votes:['x','b'],voters:['a','b']},'a',false),'Revanche (1/2)','a vote from someone gone does not count');
  assert.equal(rematchLabel({votes:[],voters:['a']},'a',false),'Revanche','solo: no count');
});

test('defeat line: the team\'s top cause with its falls, and the rounds left before the boss',()=>{
  const log=emptyCauses();recordFall(log,'a','tio-pave');recordFall(log,'b','tio-pave');recordFall(log,'b','bebado');
  recordFall(log,'c','tio-pave');recordFall(log,'d','tio-pave');
  assert.equal(defeatLine({victory:false,round:7,totalRounds:10},log),'O que derrubou a turma: Tio do Pavê (4 quedas). Faltou 3 rodadas pro síndico');
  assert.equal(defeatLine({victory:false,round:9,totalRounds:10},emptyCauses()),'Faltou 1 rodada pro síndico');
  assert.equal(defeatLine({victory:false,round:10,totalRounds:10},emptyCauses()),undefined);
  assert.equal(defeatLine({victory:true,round:10,totalRounds:10},log),undefined);
  const one=emptyCauses();recordFall(one,'a','bebado');
  assert.equal(defeatLine({victory:false,round:10,totalRounds:10},one),'O que derrubou a turma: Bêbado do Boteco (1 queda)');
});

test('shared picture: every player with their prizes, the first one big, a line for the chat',()=>{
  const card=shareCard({title:'DERROTA…',subtitle:'o agiota cobrou com juros'},[{id:'a',name:'Mateus'},{id:'b',name:'Tia Cleide'}],
    [{id:'rei-do-resgate',title:'Rei do resgate',icon:'boia' as never,playerId:'b',line:'5 resgates.'},{id:'mais-caiu',title:'Mais caiu',icon:'boia' as never,playerId:'a',line:'4 vezes.'}],'a');
  assert.deepEqual(card.rows,[{name:'Mateus',me:true,prizes:['Mais caiu']},{name:'Tia Cleide',me:false,prizes:['Rei do resgate']}]);
  assert.equal(card.text,'DERROTA… o agiota cobrou com juros. Eu levei "Mais caiu". Bora de revanche?');
  const none=shareCard({title:'VITÓRIA!',subtitle:'x'},[{id:'a',name:'Ana'}],[],'a');
  assert.deepEqual(none.rows[0].prizes,['Participou com garra']);
  assert.ok(shareHeight(6)<=1350&&SHARE_W===1080,'six players fit a 4:5 story picture');
});

test('shared picture speaks in sentences: the other prizes and the last line have no "A · B" (DSG-voz)',()=>{
  assert.equal(extraPrizes([]),'');
  assert.equal(extraPrizes(['Mais caiu']),'+ Mais caiu');
  assert.equal(extraPrizes(['Mais caiu','Pão-duro']),'+ Mais caiu e Pão-duro');
  assert.equal(extraPrizes(['Mais caiu','Pão-duro','Sumiu']),'+ Mais caiu, Pão-duro e Sumiu');
  assert.doesNotMatch(SHARE_FOOTER,/ · /);
  const src=readFileSync(new URL('../../src/client/hud/share-result.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g,''),/ · /,'no separator dot left in what the picture draws');
});

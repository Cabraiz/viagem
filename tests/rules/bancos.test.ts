// Bancos (card bancos-e-veiculos): every bank has its name and short name, never a real brand; the numbers keep the
// proposal's shape (a note is a whole number of the saldo, the fila is inside the hold, the prime after a few notes).
import test from 'node:test';
import assert from 'node:assert/strict';
import {BANK_IDS} from '../../src/contract/objective.ts';
import {BANCO,BANK_BEEP,BANK_EMPTY,BANK_LINES,BANK_NAMES,BANK_SHORT} from '../../src/rules/bancos.ts';

test('each bank id has a display name and a short one; the screen has its lines',()=>{
  for(const id of BANK_IDS){assert.ok(BANK_NAMES[id].length>0,id);assert.ok(BANK_SHORT[id].length>0&&BANK_SHORT[id].length<=16,id);}
  assert.equal(Object.keys(BANK_NAMES).length,BANK_IDS.length);
  assert.ok(BANK_LINES.length>=3);assert.equal(BANK_BEEP,'RETIRE SEU DINHEIRO');assert.equal(BANK_EMPTY,'SEM CÉDULAS');
  assert.ok(BANCO.count<=BANK_IDS.length,'one name per bank');
});

test('the numbers keep their shape: whole notes, the fila inside the hold, a prime after some notes',()=>{
  assert.equal(BANCO.saldo%BANCO.nota,0);
  assert.ok(BANCO.filaR<=BANCO.holdR&&BANCO.bichoR<BANCO.filaR);
  assert.ok(BANCO.primeCada>=BANCO.nota&&BANCO.primeCada%BANCO.nota===0);
  assert.ok(BANCO.desvio[0]<BANCO.desvio[1]&&BANCO.distCarro>0&&BANCO.recargaS>0&&BANCO.primeVida>1);
});

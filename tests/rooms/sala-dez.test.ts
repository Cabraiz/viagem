// NEW-20261024-ORQ-sala-ate-10-jogadores: the run and the room agree on the seats, and the room's texts say the cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PLAYERS,ROOM_FULL,ROOM_FULL_BOTS,playersWord} from '../../src/protocol/room.ts';
import {RUN_SLOTS} from '../../src/sim/run.ts';

test('the run has the room\'s seats, and the full-room texts name the cap in words',()=>{
  assert.equal(RUN_SLOTS,MAX_PLAYERS);
  assert.equal(playersWord(6),'seis');assert.equal(playersWord(10),'dez');
  assert.equal(ROOM_FULL,`Sala cheia. Máximo de ${playersWord()} jogadores.`);
  assert.match(ROOM_FULL_BOTS,new RegExp(`^Sala cheia: ${playersWord()} é o máximo`));
});

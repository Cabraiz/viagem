// erros-da-sala-dizem-o-que-fazer: the room and network lines say what happened and what to do, in the lobby's voice,
// and none sends the player to a screen that is gone (classes, heróis, o infinito, o dono, o lobby).
import test from 'node:test';
import assert from 'node:assert/strict';
import {JOIN_FAILED,LINK_LOST} from '../../src/client/net/client.ts';
import {CITY_FAILED} from '../../src/client/net/city-asset-loader.ts';
import {LEAVE_TEXT} from '../../src/client/hud/spectator.ts';
import {SEAT_EXPIRED,BAD_JOIN} from '../../multiplayer/room.ts';
import {GRACE_MS} from '../../src/protocol/room.ts';

const lines={JOIN_FAILED,CITY_FAILED,SEAT_EXPIRED,BAD_JOIN,LEAVE_TEXT};

test('each line names a way out, none points to a screen that no longer exists',()=>{
  assert.equal(JOIN_FAILED,'Não deu pra entrar na sala. Confere a internet e tenta de novo.');
  assert.equal(CITY_FAILED,'A cidade não baixou (a internet travou). Atualiza a página pra tentar de novo.');
  assert.equal(BAD_JOIN,'Nome ou herói inválido. Escolhe de novo.');
  for(const [name,text] of Object.entries(lines))assert.doesNotMatch(text,/classe|heróis e|infinito|dono|lobby|4G|novamente/i,name);
});

test('the expired seat tells the real grace time; "Voltar pra sala" matches net-fatal BACK_TO_ROOM',()=>{
  assert.equal(GRACE_MS,120_000);
  assert.equal(SEAT_EXPIRED,'Você ficou fora mais de 2 minutos e sua vaga foi liberada. Entra de novo pela sala.');
  assert.ok(new TextEncoder().encode(SEAT_EXPIRED).length<=123,'a WebSocket close reason fits');
  assert.equal(LEAVE_TEXT,'Voltar pra sala');
  assert.notEqual(JOIN_FAILED,LINK_LOST);
});

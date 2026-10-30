// Lobby errors in pt-BR (auditoria-erros-cliente E4): the browser's own messages never reach the player.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LOBBY_FAILED,LOBBY_OFFLINE,LOBBY_SLOW,SOLO_TEXT,lobbyErrorText} from '../../src/client/lobby.ts';
import {ROOMS_UNREACHABLE} from '../../src/client/ui/solo-plan.ts';

const lobby=readFileSync(new URL('../../src/client/lobby.ts',import.meta.url),'utf8');

test('each kind of failure gets its own pt-BR line, ours pass as they are',()=>{
  assert.equal(lobbyErrorText(new TypeError('Failed to fetch')),LOBBY_OFFLINE);
  assert.equal(lobbyErrorText(new DOMException('The operation was aborted due to timeout','TimeoutError')),LOBBY_SLOW);
  assert.equal(lobbyErrorText(new DOMException('signal is aborted without reason','AbortError')),LOBBY_SLOW);
  assert.equal(lobbyErrorText(new SyntaxError('Unexpected token <')),LOBBY_FAILED);
  assert.equal(lobbyErrorText(new Error('Sala cheia. Máximo de seis jogadores.')),'Sala cheia. Máximo de seis jogadores.');
  assert.equal(lobbyErrorText(new Error('')),LOBBY_FAILED);
  for(const e of [undefined,null,'boom',{message:'x'}])assert.equal(lobbyErrorText(e),LOBBY_FAILED);
  for(const text of [LOBBY_SLOW,LOBBY_OFFLINE,LOBBY_FAILED])assert.doesNotMatch(text,/fetch|timeout|token|Tente novamente/i);
});

test('the rooms address: one text for lobby and solo, asked again on Entrar/Criar and when the network comes back',()=>{
  assert.equal(SOLO_TEXT.noRooms,ROOMS_UNREACHABLE);
  assert.doesNotMatch(ROOMS_UNREACHABLE,/publicação|endereço/);
  assert.doesNotMatch(lobby,/publicação/);
  assert.match(lobby,/if\(!endpoint\)\{status\.textContent='Procurando o servidor das salas…';endpoint=await roomsEndpoint\(\)/);
  assert.match(lobby,/window\.addEventListener\('online',online\)/);
  assert.doesNotMatch(lobby,/e instanceof Error\?e\.message/);
});

test('the solo POST reads r.ok before trusting the body (a 502 page is not JSON)',()=>{
  assert.match(lobby,/const data=await r\.json\(\)\.catch\(\(\)=>\(\{\}\)\);\n\s*if\(!r\.ok\|\|typeof data\.code!=='string'\)/);
  assert.doesNotMatch(lobby,/const data=await r\.json\(\);/);
});

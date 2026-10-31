import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOOT_TEXT,COVER_SLOW_MS,SLOW_COVER,bootFailure,refusalExit,webglWorks} from '../../src/client/match-boot.ts';
import {KICKED_TITLE,REPLACED_MESSAGE,SOLO_ROOM_REFUSED,UPDATE_NEEDED} from '../../src/protocol/room.ts';

const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
const canvasDoc=(gl:Record<string,unknown>)=>({createElement:()=>({getContext:(kind:string)=>gl[kind]??null})}) as unknown as Document;

test('partida-que-nao-abre: no WebGL says so and only goes home; any other boot error retries or goes home',()=>{
  assert.equal(webglWorks(canvasDoc({})),false);
  assert.equal(webglWorks(canvasDoc({webgl:{}})),true);
  assert.equal(webglWorks(canvasDoc({webgl2:{}})),true);
  assert.equal(webglWorks({createElement:()=>{throw new Error('no canvas');}} as unknown as Document),false);
  assert.deepEqual(bootFailure(false),{kind:'no-webgl',text:BOOT_TEXT.noWebgl,exits:['home']});
  assert.deepEqual(bootFailure(true),{kind:'failed',text:BOOT_TEXT.failed,exits:['retry','home']});
  assert.deepEqual(SLOW_COVER.exits,['retry','home']);assert.equal(COVER_SLOW_MS,20_000);
  // The player's words: informal, no island, no "Volte aos heróis".
  for(const text of Object.values(BOOT_TEXT))assert.doesNotMatch(text,/ilha|Volte aos heróis|tente novamente/i,text);
});

test('partida-que-nao-abre: only a new version or another tab keeps the reload; every other refusal goes home',()=>{
  const exit=(message:string,kicked=false,linkLost=false)=>refusalExit(message,{kicked,linkLost});
  assert.equal(exit(UPDATE_NEEDED),'reload');
  assert.equal(exit('A cidade não baixou. Atualiza a página pra tentar de novo.'),'reload');
  assert.equal(exit(REPLACED_MESSAGE),'reload');
  for(const refused of ['Sala cheia. Máximo de seis jogadores.','Sua sessão expirou. Entre novamente.',SOLO_ROOM_REFUSED,'Nome inválido.'])
    assert.equal(exit(refused),'home',refused);
  assert.equal(exit('Tiraram você.',true),'kicked');
  assert.equal(exit('Conexão indisponível.',false,true),'room');
});

test('partida-que-nao-abre: explore.ts wires the windows (boot catch, 20 s cover, room refusals, labels)',()=>{
  // The boot catch: an old chunk keeps the version line; anything else gets the window with its ways out.
  assert.match(explore,/\}catch\(e\)\{if\(!closed\)\{clearTimeout\(coverSlow\);if\(chunkFailed\(e\)\)\$\('\.explore-loading'\)\.textContent='Saiu versão nova do jogo\.';else bootFatal\(bootFailure\(webglWorks\(\)\)\);\}\}/);
  // The cover: one line for every match, a window after COVER_SLOW_MS without ready(), taken down when it comes.
  assert.match(explore,/<div class="explore-loading" role="status">\$\{BOOT_TEXT\.loading\}<\/div>/);
  assert.match(explore,/const coverSlow=setTimeout\(\(\)=>\{if\(!closed&&!sceneReady&&!shell\.dataset\.fatal\)bootFatal\(SLOW_COVER\);\},COVER_SLOW_MS\);/);
  assert.match(explore,/ready:\(\)=>\{sceneReady=true;clearTimeout\(coverSlow\);if\(bootShown===SLOW_COVER\)hideBoot\(\);/);
  assert.match(explore,/if\(closed\)return;closed=true;active=false;clearTimeout\(coverSlow\);/);
  // The refusals: the kick keeps its title, LINK_LOST its way back to the room, the rest goes home.
  assert.match(explore,/const exit=refusalExit\(net\.fatal,\{kicked:net\.kicked,linkLost:net\.fatal===LINK_LOST\}\)/);
  assert.match(explore,/exit==='kicked'\?\{title:KICKED_TITLE,action:home\}:exit==='home'\?\{action:home\}:/);
  assert.equal(KICKED_TITLE,'Tiraram você da sala');
  // Labels a screen reader always reads: no island.
  assert.match(explore,/shell\.setAttribute\('aria-label','Partida'\)/);
  assert.match(explore,/<section class="explore-stage" aria-label="Mapa da partida">/);
  assert.doesNotMatch(explore,/Arrumando a (cidade|ilha)|Não foi possível carregar a (ilha|o mapa)/);
});

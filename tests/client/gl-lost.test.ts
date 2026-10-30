import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GL_LOST_TEXT,GL_LOST_BUTTON,watchGlLoss,glLostTarget} from '../../src/client/render/gl-lost.ts';

test('a lost context calls lost once, a restore calls restored, and the unsubscribe stops both',()=>{
  const canvas=new EventTarget(),calls:string[]=[];
  const stop=watchGlLoss(canvas,{lost:()=>calls.push('lost'),restored:()=>calls.push('restored')});
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  canvas.dispatchEvent(new Event('webglcontextlost'));canvas.dispatchEvent(new Event('webglcontextlost'));
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.deepEqual(calls,['lost','restored']);
  stop();canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.deepEqual(calls,['lost','restored']);
});

test('the panel speaks plainly and names its button',()=>{
  assert.match(GL_LOST_TEXT,/apagou/);assert.match(GL_LOST_TEXT,/sem memória/);
  assert.ok(GL_LOST_TEXT.includes(GL_LOST_BUTTON));
  assert.doesNotMatch(GL_LOST_TEXT,/webgl|context|gpu/i);
});

test('with the panel up only the panel shows: the whole layout hides under data-fatal, and both panels set it',()=>{
  const css=readFileSync(new URL('../../src/client/net-fatal.css',import.meta.url),'utf8');
  assert.match(css,/dialog\.explore-shell\[data-fatal=true\] \.explore-layout>:not\(\.net-fatal\)\{visibility:hidden\}/);
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  // The room's window (net.fatal) and the lost GL both mark the shell; "Reconectar" and the GL restore take it off.
  assert.equal(explore.match(/shell\.dataset\.fatal='true'/g)?.length,2);
  assert.equal(explore.match(/delete shell\.dataset\.fatal/g)?.length,2);
});

test('coop goes back through the room link, solo reloads',()=>{
  assert.equal(glLostTarget('ABCD','&convite=1'),'/?room=ABCD&convite=1#personagem');
  assert.equal(glLostTarget(undefined,''),undefined);
});

test("the panel speaks the game's informal Portuguese (glossário 29/10: Toca, not Toque)",()=>{
  assert.equal(GL_LOST_TEXT,'A tela do jogo apagou (o celular ficou sem memória). Toca em Voltar pra partida.');
  assert.doesNotMatch(GL_LOST_TEXT,/Toque/);
});

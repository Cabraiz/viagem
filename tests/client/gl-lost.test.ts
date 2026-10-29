import {test} from 'node:test';
import assert from 'node:assert/strict';
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

test('coop goes back through the room link, solo reloads',()=>{
  assert.equal(glLostTarget('ABCD','&convite=1'),'/?room=ABCD&convite=1#personagem');
  assert.equal(glLostTarget(undefined,''),undefined);
});

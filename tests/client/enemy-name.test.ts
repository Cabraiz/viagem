// The enemy's name in the world (card nome-inimigo-rede-social, etapa 7, render/enemy-name-rules.ts): the profile's name
// over an elite or a boss only, the wave chefão's own name, "Te derrubou: X" under the hero's caído ficha, and none for
// the dark or an unknown kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_NAME_MAX,enemyName,enemyNameTag,fallenByText} from '../../src/client/render/enemy-name-rules.ts';
import {perfilOf} from '../../src/client/hud/perfis.ts';
import {FEAR_SOURCE,ROSTER,WAVE_BOSSES} from '../../src/rules/index.ts';

test('the name is the profile\'s (the roster\'s), the same the dating-app card shows', () => {
  assert.equal(enemyName('tio-pave'),'Tio do Pavê');
  assert.equal(enemyName('chefe'),'Síndico Supremo');
  for(const e of ROSTER){const p=perfilOf(e.id);if(p&&p.name.length<=ENEMY_NAME_MAX)assert.equal(enemyName(e.id),p.name,e.id);}
});

test('every roster name fits whole (none is cut today); past the cap it ends in an ellipsis', () => {
  for(const e of ROSTER){const n=enemyName(e.id)!;assert.ok(n.length<=ENEMY_NAME_MAX,e.id);if(e.name.length>ENEMY_NAME_MAX)assert.ok(n.endsWith('…'),e.id);}
});

test('a wave chefão goes by his bar name, not the caps of his scene title', () => {
  for(const b of WAVE_BOSSES){const n=enemyName(b.id)!;assert.notEqual(n,b.name,b.id);assert.ok(b.bar.startsWith(n.replace(/…$/,'')),b.id);}
});

test('the ficha is only over an elite or a boss', () => {
  assert.equal(enemyNameTag('bebado',false,false),undefined);
  assert.equal(enemyNameTag('bebado',true,false),'Bêbado do Boteco');
  assert.equal(enemyNameTag('chefe',false,true),'Síndico Supremo');
  assert.equal(enemyNameTag('nao-existe',true,true),undefined);
});

test('the hero\'s fall reads "Te derrubou: X"; nothing for the dark or an unknown hitter', () => {
  assert.equal(fallenByText('agiota'),'Te derrubou: Agiota do Bairro');
  assert.equal(fallenByText(FEAR_SOURCE),undefined);
  assert.equal(fallenByText('bichos'),undefined);
  assert.equal(fallenByText(undefined),undefined);
});

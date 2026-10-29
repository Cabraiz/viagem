import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseArtIndex} from '../../src/client/art/manifest.ts';
import {testeInimigo,trocarInimigos} from '../../src/client/art/teste-inimigo.ts';

const raw={version:2,groups:{
  inimigos:{output:'public/art/enemies',pieces:{a:{kind:'animations',files:{walk:{file:'a/walk.webp',cell:[160,160]}}},b:{kind:'animations',files:{idle:{file:'b/idle.webp',cell:[160,160]}}}}},
  itens:{output:'public/art/items',pieces:{x:{kind:'sheet',files:{sheet:{file:'x.webp',cell:[64,64]}}}}},
}};

test('teste ?inimigo=mendigo: lê a chave da URL e ignora ids desconhecidos',()=>{
  assert.equal(testeInimigo('?inimigo=mendigo'),'mendigo');
  assert.equal(testeInimigo('?inimigo=outro'),undefined);
  assert.equal(testeInimigo(''),undefined);
});
test('teste ?inimigo=mendigo: troca todos os inimigos pelo parado do mendigo, com camada de elite, e deixa o resto',()=>{
  const idx=trocarInimigos(parseArtIndex(raw),'mendigo');
  for(const id of ['a','b']){
    const p=idx.groups.inimigos.pieces[id];
    assert.deepEqual(Object.keys(p.files).sort(),['elite/idle','idle']);
    assert.equal(p.files.idle.file,'teste-mendigo/idle.webp');
  }
  assert.deepEqual(idx.groups.itens,parseArtIndex(raw).groups.itens);
});
test('teste ?inimigo=mendigo: sem a chave nada muda',()=>{
  const idx=parseArtIndex(raw);
  assert.equal(trocarInimigos(idx,undefined),idx);
});

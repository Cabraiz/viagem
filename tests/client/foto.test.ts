// D-049 (card modo-foto-navegador-compartilhado): the modo foto's scene registry and its page query; tools/foto.mjs
// reads the scene names from the registry's source, so its format is pinned here too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FOTO_CENAS,fotoClock,fotoSearch} from '../../src/client/dev/foto.ts';

test('a scene opens its sandbox with its parameters and foto=<cena>; the caller\'s extras win; unknown → undefined',()=>{
  const q=new URLSearchParams(fotoSearch('chaveiro-morta','?foto=chaveiro-morta')!.slice(1));
  assert.equal(q.get('sandbox'),'cidade');assert.equal(q.get('objetivo'),'1');assert.equal(q.get('moto'),'morta');assert.equal(q.get('foto'),'chaveiro-morta');
  const extra=new URLSearchParams(fotoSearch('chaveiro-morta','?foto=chaveiro-morta&view=2&empurra=.2&sandbox=hud')!.slice(1));
  assert.equal(extra.get('view'),'2');assert.equal(extra.get('empurra'),'.2','an extra overrides the scene');assert.equal(extra.get('sandbox'),'cidade','not the sandbox');
  assert.equal(fotoSearch('nada',''),undefined);
  // The HUD prints without the sandbox's state buttons (varredura do celular); the city has none to hide.
  assert.equal(new URLSearchParams(fotoSearch('oferta','')!.slice(1)).get('clean'),'1');
  assert.equal(new URLSearchParams(fotoSearch('chaveiro-morta','')!.slice(1)).has('clean'),false);
});

test('the fixed clock: t from the page, else 2000 ms',()=>{
  assert.equal(fotoClock('?foto=x'),2000);assert.equal(fotoClock('?foto=x&t=6000'),6000);assert.equal(fotoClock('?t=0'),0);assert.equal(fotoClock('?t=abc'),2000);
});

test('the scenes: the 9 chaveiro states, the city with the ruler, the HUD, the obra; every sandbox known',()=>{
  const names=Object.keys(FOTO_CENAS);
  for(const s of ['anda','lombada','volta','morta','entrega','tombo','abrindo','vitoria','derrota'])assert.ok(names.includes(`chaveiro-${s}`),s);
  for(const s of ['cidade-regua','oferta','forja','resultado','minimapa','obra','hud-topo','config-jogo','config-menu'])assert.ok(names.includes(s),s);
  for(const [name,s] of Object.entries(FOTO_CENAS)){
    assert.match(name,/^[a-z0-9-]+$/);assert.ok(['cidade','hud','obra','config'].includes(s.sandbox));assert.ok(s.descricao.length>3,name);
    assert.doesNotMatch(s.query,/(^|&)(sandbox|foto)=/,`${name}: the registry adds them`);
  }
  // tools/foto.mjs lists the scenes with this pattern over the source: one `'name':{` per line, in this order.
  const src=readFileSync(new URL('../../src/client/dev/foto.ts',import.meta.url),'utf8');
  assert.deepEqual([...src.matchAll(/^\s+'([a-z0-9-]+)':\{/gm)].map(m=>m[1]),names);
});

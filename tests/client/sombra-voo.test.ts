// BUG-20261017-ORQ-sombra-longe-personagem-pequeno: the enxame role draws as 'pombos' (its base kind), so the walkers of
// that role (rato-de-boteco, cachorro-de-madame, dominó…) took the pigeons' hover (26 px) and zig-zag and floated far
// above their contact shadow. Only an art with a `fly` animation flies now.
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
import {enemyArtFlies} from '../../src/client/art/horde-art.ts';
import {enemyKind} from '../../src/client/render/keys.ts';
import {ROSTER} from '../../src/rules/index.ts';

const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const enemies=JSON.parse(read('public/art/enemies/manifest.json')) as {pieces:Record<string,{files:Record<string,unknown>}>};
const useRealArt=()=>setArtIndex(parseArtIndex({version:2,groups:{inimigos:{output:'public/art/enemies',pieces:enemies.pieces}}}));
afterEach(()=>setArtIndex(parseArtIndex({version:2,groups:{}})));

test('the enxame walkers are drawn as pombos but do not fly: no hover, they stand on their shadow',()=>{
  useRealArt();
  for(const id of ['rato-de-boteco','cachorro-de-madame'])assert.equal(enemyKind(id),'pombos',`${id}: drawn with the pigeons' base kind`);
  assert.equal(enemyArtFlies('pombos'),true);assert.equal(enemyArtFlies('barata-voadora'),true);
  assert.equal(enemyArtFlies('rato-de-boteco'),false,'the brown rat in the user print walks');
  assert.equal(enemyArtFlies('cachorro-de-madame'),false);
  assert.equal(enemyArtFlies('nao-existe'),undefined);assert.equal(enemyArtFlies(undefined),undefined);
  // Every enxame/voador with art: it flies exactly when its sheet has a fly animation.
  for(const e of ROSTER.filter(r=>r.role==='enxame'||r.role==='voador')){
    const piece=enemies.pieces[e.id];if(!piece)continue;
    assert.equal(enemyArtFlies(e.id),Object.hasOwn(piece.files,'fly'),e.id);
  }
});

test('the renderer lifts (hover, flap, death) only what flies',()=>{
  const layers=read('src/client/render/layers.ts');
  assert.match(layers,/const flying=a\.kind==='pombos'&&enemyArtFlies\(a\.art\)!==false;/);
  assert.match(layers,/let lift=a\.kind==='pombos'&&!flying\?0:art\.hover/);
  assert.match(layers,/if\(flying&&!this\.reduced\)\{/);
  assert.match(layers,/d\.lift=k==='pombos'&&enemyArtFlies\(art\)===false\?0:/);
});

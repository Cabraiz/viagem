/**
 * Art index robustness (NEW-20261012-ORQ-importar-arte-b-ligacao review): /art/manifest.json is public and the client
 * builds URLs from it, so malformed groups, pieces and files are dropped one by one and nothing throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArtIndex,setArtIndex,artPiece,artUrl,hasArt} from '../../src/client/art/manifest.ts';
import {icon} from '../../src/client/ui/icon.ts';

const good={kind:'icon',files:{sheet:{file:'boia.webp',cell:[128,128]}}};

test('a valid index is kept; the empty or wrong-version index is empty',()=>{
  const idx=parseArtIndex({version:2,groups:{ui:{output:'public/art/ui',pieces:{boia:good}}}});
  setArtIndex(idx);
  assert.ok(hasArt('ui','boia'));
  assert.equal(artUrl('ui','boia.webp'),'/art/ui/boia.webp');
  assert.deepEqual(parseArtIndex({version:1,groups:{}}).groups,{});
  for(const bad of [null,undefined,42,'x',[],{version:2},{version:2,groups:[]}])assert.deepEqual(Object.keys(parseArtIndex(bad).groups),[]);
});

test('__proto__ and other unsafe keys never reach the index (no prototype pollution, no foreign URL)',()=>{
  const raw=JSON.parse('{"version":2,"groups":{"__proto__":{"output":"public/art/x","pieces":{"boia":{"kind":"icon","files":{"sheet":{"file":"a.webp","cell":[128,128]}}}}},"ui":{"output":"public/art/ui","pieces":{"__proto__":{"kind":"icon","files":{"sheet":{"file":"a.webp","cell":[1,1]}}},"constructor":{"kind":"icon","files":{}}}}}}');
  const idx=parseArtIndex(raw);
  setArtIndex(idx);
  assert.equal(Object.getPrototypeOf(idx.groups),null);
  assert.deepEqual(Object.keys(idx.groups),['ui']);
  assert.deepEqual(Object.keys(idx.groups.ui.pieces),[]);
  assert.equal(artPiece('ui','boia'),undefined);
  assert.match(icon('boia'),/^<svg /,'falls back to the SVG');
});

test('malformed pieces and files are dropped one by one; icon() never throws',()=>{
  const idx=parseArtIndex({version:2,groups:{ui:{output:'public/art/ui',pieces:{
    vazio:{},semArquivos:{kind:'icon'},
    fora:{kind:'icon',files:{sheet:{file:'../../../etc/x.webp',cell:[128,128]}}},
    externo:{kind:'icon',files:{sheet:{file:'//evil.example/a.webp',cell:[128,128]}}},
    esquema:{kind:'icon',files:{sheet:{file:'http:/a.webp',cell:[128,128]}}},
    semCelula:{kind:'icon',files:{sheet:{file:'a.webp'}}},
    paginaRuim:{kind:'icon',files:{sheet:{pages:[{file:'a.webp',columns:-1,rows:1,firstFrame:0,frameCount:1}],cell:[64,64]}}},
    boia:good,
  }},bad:{output:'https://evil.example/',pieces:{boia:good}},sobe:{output:'public/art/../../x',pieces:{boia:good}}}});
  setArtIndex(idx);
  assert.deepEqual(Object.keys(idx.groups),['ui']);
  assert.deepEqual(Object.keys(idx.groups.ui.pieces),['boia']);
  for(const id of ['vazio','semArquivos','fora','externo','esquema','semCelula','paginaRuim']){
    assert.equal(hasArt('ui',id),false,id);
    assert.doesNotThrow(()=>icon(id));
  }
  assert.match(icon('boia'),/src="\/art\/ui\/boia\.webp"/);
});

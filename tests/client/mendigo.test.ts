import {test} from 'node:test';
import assert from 'node:assert/strict';
import {artPiece,loadArtManifest,parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {MENDIGO,gameEnemyArt,keepsOwnArt,withMendigo} from '../../src/client/art/mendigo.ts';
import {enemyArtId,enemyPieceLoads} from '../../src/client/art/horde-art.ts';
import {WAVE_BOSS_IDS} from '../../src/rules/index.ts';

const raw={version:2,groups:{
  inimigos:{output:'public/art/enemies',pieces:{bebado:{kind:'animations',files:{walk:{file:'bebado/walk.webp',cell:[160,160]}}},chefe:{kind:'animations',files:{idle:{file:'chefe/idle.webp',cell:[384,384]}}}}},
  itens:{output:'public/art/items',pieces:{x:{kind:'sheet',files:{sheet:{file:'x.webp',cell:[64,64]}}}}},
}};

test('só o mendigo: todo inimigo comum desenha o mendigo; chefões e a aberração-saci ficam com a arte própria',()=>{
  for(const id of ['bebado','pombos','tio-pave','agiota','coach','rato-de-boteco'])assert.equal(gameEnemyArt(id),MENDIGO,id);
  for(const id of ['chefe','rainha-das-baratas','rei-do-boteco',...WAVE_BOSS_IDS,'aberracao-saci'])assert.ok(keepsOwnArt(id),id);
  assert.equal(enemyArtId('bebado','bebado'),MENDIGO);
  assert.equal(enemyArtId('rato-de-boteco','pombos'),MENDIGO);
  assert.equal(enemyArtId('chefe','chefe'),'chefe');
});
test('só o mendigo: a peça entra no grupo inimigos com parado, andar em 8 direções e a mesma folha como camada de elite',()=>{
  const idx=withMendigo(parseArtIndex(raw)),p=idx.groups.inimigos.pieces[MENDIGO];
  assert.deepEqual(Object.keys(p.files).sort(),['elite/idle','elite/walk','idle','walk']);
  assert.equal(p.files.idle.file,'mendigo/idle.webp');
  assert.equal(p.files['elite/walk'],p.files.walk);
  const w=p.files.walk;
  assert.equal(w.directions,8);assert.equal(w.frames,16);
  assert.deepEqual(w.pages?.map(pg=>[pg.file,pg.firstFrame,pg.frameCount]),
    ['S','SW','W','NW','N','NE','E','SE'].map((d,i)=>[`mendigo/walk-${d}.webp`,i*16,16]));
  // As outras peças e grupos ficam como estavam.
  assert.ok(idx.groups.inimigos.pieces.chefe);
  assert.deepEqual(idx.groups.itens,parseArtIndex(raw).groups.itens);
  assert.equal(withMendigo(parseArtIndex({})).groups.inimigos,undefined);
});
test('só o mendigo: o carregamento do manifest põe a peça, e a horda pede só as folhas do mendigo (lite)',async()=>{
  try{
    await loadArtManifest(async()=>({ok:true,json:async()=>raw}));
    assert.equal(artPiece('inimigos',MENDIGO)?.files.idle?.file,'mendigo/idle.webp');
    const urls=[...new Set(enemyPieceLoads(MENDIGO).map(l=>l.url))].sort();
    assert.equal(urls.length,9);
    assert.ok(urls.every(u=>u.startsWith('/art/lite/enemies/mendigo/')),urls.join());
  }finally{setArtIndex(parseArtIndex({}));}
});

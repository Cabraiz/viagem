import {test} from 'node:test';
import assert from 'node:assert/strict';
import {artPiece,loadArtManifest,parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {MENDIGO,MENDIGO_FALTA,eliteCrownOf,gameEnemyArt,keepsOwnArt,withMendigo} from '../../src/client/art/mendigo.ts';
import {enemyArtId,enemyPieceLoads} from '../../src/client/art/horde-art.ts';
import {WAVE_BOSS_IDS} from '../../src/rules/index.ts';
import {MENDIGO_NAME,enemyName,enemyNameTag,fallenByText} from '../../src/client/render/enemy-name-rules.ts';

const raw={version:2,groups:{
  inimigos:{output:'public/art/enemies',pieces:{bebado:{kind:'animations',files:{walk:{file:'bebado/walk.webp',cell:[160,160]}}},chefe:{kind:'animations',files:{idle:{file:'chefe/idle.webp',cell:[384,384]}}}}},
  itens:{output:'public/art/items',pieces:{x:{kind:'sheet',files:{sheet:{file:'x.webp',cell:[64,64]}}}}},
}};

test('só o mendigo: todo inimigo comum desenha o mendigo; chefões e a aberração-saci ficam com a arte própria',()=>{
  // sem a peça no índice, nada troca
  setArtIndex(parseArtIndex(raw));
  assert.equal(gameEnemyArt('bebado'),'bebado');
  setArtIndex(withMendigo(parseArtIndex(raw)));
  try{
  for(const id of ['bebado','pombos','tio-pave','agiota','coach','rato-de-boteco'])assert.equal(gameEnemyArt(id),MENDIGO,id);
  for(const id of ['chefe','rainha-das-baratas','rei-do-boteco',...WAVE_BOSS_IDS,'aberracao-saci'])assert.ok(keepsOwnArt(id),id);
  assert.equal(enemyArtId('bebado','bebado'),MENDIGO);
  assert.equal(enemyArtId('rato-de-boteco','pombos'),MENDIGO);
  assert.equal(enemyArtId('chefe','chefe'),'chefe');
  }finally{setArtIndex(parseArtIndex({}));}
});
test('mendigo completo: parado e andar em 8 direções, golpe, dano e morte; as camadas elite/ são a mesma folha',()=>{
  const idx=withMendigo(parseArtIndex(raw)),p=idx.groups.inimigos.pieces[MENDIGO],D=['S','SW','W','NW','N','NE','E','SE'];
  const anims=['attack','death','hit','idle','walk'];
  assert.deepEqual(Object.keys(p.files).sort(),[...anims,...anims.map(a=>`elite/${a}`),'elite/coroa'].sort());
  assert.deepEqual(MENDIGO_FALTA,[]);
  for(const a of anims)assert.equal(p.files[`elite/${a}`],p.files[a],a);
  for(const a of ['idle','walk']){
    const f=p.files[a];
    assert.equal(f.directions,8);assert.equal(f.frames,16);
    assert.deepEqual(f.pages?.map(pg=>[pg.file,pg.firstFrame,pg.frameCount,pg.columns,pg.rows]),D.map((d,i)=>[`mendigo/${a}-${d}.webp`,i*16,16,4,4]));
  }
  for(const [a,n] of [['attack',6],['hit',6],['death',8]] as const){
    const f=p.files[a];
    assert.deepEqual([f.cell,f.frames,f.directions,f.anchor],[[192,192],n,8,[.5,.9]],a);
    assert.deepEqual(f.pages?.map(pg=>[pg.file,pg.columns,pg.rows,pg.frameCount]),[[`mendigo/${a}.webp`,n,8,n*8]],a);
  }
  // As outras peças e grupos ficam como estavam.
  assert.ok(idx.groups.inimigos.pieces.chefe);
  assert.deepEqual(idx.groups.itens,parseArtIndex(raw).groups.itens);
  assert.equal(withMendigo(parseArtIndex({})).groups.inimigos,undefined);
});
test('mendigo completo: a elite é a coroa por cima, com um ponto do capuz em cada quadro de cada animação',()=>{
  const p=withMendigo(parseArtIndex(raw)).groups.inimigos.pieces[MENDIGO],c=eliteCrownOf(MENDIGO);
  assert.ok(c);assert.equal(eliteCrownOf('bebado'),undefined);
  assert.equal(p.files[c.name]?.file,'mendigo/coroa.webp');
  assert.equal(c.widths.length,8);
  for(const a of ['idle','walk','attack','hit','death']){
    const f=p.files[a],pts=c.points[a];
    assert.equal(pts?.length,(f.frames??1)*(f.directions??1)*2,a);
    // o topo do capuz fica dentro da célula, acima do pé
    for(let i=0;i<pts.length;i+=2){assert.ok(pts[i]>0&&pts[i]<c.cell,`${a} x ${i/2}`);assert.ok(pts[i+1]>0&&pts[i+1]<c.cell*.9,`${a} y ${i/2}`);}
  }
});
test('só o mendigo: o carregamento do manifest põe a peça, e a horda pede só as folhas do mendigo (lite)',async()=>{
  try{
    await loadArtManifest(async()=>({ok:true,json:async()=>raw}));
    assert.equal(artPiece('inimigos',MENDIGO)?.files.idle?.file,'mendigo/idle-S.webp');
    // a camada de elite é a mesma folha: não carrega de novo (uma textura por folha); 8 parado + 8 andar + golpe, dano,
    // morte e a coroa
    assert.equal(enemyPieceLoads(MENDIGO).length,20);
    const urls=[...new Set(enemyPieceLoads(MENDIGO).map(l=>l.url))].sort();
    assert.equal(urls.length,20);
    assert.ok(urls.every(u=>u.startsWith('/art/lite/enemies/mendigo/')),urls.join());
  }finally{setArtIndex(parseArtIndex({}));}
});
test('só o mendigo: um nome só na tela, "Morador de Rua" (Mendigo é herói); chefões e saci com o nome próprio',()=>{
  setArtIndex(withMendigo(parseArtIndex(raw)));
  try{
    for(const id of ['bebado','tio-pave','agiota','pombos'])assert.equal(enemyName(id),MENDIGO_NAME,id);
    assert.equal(fallenByText('agiota'),'Te derrubou: Morador de Rua');
    assert.equal(enemyNameTag('bebado',true,false),'Morador de Rua');
    assert.equal(enemyName('chefe'),'Síndico Supremo');
    for(const b of WAVE_BOSS_IDS)assert.notEqual(enemyName(b),MENDIGO_NAME,b);
    assert.equal(enemyName('nao-existe'),undefined);
  }finally{setArtIndex(parseArtIndex({}));}
  // sem a peça (índice à mão), cada um com o seu
  assert.equal(enemyName('tio-pave'),'Tio do Pavê');
});

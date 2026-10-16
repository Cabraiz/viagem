// The banks' imported art (card bancos-arte-render): one piece per bank in E8's `cenario` group (sheet + anim-tela-* +
// anim-sacando, decor.mjs), looked up in any group; a bank with any file missing keeps the provisional figure; frames
// per camera view (views in rows, frames across); the layers' corner from the machine's meta.tela.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {ArtFile,ArtIndex,ArtPiece} from '../../src/client/art/manifest.ts';
import {BANK_FILES,BANK_NAMES,bankArt,bankSheets,bankTextureKey,sacandoFrame,sheetFrame,telaOffset} from '../../src/client/render/bancos/art.ts';

const TELA={'0':[49,135],'90':[58,139],'180':[55,131],'270':[53,129]};
/** One bank's piece as E8's importer writes it (decor.mjs): the machine at the world's scale, its layers as anim-<suffix>. */
function piece(name:string,skip?:string):ArtPiece{
  // As decor.mjs writes them (vgm/cenario-novo cbec981): one page, fps on the file too.
  const layer=(f:string,frames=1)=>({file:`${name}/${f}.webp`,cell:[108,108] as [number,number],frames,views:4,fps:10,
    pages:[{file:`${name}/${f}.webp`,columns:frames,rows:4,firstFrame:0,frameCount:frames*4}]});
  const files:Record<string,ArtFile>={
    sheet:{file:`${name}/sheet.webp`,cell:[215,323],views:4,anchor:[.5,.85]},
    'anim-tela-apagada':layer('anim-tela-apagada'),'anim-tela-azul':layer('anim-tela-azul'),
    'anim-tela-verde':layer('anim-tela-verde'),'anim-tela-vermelha':layer('anim-tela-vermelha'),
    'anim-sacando':layer('anim-sacando',6),
  };
  if(skip)delete files[skip];
  return {kind:'decor',files,meta:{footprint:[1,1],tela:TELA,anims:{sacando:TELA},fps:{sacando:12},loop:{sacando:true}}};
}
const index=(p:Record<string,ArtPiece>):ArtIndex=>({version:2,groups:{
  predios:{output:'public/art/city/buildings',pieces:{}},
  cenario:{output:'public/art/city/decor',pieces:p},
}});
const full=index({juros:piece('juros'),'pao-duro':piece('pao-duro'),posto:piece('posto')});

test('art: the piece\'s 6 files in any group → sheets with that group\'s urls; the screen looks map to the art\'s layers',()=>{
  const art=bankArt(full,'juros');
  assert.ok(art);
  assert.equal(art.body.url,'/art/city/decor/juros/sheet.webp');
  assert.equal(art.body.key,bankTextureKey('juros','sheet'));
  assert.deepEqual(art.body.cell,[215,323]);
  assert.equal(art.tela.vermelho.url,'/art/city/decor/juros/anim-tela-vermelha.webp');
  assert.equal(art.tela.apagado.url,'/art/city/decor/juros/anim-tela-apagada.webp');
  assert.deepEqual({frames:art.sacando.frames,fps:art.sacando.fps},{frames:6,fps:10},'the fps of the file');
  assert.deepEqual(art.anchor,[.5,.85]);
  assert.deepEqual(art.telaAt,[[49,135],[58,139],[55,131],[53,129]]);
  assert.equal(bankSheets(full).length,18);
  assert.equal(new Set(bankSheets(full).map(s=>s.key)).size,18);
});

test('art: any file missing (or no meta.tela) → undefined, that bank keeps the provisional figure; the others still load',()=>{
  assert.equal(BANK_NAMES.length,3);
  for(const f of BANK_FILES){
    const idx=index({juros:piece('juros'),posto:piece('posto',f)});
    assert.equal(bankArt(idx,'posto'),undefined,f);
    assert.ok(bankArt(idx,'juros'));
    assert.equal(bankSheets(idx).length,6);
  }
  const noTela=piece('juros');delete noTela.meta;
  assert.equal(bankArt(index({juros:noTela}),'juros'),undefined);
  assert.deepEqual(bankSheets({version:2,groups:{}}),[]);
});

test('frames: view row × frames + frame; a 1-view sheet is the same in every view; the loop at fps',()=>{
  const body={frames:1,views:4},sac={frames:6,views:4,fps:10};
  assert.deepEqual([0,1,2,3].map(v=>sheetFrame(body,v)),[0,1,2,3]);
  assert.equal(sheetFrame(body,5),1);
  assert.equal(sheetFrame({frames:1,views:1},3),0);
  assert.equal(sheetFrame(sac,2,4),16);
  assert.equal(sheetFrame(sac,3,99),23,'clamped to the last frame');
  assert.deepEqual([0,100,250,599,600].map(t=>sacandoFrame(sac,t,false)),[0,1,2,5,0]);
  assert.equal(sacandoFrame(sac,12345,true),2,'reduced motion: a still with the note in the slot');
});

test('screen overlay: its corner from meta.tela, relative to the kiosk\'s foot (anchor × cell)',()=>{
  const art=bankArt(full,'pao-duro');assert.ok(art);
  // foot at (107.5, 274.55) of the 215×323 cell
  assert.deepEqual(telaOffset(art,0),{x:49-107.5,y:135-323*.85});
  assert.deepEqual(telaOffset(art,3),{x:53-107.5,y:129-323*.85});
  assert.deepEqual(telaOffset(art,4),telaOffset(art,0));
});

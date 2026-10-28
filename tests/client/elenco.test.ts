// Modo foto `elenco-roster` (D-049): the roster contact sheet's selection, grid, pages and game-size scales.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ELENCO_ANTES,ELENCO_DIRS,elencoGrade,elencoIds,elencoPagina,elencoPaginas,elencoZoom,enemyEscala,heroEscala,caixaMundo,tileMundo} from '../../src/client/dev/elenco.ts';
import {ENEMY_ART_IDS} from '../../src/rules/index.ts';
import {HERO_DRAW_SCALE,ENEMY_DRAW_SCALE} from '../../src/client/render/draw-scale.ts';

test('the rows shown are S, SE and E of the importer order S,SW,W,NW,N,NE,E,SE',()=>{
  assert.deepEqual(ELENCO_DIRS.map(d=>[d.nome,d.row]),[['S',0],['SE',7],['E',6]]);
});

test('selection: all by default; ids= keeps its order and only ids with art; novos=1 drops the earlier list (or antes=)',()=>{
  assert.deepEqual(elencoIds('').ids,[...ENEMY_ART_IDS]);
  for(const id of ELENCO_ANTES)assert.ok(ENEMY_ART_IDS.includes(id),id);
  assert.equal(elencoIds('?novos=1').ids.length,ENEMY_ART_IDS.length-ELENCO_ANTES.length);
  assert.deepEqual(elencoIds('?ids=bolo-vivo,nada,boleto-vivo,bolo-vivo'),{ids:['bolo-vivo','boleto-vivo'],desconhecidos:['nada']});
  assert.deepEqual(elencoIds('?ids=bolo-vivo,grauzeiro&novos=1').ids,['bolo-vivo']);
  assert.deepEqual(elencoIds('?ids=bolo-vivo,grauzeiro&novos=1&antes=bolo-vivo').ids,['grauzeiro']);
});

test('grid from the screen only: 3×3 on 1335×620, 1×5 on 390×844; pages for the 40 and the 24 new',()=>{
  const pc=elencoGrade(1335,620),cel=elencoGrade(390,844);
  assert.deepEqual([pc.cols,pc.rows],[3,3]);assert.deepEqual([cel.cols,cel.rows],[1,5]);
  assert.ok(pc.cw*pc.cols<=1335&&pc.ch*pc.rows<=620&&cel.cw<=390&&cel.ch*cel.rows<=844);
  assert.equal(elencoPaginas(40,pc.porPagina),5);assert.equal(elencoPaginas(24,pc.porPagina),3);
  assert.equal(elencoPaginas(40,cel.porPagina),8);assert.equal(elencoPaginas(24,cel.porPagina),5);
  const p=elencoPagina([1,2,3,4,5,6,7],3,3);assert.deepEqual([p.itens,p.pagina,p.paginas],[[7],3,3]);
  assert.equal(elencoPagina([1,2],99,3).pagina,1,'clamped');assert.equal(elencoPagina([1,2],Number.NaN,3).pagina,1);
});

test('game sizes: an enemy figure reaches its role target × ENEMY_DRAW_SCALE, the hero 96 × HERO_DRAW_SCALE',()=>{
  assert.ok(Math.abs(heroEscala(101)*101-96*HERO_DRAW_SCALE)<1e-9);
  assert.ok(Math.abs(enemyEscala('bolo-vivo',124,160)*124-96*1.3*ENEMY_DRAW_SCALE)<1e-9,'brutamontes');
  assert.ok(Math.abs(enemyEscala('boleto-vivo',44,64)*44-96*.5*ENEMY_DRAW_SCALE)<1e-9,'enxame');
  assert.ok(Math.abs(enemyEscala('grauzeiro',undefined,160)*160*.88-96*.9*ENEMY_DRAW_SCALE)<1e-9,'unmeasured: the cell rule');
});

test('boxes around the feet and the zoom that fits every tile in a cell',()=>{
  const c=caixaMundo({x0:40,x1:119,y0:20,y1:149},[160,160],[.5,.875],1);
  assert.deepEqual(c,{left:-40,right:40,top:-120,bottom:10});
  assert.deepEqual(tileMundo([c,c]),{w:160,acima:120,abaixo:10});
  const k=elencoZoom([[c,c]],200,200);
  assert.ok(k*160<=200-12-8+1e-9&&k*130<=200-30-12+1e-9);
  assert.ok(Math.abs(k-Math.min((200-12-8)/160,(200-30-12)/130))<1e-9);
  assert.equal(elencoZoom([],100,100),1);
});
